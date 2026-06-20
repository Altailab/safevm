import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { Runtime, StartSpec, StartResult } from "./types.ts";
import { createTap, deleteTap, type TapNet } from "./net.ts";

// Firecracker microVM runtime (LINUX + KVM ONLY).
//
// Firecracker exposes a REST API over a Unix domain socket. Bun's fetch can dial
// a UDS via the `unix` option, so the whole config sequence is plain TypeScript;
// we only shell out to spawn the `firecracker` process and manage the tap device.
//
// Assumptions (provisioned by deploy/firecracker/setup-host.sh):
//   - `firecracker` binary on PATH
//   - KVM available (/dev/kvm), agent has rights to it + CAP_NET_ADMIN
//   - IP forwarding + egress NAT/firewall configured on the host
//   - a guest kernel (vmlinux) and a base rootfs image present
//
// NOTE: not runnable/verified on macOS — see deploy/firecracker/README.md.

const FC_BIN = process.env.FC_BIN ?? "firecracker";
const IMAGE_DIR = process.env.FC_IMAGE_DIR ?? "/srv/safevm/images";
const RUN_DIR = process.env.FC_RUN_DIR ?? "/srv/safevm/run";
const NODE_ID = process.env.NODE_ID ?? "fc-node-1";
// Port the in-guest streaming server listens on (KasmVNC/Selkies/noVNC).
const STREAM_PORT = Number(process.env.FC_STREAM_PORT ?? 6080);

interface Live {
  proc: ReturnType<typeof Bun.spawn>;
  net: TapNet;
  dir: string;
}

export class FirecrackerRuntime implements Runtime {
  readonly name = "firecracker";
  private live = new Map<string, Live>();
  private nextSlot = 1;

  async start(spec: StartSpec): Promise<StartResult> {
    const slot = this.nextSlot++;
    const dir = join(RUN_DIR, spec.sessionId);
    const apiSock = join(dir, "firecracker.sock");
    await mkdir(dir, { recursive: true });

    const kernel = this.resolve(spec.kernelRef);
    const rootfs = this.resolve(spec.rootfsRef);
    if (!existsSync(kernel)) throw new Error(`kernel not found: ${kernel}`);
    if (!existsSync(rootfs)) throw new Error(`rootfs not found: ${rootfs}`);

    const net = await createTap(slot);

    // Spawn Firecracker bound to the API socket; configure it before InstanceStart.
    const proc = Bun.spawn([FC_BIN, "--api-sock", apiSock], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
    });
    this.live.set(spec.sessionId, { proc, net, dir });

    try {
      await waitForSocket(apiSock);

      // Static-IP the guest via the kernel command line (ip=guest::gw:mask::eth0:off).
      const bootArgs =
        `console=ttyS0 reboot=k panic=1 pci=off ` +
        `ip=${net.guestIp}::${net.hostIp}:${net.netmask}::eth0:off`;

      await put(apiSock, "/boot-source", {
        kernel_image_path: kernel,
        boot_args: bootArgs,
      });
      await put(apiSock, "/drives/rootfs", {
        drive_id: "rootfs",
        path_on_host: rootfs,
        is_root_device: true,
        is_read_only: false,
      });
      await put(apiSock, "/machine-config", {
        vcpu_count: spec.vcpus,
        mem_size_mib: spec.memMib,
      });
      await put(apiSock, "/network-interfaces/eth0", {
        iface_id: "eth0",
        guest_mac: net.guestMac,
        host_dev_name: net.tap,
      });
      await put(apiSock, "/actions", { action_type: "InstanceStart" });

      // The gateway will proxy this; for now it's the guest's reachable stream port.
      const connectUrl = `http://${net.guestIp}:${STREAM_PORT}/`;
      return { connectUrl, nodeId: NODE_ID };
    } catch (err) {
      await this.stop(spec.sessionId).catch(() => {});
      throw err;
    }
  }

  async stop(sessionId: string): Promise<void> {
    const l = this.live.get(sessionId);
    if (!l) return;
    try {
      l.proc.kill(); // SIGTERM; Firecracker exits and frees the VM
      await l.proc.exited;
    } finally {
      await deleteTap(l.net.tap).catch(() => {});
      await rm(l.dir, { recursive: true, force: true }).catch(() => {});
      this.live.delete(sessionId);
    }
  }

  // Image refs may be absolute paths or relative to FC_IMAGE_DIR.
  private resolve(ref: string): string {
    return isAbsolute(ref) ? ref : join(IMAGE_DIR, ref);
  }
}

async function put(apiSock: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`http://localhost${path}`, {
    unix: apiSock,
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`firecracker PUT ${path} -> ${res.status}: ${await res.text()}`);
  }
}

async function waitForSocket(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for firecracker api socket: ${path}`);
}
