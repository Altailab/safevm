import { unlink } from "node:fs/promises";
import type { Runtime, StartSpec, StartResult } from "./types.ts";

// Container runtime: launches a streaming-desktop container per session
// (KasmVNC-based, e.g. linuxserver/webtop) and returns its browser URL.
//
// Works WITHOUT KVM, so it runs on macOS/Docker Desktop — ideal for local dev
// and a "standard" isolation tier. NOTE: container isolation is weaker than a
// microVM; the malware-detonation / disposable-sandbox tier uses `firecracker`,
// not this. Same Runtime interface, so the control flow is identical.

const IMAGE = process.env.WEBTOP_IMAGE ?? "lscr.io/linuxserver/webtop:ubuntu-xfce";
const NODE_ID = process.env.NODE_ID ?? "docker-node-1";
const HOST = process.env.DOCKER_HOST_ADDR ?? "localhost";
// Where published desktop ports bind. 127.0.0.1 (default) = local-only; on a
// server set DOCKER_BIND_ADDR=0.0.0.0 so a remote browser can reach the desktop.
const BIND = process.env.DOCKER_BIND_ADDR ?? "127.0.0.1";

// Per-session HTTPS proxy. When DESKTOP_PROXY=1 the desktop is bound to localhost
// and served under the dashboard's own origin at `/d/<sessionId>/` via a small
// nginx location written per session. This satisfies KasmVNC's secure-context
// requirement (real TLS, no mixed content) and keeps desktop ports off the public
// interface. connectUrl is relative by default (origin-agnostic); set
// DESKTOP_BASE_URL to force an absolute base.
const PROXY = process.env.DESKTOP_PROXY === "1";
const SESSIONS_DIR = process.env.NGINX_SESSIONS_DIR ?? "/etc/nginx/safevm-sessions";
const BASE_URL = process.env.DESKTOP_BASE_URL ?? "";

// All desktops share ONE network with inter-container comms disabled
// (enable_icc=false): each session still gets egress + its published port, but
// one user's desktop CANNOT reach another user's desktop. Cheaper than a network
// per session and needs no per-session teardown.
const DESKTOP_NET = process.env.DOCKER_DESKTOP_NET ?? "safevm-desktops";

// Hardening (#3). cap-drop ALL then add back only what an s6/XFCE desktop needs
// to start and switch to its unprivileged user. `no-new-privileges` neutralizes
// setuid escalation (sudo/su can't elevate) even if those binaries exist.
// Override DOCKER_CAP_ADD if a particular image needs more/less.
const CAP_ADD = (process.env.DOCKER_CAP_ADD ??
  "CHOWN,SETUID,SETGID,DAC_OVERRIDE,FOWNER,KILL")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

async function ensureDesktopNetwork(): Promise<void> {
  const existing = await docker(["network", "ls", "--filter", `name=^${DESKTOP_NET}$`, "--format", "{{.Name}}"]).catch(() => "");
  if (existing.trim() === DESKTOP_NET) return;
  await docker([
    "network", "create",
    "--opt", "com.docker.network.bridge.enable_icc=false", // no desktop-to-desktop traffic
    DESKTOP_NET,
  ]).catch(() => {}); // tolerate a concurrent create
}

async function docker(args: string[]): Promise<string> {
  const p = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(`docker ${args[0]} failed (${code}): ${err.trim()}`);
  return out.trim();
}

// Run a command, returning its exit code + stderr (for nginx control).
async function run(cmd: string[]): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { code, err: err.trim() };
}

async function reloadNginx(): Promise<void> {
  const test = await run(["nginx", "-t"]);
  if (test.code !== 0) throw new Error(`nginx config test failed: ${test.err}`);
  const reload = await run(["nginx", "-s", "reload"]);
  if (reload.code !== 0) throw new Error(`nginx reload failed: ${reload.err}`);
}

