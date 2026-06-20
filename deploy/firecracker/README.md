# Running the Firecracker runtime (Linux + KVM)

Firecracker microVMs need **Linux with KVM** — they do **not** run on macOS.
Develop the control plane, web, and `mock` agent on your Mac; run the
`firecracker` runtime on a Linux host (a Hetzner Cloud VM with nested virt, a
bare-metal box, or a Linux desktop with `/dev/kvm`).

## 1. Provision a Linux host

Any KVM-capable Ubuntu 22.04/24.04 box. On Hetzner Cloud, pick a server type that
exposes KVM (dedicated vCPU / CCX line is safest for nested virtualization).

## 2. Bring up the shared services it must reach

The agent connects to the same **RabbitMQ** and **Redis** the control plane uses.
Either run the host alongside the `deploy/docker-compose.yml` stack, or point the
agent at a reachable broker:

```bash
export RABBITMQ_URL=amqp://safevm:safevm@<broker-host>:5672
export REDIS_URL=redis://<broker-host>:6379
```

## 3. Prepare the host + images

```bash
sudo bash deploy/firecracker/setup-host.sh    # KVM check, firecracker, NAT, dirs
bash deploy/firecracker/fetch-images.sh       # guest kernel + minimal rootfs
```

## 4. Run the agent against real microVMs

```bash
bun install
RUNTIME=firecracker \
NODE_ID=fc-node-1 \
FC_IMAGE_DIR=/srv/safevm/images \
FC_RUN_DIR=/srv/safevm/run \
bun run --cwd packages/node-agent start
```

Trigger a session from the control plane (`POST /api/workspaces/:id/connect`).
The agent will: allocate a tap, spawn Firecracker, configure it over the API
socket, `InstanceStart`, and report `running` with a `connectUrl` back over
RabbitMQ.

## Environment knobs (node-agent)

| Var | Default | Meaning |
|---|---|---|
| `RUNTIME` | `mock` | `mock` (Mac dev) or `firecracker` |
| `FC_BIN` | `firecracker` | Firecracker binary path |
| `FC_IMAGE_DIR` | `/srv/safevm/images` | base dir for kernel/rootfs refs |
| `FC_RUN_DIR` | `/srv/safevm/run` | per-session jail/socket dir |
| `FC_STREAM_PORT` | `6080` | in-guest streaming server port |
| `NODE_ID` | `fc-node-1` | this node's id in status events |

## What's verified vs. not

- ✅ Runtime code typechecks; the API/boot sequence follows the Firecracker spec
  (boot-source → drives → machine-config → network-interfaces → InstanceStart),
  using Bun's UDS `fetch`.
- ⚠️ **Not yet executed on hardware** (the dev box is macOS). First run on a Linux
  host will likely need: confirming the current CI image URLs in `fetch-images.sh`,
  KVM/permissions (`/dev/kvm`, `CAP_NET_ADMIN`), and a rootfs that actually starts a
  streaming server. A successful boot with the minimal rootfs proves the runtime;
  the streaming desktop is the next image-build step.

## Next image step: a streaming desktop rootfs

The minimal rootfs proves boot. For real desktops, build a rootfs containing a
desktop env + **KasmVNC/Selkies** listening on `FC_STREAM_PORT`, then point the
`Image.rootfsRef` at it. Build via `debootstrap` or by exporting a configured
container to an ext4 image. (Tracked in roadmap Phase 1 / Track B2.)
