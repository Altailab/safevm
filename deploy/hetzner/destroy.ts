// Tear down the Hetzner test server to stop billing. Run from repo root:
//   bun run deploy/hetzner/destroy.ts
import { HCloud } from "./hcloud.ts";
import { existsSync } from "node:fs";

const envPath = "deploy/hetzner/.env";
if (existsSync(envPath)) {
  const text = await Bun.file(envPath).text();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const token = process.env.HCLOUD_TOKEN ?? "";
const name = process.env.HCLOUD_SERVER_NAME ?? "safevm-fc-test";
if (!token) {
  console.error("Set HCLOUD_TOKEN in deploy/hetzner/.env");
  process.exit(1);
}

const hc = new HCloud(token);
const server = await hc.findServer(name);
if (!server) {
  console.log(`No server named ${name}. Nothing to do.`);
  process.exit(0);
}
await hc.deleteServer(server.id);
console.log(`Deleted server ${name} (id ${server.id}).`);
