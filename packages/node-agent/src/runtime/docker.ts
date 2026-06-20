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

    // Let Docker assign a free host port (avoids collisions across restarts).
    // Webtop serves its desktop over HTTP on container port 3000.
    await docker([
      "run", "-d",
      "--name", container,
      "--network", DESKTOP_NET,
      "--shm-size", "1g",
      "-p", `${BIND}::3000`,
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

    return { connectUrl: `http://${HOST}:${hostPort}/`, nodeId: NODE_ID };
  }

  async stop(sessionId: string): Promise<void> {
    await docker(["rm", "-f", containerName(sessionId)]).catch(() => {});
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
