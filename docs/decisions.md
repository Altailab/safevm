# Decision log

Lightweight ADRs — decisions made while shaping the project, newest context first.
Each entry: the decision, why, and any consequence to watch.

## D1 — Product shape
**Decision:** Self-hosted, open-source DaaS: browser-streamed server-side Linux
workspaces + Qubes-style disposable file-detonation sandbox.
**Why:** Employees work in isolation from their personal machine; risky files
(PDFs etc.) detonate in a throwaway VM. Closest analogues: Kasm Workspaces,
Cameyo, Qubes OS.

## D2 — Open-core split
**Decision:** OSS gets **every** feature for a single organization; only
**multi-tenancy** (and managed cloud ops) is commercial.
**Consequence:** `tenantId` exists on every tenant-scoped row from day one
(value `"default"` in OSS) so the cloud layer is additive, not a fork.

## D3 — First milestone
**Decision:** Phase 1 = **MVP persistent workspaces** (assign workspace → user
connects to a streamed desktop). Sandbox is Phase 2.

## D4 — Isolation
**Decision:** **Firecracker microVM** (Linux+KVM) as the default boundary; a
`mock` runtime for Mac-local dev; `Runtime` interface keeps Kata/QEMU swappable.
**Why:** "Open malicious files safely" needs a kernel boundary, not just
containers. **Consequence:** Firecracker doesn't run on macOS — the microVM
layer is developed on a Linux host; everything else runs natively on Mac.

## D5 — Deploy target
**Decision:** **Single box** first (Docker Compose / systemd). Kubernetes/fleet
is Phase 3+. **Why:** most self-hosters run one server; don't force k8s on them.

## D6 — Stack
**Decision:** **Bun + Elysia + TypeScript** (control plane and node agent),
**Prisma + PostgreSQL**, **Redis**, **RabbitMQ**.
**Why (Redis/RabbitMQ):** Redis = live session state/presence/rate-limit/pub-sub;
RabbitMQ = durable job bus fanning `session.start/stop` to many node agents, with
status events back. **Note:** the node agent drives Firecracker's REST API over a
Unix socket (Bun `fetch` handles UDS); only the process spawn shells out — stays
all-TypeScript.

## D7 — Web dashboard
**Decision:** React via **TanStack Start**, based on the
`Kiranism/tanstack-start-dashboard` template. Lives in `packages/web`.

## D8 — Guest OS
**Decision:** No custom OS for MVP — use stock **Debian** (workspace desktop).
A minimal custom **Alpine/Buildroot** guest is justified only for the disposable
sandbox in Phase 2/3. See [`os-and-licensing.md`](./os-and-licensing.md).

## D9 — Licensing
**Decision:** **SafeVM Community License** (source-available) for this repo, owned
by **Altailab LLC**. The unmodified Community Edition is **free
to run, including commercially**; **commercial use of a _modified_ version requires
a commercial license** from Altailab LLC (modified versions are otherwise free for
non-commercial use). This replaces the earlier MIT plan: MIT alone couldn't stop a
competitor reselling a modified fork, so the commercial-modification restriction
provides that protection directly — while the **multi-tenant/cloud code still lives
in a separate private repo**. Guest-image component licenses (kernel = GPLv2, etc.)
remain a separate concern tracked via a `NOTICE`/manifest. See
[`os-and-licensing.md`](./os-and-licensing.md) and [`../LICENSE`](../LICENSE).

## D10 — AI agent cloud computers (strategic direction)
**Decision:** Treat "AI agent operating a full computer" as a first-class use case,
not a bolt-on. A Session gains a `driver` ∈ {human, agent, co-pilot}; an agent
runner drives the *same* VM via a Claude computer-use loop, bounded by the existing
policy/audit/streaming controls. **Why:** the isolation that makes opening malicious
files safe is exactly what makes autonomous computer-use safe — it's our moat.
Complementary to agent frameworks like Hermes (we're the safe computer; they're the
brain). Default model: latest **Claude (Opus)**, pluggable. See [`ai-agents.md`](./ai-agents.md).

## D11 — Cloud autoscaling via Hetzner
**Decision:** Cloud tier provisions compute on-demand through the **Hetzner Cloud
API** (provider-agnostic `CloudProvider` interface; Hetzner first). New servers boot
a snapshot-baked node-agent that joins the RabbitMQ pool with no control-plane
redeploy → scale without downtime; drain + delete when idle. Lives in the private
cloud repo; depends only on the OSS scheduler/heartbeat interfaces.
See [`cloud-autoscaling.md`](./cloud-autoscaling.md).
