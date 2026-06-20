// Per-session host networking for Firecracker microVMs.
//
// Each VM gets a /30 on its own tap device:
//   host  = 172.16.<slot>.1
//   guest = 172.16.<slot>.2
// Egress NAT + default-deny firewalling is configured once at host setup
// (deploy/firecracker/setup-host.sh); here we just create/destroy the tap.
//
// Requires CAP_NET_ADMIN (run the agent as root or with the capability).
// LINUX ONLY — these shell out to `ip`.

export interface TapNet {
  tap: string;
  hostIp: string;
  guestIp: string;
  guestMac: string;
  netmask: string; // for the guest kernel ip= boot arg
  slot: number;
}

async function run(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) {
    const err = await new Response(p.stderr).text();
    throw new Error(`command failed (${code}): ${cmd.join(" ")}\n${err}`);
  }
}

export async function createTap(slot: number): Promise<TapNet> {
  const tap = `fc-tap${slot}`;
  const hostIp = `172.16.${slot}.1`;
  const guestIp = `172.16.${slot}.2`;
  // Locally-administered, deterministic per slot.
  const guestMac = `02:FC:00:00:00:${slot.toString(16).padStart(2, "0")}`;

  // Recreate cleanly in case a stale tap lingers from a crash.
  await run(["ip", "link", "del", tap]).catch(() => {});
  await run(["ip", "tuntap", "add", "dev", tap, "mode", "tap"]);
  await run(["ip", "addr", "add", `${hostIp}/30`, "dev", tap]);
  await run(["ip", "link", "set", "dev", tap, "up"]);

  return { tap, hostIp, guestIp, guestMac, netmask: "255.255.255.252", slot };
}

export async function deleteTap(tap: string): Promise<void> {
  await run(["ip", "link", "del", tap]).catch(() => {});
}
