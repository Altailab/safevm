# Architecture

## Product, in one paragraph

SafeVM gives each employee a **server-side Linux desktop** streamed to their
browser, so corporate work never touches their personal machine. When the user
opens a **risky file** (PDF, Office doc, archive, unknown executable), it opens
in a **disposable microVM** with no/locked-down network that is destroyed on
close — a malicious file can't persist or pivot into the corporate network.
Optionally the file is returned to the workspace as a **sanitized copy** (CDR),
never the live original.

Two pillars:

1. **Persistent workspace** — the daily-driver desktop (DaaS).
2. **Disposable sandbox** — Qubes-style throwaway VM for detonating untrusted files.

## Layered design

```
Browser (thin client) ── WebRTC / WebSocket ───────────────┐
                                                            │
[ Gateway ]  single ingress · TLS · OIDC/SAML · session routing
     │        (compute nodes are never directly exposed)
     │
[ Control Plane ]  Bun + Elysia
     │   • REST/WS API (admin console + user portal)
     │   • Prisma  → PostgreSQL   (source of truth)
     │   • Redis                  (live session state, presence, rate limits, pub/sub)
     │   • RabbitMQ               (job bus to node agents)
     │   • policy engine · image registry · audit log
     │   • multi-tenancy seam (tenantId; "default" in OSS)
     │
     │  ── RabbitMQ ──►  jobs:   session.start / session.stop
     │  ◄── RabbitMQ ──  events: session.status (connectUrl, nodeId, state)
     │
[ Node Agent ]  Bun daemon on each compute host
     │   • consumes jobs, drives the isolation runtime
     │   • streams the display, enforces egress / clipboard / file rules
     │
[ Isolation Runtime ]  pluggable
     ├── mock          (Mac-local dev, no VM)
     ├── firecracker   (Linux + KVM microVM)   ← default for prod
     └── kata / qemu   (future)
          │
   ┌──────┴───────────────────────────┐
   │ Persistent workspace microVMs      │
   │ Disposable sandbox microVMs        │
   └────────────────────────────────────┘
```

### Why these components

- **Gateway** — one authenticated front door. No compute node is exposed to the
  internet; the gateway brokers a streaming session to the right node.
- **Control plane** — stateless API; all durable state in Postgres. Owns users,
  images, workspaces, sessions, policies, audit. This is the **only** place
  multi-tenancy lives, so the cloud layer is additive, not a fork.
- **Redis** — ephemeral/hot state that shouldn't hit Postgres on every beat:
  live session status, presence, rate limiting, and pub/sub that pushes session
  updates to the dashboard in real time.
- **RabbitMQ** — decouples the control plane from a fleet of node agents.
  `session.start`/`session.stop` are published as durable jobs; agents publish
  `session.status` events back. Scales to many nodes; survives agent restarts.
- **Node agent** — the only component that talks to the hypervisor. Keeps the
  control plane host-agnostic and lets isolation backends be swapped.

## Isolation strategy (the core security decision)

A product that promises "safely open malicious files" needs a **kernel
boundary**, not just a container namespace. Decisions:

- **Persistent workspaces** → **Firecracker microVM** (or Kata) — real kernel
  isolation with near-container speed.
- **Disposable sandbox** → **Firecracker microVM**, snapshot-booted for
  sub-second cold start, **default-deny egress**, destroyed on close.
- **CDR (Content Disarm & Reconstruction)** → for documents, render the file to
  pixels and rebuild a clean PDF (Dangerzone-style), so the workspace receives a
  sanitized copy, never the live original.

The `Runtime` interface (`packages/node-agent/src/runtime/types.ts`) abstracts
this so `mock` (dev), `firecracker` (prod), and future `kata`/`qemu` backends
are interchangeable.

## Streaming

The browser is a thin client. Planned: **Selkies** (WebRTC, GPU-friendly) or
**KasmVNC** for the display path, fronted by the gateway. Raw noVNC is the
fallback/spike option but not the target for production UX.

## Data model

Defined in `packages/control-plane/prisma/schema.prisma`:

- **Tenant** — `"default"` in OSS; the multi-tenancy seam.
- **User** — email/password for MVP, OIDC/SAML later. `role` ∈ {admin, member}.
- **Image** — a golden OS template (`kernelRef` + `rootfsRef`) a workspace boots from.
- **Workspace** — an image assigned to a user, with vcpus/mem and a `policy` blob
  (egress, clipboard, file-transfer rules). `kind` ∈ {persistent, disposable}.
- **Session** — a live/historical run of a workspace on a node; holds `connectUrl`.
- **AuditLog** — every meaningful action (`workspace.create`, `session.connect`, …).

Every tenant-scoped row carries `tenantId` so the cloud control plane adds
tenant isolation without a schema migration fork.

## Request flow: "connect to my workspace"

1. User clicks **Connect** → `POST /api/workspaces/:id/connect`.
2. Control plane creates a `Session(status=pending)`, writes an audit row.
3. Control plane publishes `session.start` to RabbitMQ (`safevm.jobs`).
4. A node agent consumes it, calls `runtime.start(...)`, boots the microVM.
5. Agent publishes `session.status{running, connectUrl}` to `safevm.events`.
6. Control plane updates the session, pushes it to the dashboard via Redis pub/sub.
7. Browser dials `connectUrl` through the gateway → live desktop.

## Security model (product value, not an afterthought)

- Default-deny egress from sandboxes; per-workspace network policy.
- Clipboard, upload/download, USB, printing are **policy-gated per role**.
- Files crossing the trust boundary go through CDR; originals never land on the host.
- Immutable golden images; workspaces reset to known-good on a schedule.
- Full session audit; tamper-evident audit log.

## Open-core boundary

| | Community Edition (source-available, this repo) | Cloud (commercial, separate) |
|---|---|---|
| Workspaces, sandbox, CDR | ✅ | ✅ |
| SSO, policy, audit, image build | ✅ | ✅ |
| Single-tenant | ✅ | — |
| **Multi-tenant control plane** | ❌ | ✅ |
| Managed autoscaling / spot pooling | ❌ | ✅ |
| Billing, SLA, hosted updates | ❌ | ✅ |

The `tenantId` seam keeps both on one codebase. See
[`os-and-licensing.md`](./os-and-licensing.md) for how the source-available core +
open-core split coexist.
