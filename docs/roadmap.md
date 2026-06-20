# Roadmap

Phased so each step is demoable on its own. **Phase 1 (MVP workspaces) is the
current target.**

## Phase 0 — Streaming spike ✅ direction set
Prove one Ubuntu desktop streams into the browser end-to-end (KasmVNC/Selkies)
behind a basic gateway + login. Throwaway code; validates the UX.

## Phase 1 — MVP persistent workspaces ⬅ current
**Done = an admin can assign a workspace and a user can connect to a streamed desktop.**

- [x] Monorepo scaffold (Bun workspaces)
- [x] Control-plane API skeleton (Elysia) + health
- [x] Prisma schema: tenant, user, image, workspace, session, audit
- [x] Redis + RabbitMQ clients; job/event contracts
- [x] Node agent consuming RabbitMQ jobs; pluggable runtime (`mock`)
- [x] Backing-services compose (Postgres, Redis, RabbitMQ)
- [x] Prisma migration + seed (admin user, sample image/workspace)
- [x] Auth: email/password + JWT login, `authGuard` on all data routes, `/auth/me` (OIDC later)
- [x] Web dashboard (React + shadcn/ui): Dashboard stats, Workspaces (**Connect** + create),
      Sessions (live status + Stop), Images (create), Users (create), Audit — wired to the control plane
- [x] Dashboard auth: login screen → real JWT, token interceptor, `_authenticated` route guard
- [x] Sign-out (resets token + clears query cache) and real user shown in sidebar/profile
- [x] Role-based access: admin-only creates enforced server-side (member → 403); UI hides
      admin-only nav (Images/Users/Audit) and create actions from members
- [x] In-app session viewer with a branded toolbar + pluggable `StreamClient` adapter
      (`iframe` now, `selkies` skeleton); readiness-gated (no premature new-tab open);
      "open in new tab" option. See [`streaming-client.md`](./streaming-client.md).
- [x] Stale-status reconciliation: node-agent heartbeats live containers, control plane
      marks dead sessions `stopped` (no more stuck "running")
- [x] Competing-consumer job queues (one job → one agent) — fixes connect name/port conflicts
- [ ] Gateway: TLS + session routing to the streaming endpoint
- [ ] Real streaming: KasmVNC/Selkies in a workspace image
- [x] Session lifecycle wired to live status events + audit (connect → running → connectUrl)
- [~] Firecracker runtime — **code-complete** (boot sequence over UDS, tap networking,
      host-setup + image scripts); **pending hardware verification** on a Linux+KVM box
      (see `deploy/firecracker/README.md`)
- [ ] Streaming-enabled rootfs (Debian + KasmVNC/Selkies) for a real desktop

## Phase 1.5 — Hardening the MVP
OIDC/SAML SSO · RBAC enforcement on every route · session timeouts/limits ·
structured audit export · single-box install script (systemd units).

## Phase 2 — The disposable sandbox (the differentiator)
- Snapshot-booted Firecracker microVM per risky file; default-deny egress; destroy on close.
- "Open safely" UX from the workspace (right-click → open in sandbox).
- CDR return path (Dangerzone-style sanitized copy back to the workspace).
- **Ship this loudly — it's the security story.**

## Phase 3 — Policy & fleet
Egress firewall · clipboard/file/USB/print controls · session recording ·
golden-image build pipeline · multi-node scheduling + autoscaling.

## Phase 4 — Cloud (commercial)
Multi-tenant control plane (org isolation, quotas) · billing · managed updates ·
SLA dashboards · **on-demand autoscaling via Hetzner Cloud API** (provision/drain
nodes to serve paying customers without downtime — see
[`cloud-autoscaling.md`](./cloud-autoscaling.md)). Built on the same `tenantId` seam.

## Track B (parallel) — AI agent cloud computers
The differentiator: let an **AI agent operate a full cloud computer**, made safe
by the same isolation/audit/streaming substrate. See [`ai-agents.md`](./ai-agents.md).
- [x] B1 — `driver` on Session (human | agent | copilot); `packages/agent` runner with a
      pluggable model (**mock** + **claude** skeleton), `Computer` interface, safety guard,
      and the observe→think→act→guard→record loop over RabbitMQ. `AgentTask`/`AgentStep`
      schema; control-plane agent API; dashboard **Agents** page with live trajectory view.
- [ ] B2 — wire the `claude` model (Anthropic computer-use) against a real screenshot-capable
      workspace (needs the Firecracker/VNC tier for pixels + input injection).

## Streaming tiers
- [x] In-app viewer + **floating toolbar widget**; pluggable `StreamClient`.
- [x] **Selkies WebRTC adapter implemented** (signalling + peer connection + input +
      control channel); select via `?stream=selkies`. Pending validation against a live
      Selkies workspace image — see [`../deploy/selkies/README.md`](../deploy/selkies/README.md).
- [ ] Build the Selkies-enabled workspace image + `docker-selkies` runtime (Linux/GPU host).
- B3 — approval gates (human-in-the-loop) + full trajectory/video recording.
- B4 — AI file triage in the sandbox (malware/phishing verdict before a human opens it).
- B5 — parallel agent fleets + scheduled agents + skills/memory + trajectory export.

## Cross-cutting backlog
Observability (metrics/tracing/logs) · backup & DR for Postgres · secrets
management · golden-image CVE scanning · rate limiting (Redis) · DLQ for failed jobs.
