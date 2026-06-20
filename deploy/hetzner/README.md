# Hetzner provisioning (real Firecracker test box)

One command spins up a Hetzner Cloud server and brings up the **full SafeVM stack
with the Firecracker microVM runtime** — the thing we can't run on macOS (no KVM).
The same flow is the seed of the cloud autoscaler (see
[`../../docs/cloud-autoscaling.md`](../../docs/cloud-autoscaling.md)).

## What it does

1. Creates a KVM-capable Ubuntu 24.04 server (Hetzner Cloud exposes `/dev/kvm`).
2. Uploads your SSH key, waits for boot + SSH.
3. `rsync`s this repo to `/opt/safevm`.
4. Runs `bootstrap.sh` on the box: installs Docker + Bun + Firecracker, sets up
   host networking, fetches a guest kernel/rootfs, brings up Postgres/Redis/RabbitMQ,
   migrates + seeds, and starts the control plane + Firecracker agent as systemd services.

## Use

```bash
cp deploy/hetzner/.env.example deploy/hetzner/.env
# edit deploy/hetzner/.env -> paste HCLOUD_TOKEN, set SSH key paths
bun run deploy/hetzner/provision.ts      # ~3-5 min
```

When it finishes it prints the control-plane URL. Trigger a real microVM:

```bash
IP=<printed-ip>
WID=$(curl -s http://$IP:3001/api/workspaces | bun -e 'console.log((await Bun.stdin.json())[0].id)')
SID=$(curl -s -X POST http://$IP:3001/api/workspaces/$WID/connect | bun -e 'console.log((await Bun.stdin.json()).id)')
curl -s http://$IP:3001/api/sessions/$SID    # -> status running, connectUrl
```

Tear it down when done (stops billing):

```bash
bun run deploy/hetzner/destroy.ts
```

## Requirements

- `HCLOUD_TOKEN` — Hetzner Cloud Console → project → Security → API Tokens (Read & Write).
- `ssh` + `rsync` on your machine; an SSH keypair (`SSH_PUBLIC_KEY`/`SSH_PRIVATE_KEY`).

## Notes & caveats

- **Cost:** a `cpx31` bills per hour. Run `destroy.ts` when finished.
- **Security:** the test box leaves `:3001` and `:15672` world-open. Attach a
  Hetzner firewall (or restrict in `provision.ts`) before any real data.
- **First boot of microVMs** may still need the image URLs in
  `../firecracker/fetch-images.sh` confirmed against current Firecracker CI, and a
  streaming-enabled rootfs for an actual desktop (the minimal rootfs only proves boot).
- **Nested virt:** `cpx`/`ccx` types work; if `/dev/kvm` is missing on the chosen
  type, `setup-host.sh` fails fast with a clear message — pick a `ccx` (dedicated) type.
- This is **dev/test tooling**. The production multi-tenant autoscaler (`CloudProvider`
  abstraction, drain/scale logic) lives in the private cloud repo per the open-core split.
```
