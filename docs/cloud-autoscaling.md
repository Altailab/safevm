# Cloud autoscaling (Hetzner on-demand capacity)

A **cloud-tier** (commercial) capability: provision compute **on demand** so
paying customers get capacity without downtime, and idle capacity is reclaimed to
control cost. Hetzner Cloud is a strong first target (cheap, fast API, EU/US
regions). The design is provider-agnostic — Hetzner is the first `CloudProvider`.

## Why it fits cleanly

The fleet is already decoupled: the **control plane** dispatches `session.start`
jobs over **RabbitMQ**, and **node agents** on compute hosts consume them. Scaling
out = "add more node agents." The autoscaler just manages the hosts those agents
run on.

```
[ Control Plane ]
   • scheduler: sees pending sessions + node capacity (via Redis heartbeats)
   • autoscaler (cloud only):
        demand > capacity  → CloudProvider.createServer() → cloud-init installs
                             node-agent → it registers + consumes jobs
        sustained idle     → drain node → CloudProvider.deleteServer()
        │
        └── Hetzner Cloud API  (servers, volumes, networks, firewalls)
[ New Hetzner server ] → boots → node-agent joins the RabbitMQ pool → serves sessions
```

## Mechanics

- **Signal:** node agents publish heartbeats + load to Redis; the scheduler knows
  free microVM slots per node. Pending sessions that can't be placed trigger scale-up.
- **Provision:** `CloudProvider.createServer()` creates a Hetzner server from a
  prebuilt **snapshot/image** (node-agent + Firecracker + golden images baked in →
  boots in seconds, not minutes). `cloud-init` injects the RabbitMQ/Redis creds and
  node identity.
- **Join:** the new node-agent connects to RabbitMQ and immediately consumes jobs —
  no control-plane redeploy, no downtime.
- **Network:** servers join a **private network**; only the gateway is public.
  Per-server **firewall** (Hetzner API) enforces default-deny egress.
- **Scale-down:** cordon the node (stop new placements), let running sessions
  drain (or live-migrate/snapshot), then `deleteServer()`.
- **Headroom:** keep a warm buffer of N free slots so spikes don't wait on a
  ~30–60s server boot. Tune buffer vs. cost.

## Provider abstraction

```ts
interface CloudProvider {
  createServer(spec: NodeSpec): Promise<NodeHandle>; // returns ip, id
  deleteServer(id: string): Promise<void>;
  // optional: volumes, snapshots, firewalls
}
// First impl: HetznerProvider (REST API + token). Later: bare-metal, AWS, etc.
```

Keep this in the **private cloud repo** (commercial), built on the OSS scheduler
interface — consistent with the open-core split.

## Cost & safety notes

- Bill customers on **session-hours / agent-task-hours**; the autoscaler ties cost
  to usage. Hetzner's per-hour billing maps well.
- Cap max servers per tenant (runaway protection); alert on scale events.
- Prefer **snapshot-baked images** over boot-time provisioning for speed and
  reproducibility; rebuild images in CI when golden images or the agent update.

## Status

Phase 4 (cloud). Not in the OSS single-box scope, but the **scheduler + heartbeat
interfaces** it depends on are designed in the OSS control plane so the cloud
autoscaler is an additive module.
