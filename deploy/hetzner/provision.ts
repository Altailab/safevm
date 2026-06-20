// Provision a Hetzner Cloud server and bring up the full SafeVM stack with the
// Firecracker runtime. Run from the repo root:
//
//   bun run deploy/hetzner/provision.ts
//
// Reads deploy/hetzner/.env (copy from .env.example, add HCLOUD_TOKEN).
// Requires `ssh` and `rsync` on your machine.
import { HCloud } from "./hcloud.ts";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

// --- load deploy/hetzner/.env into process.env -------------------------
const envPath = "deploy/hetzner/.env";
if (existsSync(envPath)) {
  const text = await Bun.file(envPath).text();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const expand = (p: string) => p.replace(/^~/, homedir());
const env = (k: string, d?: string) => process.env[k] ?? d ?? "";

const token = env("HCLOUD_TOKEN");
if (!token) {
  console.error("Set HCLOUD_TOKEN in deploy/hetzner/.env (see .env.example).");
  process.exit(1);
}

const name = env("HCLOUD_SERVER_NAME", "safevm-fc-test");
const pubKeyPath = expand(env("SSH_PUBLIC_KEY", "~/.ssh/id_ed25519.pub"));
const privKeyPath = expand(env("SSH_PRIVATE_KEY", "~/.ssh/id_ed25519"));
if (!existsSync(pubKeyPath)) {
  console.error(`SSH public key not found: ${pubKeyPath}`);
  process.exit(1);
}

const ssh = (ip: string, cmd: string) =>
  run("ssh", [
    "-i", privKeyPath,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "UserKnownHostsFile=/dev/null",
    `root@${ip}`,
    cmd,
  ]);

async function run(bin: string, args: string[]): Promise<void> {
  const p = Bun.spawn([bin, ...args], { stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${bin} exited ${code}`);
}

async function waitForSsh(ip: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const p = Bun.spawn(
      ["ssh", "-i", privKeyPath, "-o", "StrictHostKeyChecking=accept-new",
        "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=5",
        `root@${ip}`, "true"],
      { stdout: "ignore", stderr: "ignore" },
    );
    if ((await p.exited) === 0) return;
    await Bun.sleep(5000);
  }
  throw new Error("SSH never became reachable");
}

const hc = new HCloud(token);

let server = await hc.findServer(name);
let ip: string;
if (server) {
  ip = server.public_net?.ipv4?.ip;
  console.log(`Reusing existing server ${name} (${ip})`);
} else {
  const sshKeyId = await hc.ensureSshKey("safevm-provision", (await Bun.file(pubKeyPath).text()).trim());
  console.log(`Creating ${env("HCLOUD_SERVER_TYPE", "cpx31")} in ${env("HCLOUD_LOCATION", "nbg1")}...`);
  server = await hc.createServer({
    name,
    serverType: env("HCLOUD_SERVER_TYPE", "cpx31"),
    image: env("HCLOUD_IMAGE", "ubuntu-24.04"),
    location: env("HCLOUD_LOCATION", "nbg1"),
    sshKeyId,
  });
  ip = await hc.waitForRunning(server.id);
  console.log(`Server running at ${ip} (id ${server.id})`);
}

console.log("Waiting for SSH...");
await waitForSsh(ip);

console.log("Syncing repo -> /opt/safevm ...");
await ssh(ip, "mkdir -p /opt/safevm");
await run("rsync", [
  "-az", "--delete",
  "-e", `ssh -i ${privKeyPath} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null`,
  "--exclude", "node_modules", "--exclude", ".git", "--exclude", "data",
  "--exclude", "deploy/hetzner/.env",
  "./", `root@${ip}:/opt/safevm/`,
]);

console.log("Running bootstrap on the server (this takes a few minutes)...");
await ssh(ip, "bash /opt/safevm/deploy/hetzner/bootstrap.sh");

console.log(`
✅ Done.
   Control plane:   http://${ip}:3001/health
   RabbitMQ mgmt:   http://${ip}:15672  (safevm/safevm)
   SSH:             ssh root@${ip}

Trigger a real Firecracker session:
   WID=$(curl -s http://${ip}:3001/api/workspaces | bun -e 'console.log((await Bun.stdin.json())[0].id)')
   curl -s -X POST http://${ip}:3001/api/workspaces/$WID/connect

⚠️  Port 3001/15672 are world-open on this test box — lock down with a Hetzner
   firewall before using real data. Tear down with: bun run deploy/hetzner/destroy.ts
`);