// Wait until the desktop's HTTP server answers (any response = it's up), so we
// only publish connectUrl once it's actually serving. Bounded; proceeds anyway.
async function waitForDesktop(port: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      return; // any HTTP response means KasmVNC is listening
    } catch {
      await Bun.sleep(1000);
    }
  }
}

const sessionConf = (sessionId: string) => `${SESSIONS_DIR}/${sessionId}.conf`;

// Write the per-session nginx location and reload. proxy_pass' trailing slash
// strips the /d/<id>/ prefix, so the desktop is served as if at root (its assets
// use relative paths, so they resolve under /d/<id>/). $connection_upgrade comes
// from a map block the installer adds — it makes WebSocket upgrades automatic.
async function writeSessionProxy(sessionId: string, hostPort: string): Promise<void> {
  const conf = `# SafeVM session ${sessionId}
location /d/${sessionId}/ {
    proxy_pass http://127.0.0.1:${hostPort}/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
`;
  await Bun.write(sessionConf(sessionId), conf); // Bun.write creates parent dirs
  await reloadNginx();
}

async function removeSessionProxy(sessionId: string): Promise<void> {
  await unlink(sessionConf(sessionId)).catch(() => {});
  await reloadNginx().catch(() => {});
}

const containerName = (sessionId: string) => `safevm-${sessionId}`;

export class DockerRuntime implements Runtime {
  readonly name = "docker";

  async start(spec: StartSpec): Promise<StartResult> {
    const container = containerName(spec.sessionId);

    // Clear any leftover container with this name (crash, retry, restart) so the
    // run can't fail with a name conflict.
    await docker(["rm", "-f", container]).catch(() => {});

    // Isolated, ICC-disabled network so desktops can't see each other (#2).
    await ensureDesktopNetwork();

    // In proxy mode the desktop stays on localhost (only nginx reaches it).
    const bind = PROXY ? "127.0.0.1" : BIND;

    // Let Docker assign a free host port (avoids collisions across restarts).
    // Webtop serves its desktop over HTTP on container port 3000.
    await docker([
      "run", "-d",
      "--name", container,
      "--network", DESKTOP_NET,
      "--shm-size", "1g",
      "-p", `${bind}::3000`,
      "--cpus", String(spec.vcpus),
      "--memory", `${spec.memMib}m`,
      // Hardening (#3): least privilege.
      "--security-opt", "no-new-privileges",
      "--cap-drop", "ALL",
      ...CAP_ADD.flatMap((c) => ["--cap-add", c]),
      IMAGE,
    ]);

    // Read back the assigned host port: `docker port` prints e.g. "127.0.0.1:49153".
    const mapping = await docker(["port", container, "3000"]);
    const hostPort = mapping.split("\n")[0]?.trim().split(":").pop();
    if (!hostPort) {
      await docker(["rm", "-f", container]).catch(() => {});
      throw new Error("could not determine assigned host port");
    }

    if (PROXY) {
      // Serve the desktop under the dashboard's TLS origin at /d/<id>/.
      try {
        await waitForDesktop(hostPort);
        await writeSessionProxy(spec.sessionId, hostPort);
      } catch (e) {
        await docker(["rm", "-f", container]).catch(() => {});
        throw e;
      }
      // Relative by default → works on whatever origin the dashboard is served.
      return { connectUrl: `${BASE_URL}/d/${spec.sessionId}/`, nodeId: NODE_ID };
    }

    return { connectUrl: `http://${HOST}:${hostPort}/`, nodeId: NODE_ID };
  }

  async stop(sessionId: string): Promise<void> {
    await docker(["rm", "-f", containerName(sessionId)]).catch(() => {});
    if (PROXY) await removeSessionProxy(sessionId);
  }

  // Running session containers (excludes the infra `safevm-cloud-*` containers).
  async list(): Promise<string[]> {
    const out = await docker([
      "ps", "--filter", "name=safevm-", "--format", "{{.Names}}",
    ]).catch(() => "");
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter((n) => n.startsWith("safevm-") && !n.startsWith("safevm-cloud-"))
      .map((n) => n.slice("safevm-".length));
  }
}
