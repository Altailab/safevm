# AI agents on SafeVM — "agent cloud computers"

## The core insight

SafeVM already builds the hard part of safe AI-agent computing: an **isolated,
full-OS computer** with **controlled egress**, **per-action audit**, **live
streaming**, and **disposable/snapshot lifecycle**. Those are exactly the
controls you need to hand an autonomous AI agent the keyboard **safely**.

> **Positioning:** the same isolation that lets a human safely open a malicious
> PDF lets you safely let an AI agent *run a whole computer*. The sandbox is the
> product; "human user" and "AI agent" are just two kinds of driver.

So SafeVM becomes a **platform for AI agents that operate real cloud computers** —
they see the screen, move the mouse, type, run terminals, browse, install
software — bounded by policy, watched by a human, and fully recorded.

## How this relates to Hermes Agent (Nous Research)

[Hermes Agent](https://hermes-agent.org/) is an **agent brain**: persistent
memory, multi-channel chat (Telegram/Discord/Slack/…), skills, sub-agents, and
pluggable execution backends (local/Docker/SSH/cloud). It is *complementary*, not
competitive:

- **Hermes = the agent/orchestration brain.** **SafeVM = the safe computer it runs on.**
- SafeVM can be an **execution backend** for Hermes-style agents (a hardened,
  audited, streamable alternative to "run on my laptop" or a bare Docker container).
- Our moat is the **isolation + human-in-the-loop + audit/recording + fleet**
  substrate, which a pure agent framework doesn't provide.

We can ship our own first-party agent loop *and* expose SafeVM as a backend that
other agent frameworks (Hermes, custom) target.

## Driver model: human | agent | both

A **Session** already represents a running workspace. We add a `driver`:

- `human` — today's path: streamed desktop, person at the keyboard.
- `agent` — an LLM **computer-use loop** drives the same desktop: screenshot →
  model → action (click/type/scroll/run), repeat, against a natural-language goal.
- `co-pilot` — both at once: the human watches the live stream and can **take
  over** or **approve** gated actions in real time.

Because the agent drives the *same* VM a human would, everything we build for
humans (streaming, policy, audit, snapshots) applies unchanged.

## Why isolation makes this safe (the pitch)

| Risk of autonomous computer-use agents | SafeVM control |
|---|---|
| Agent exfiltrates data / calls out to attacker | **Default-deny egress**, per-task allowlist |
| Agent runs destructive commands | **Snapshot before task; roll back** on failure |
| Agent goes off the rails | **Live stream + take-over**; policy gates on sudo/spend/egress |
| No accountability for what the AI did | **Every action audited + session recording** |
| One task contaminates the next | **Disposable VM per task**, destroyed after |
| Prompt-injection from a malicious page/file | Runs in a throwaway VM with no creds/network it doesn't need |

## First-party agent architecture

```
[ Control Plane ]  agent tasks API, goal queue, approval gates
      │  RabbitMQ: agent.task.start / .stop / .approve
[ Agent Runner ]   per-session LLM control loop (new package: packages/agent)
      │   • observe: screenshot + a11y tree from the VM (vsock/streaming)
      │   • think:   Claude (computer use) decides next action
      │   • act:     inject mouse/keyboard/exec into the VM
      │   • guard:   policy engine vetoes / escalates risky actions to a human
      │   • record:  every step -> audit log + trajectory store
[ Workspace / Sandbox microVM ]  the computer the agent operates
```

- **Model:** Anthropic **Claude (computer use)** as the default driver — latest
  Claude (Opus) is the most capable for multi-step OS control. Pluggable, like the
  isolation runtime: `agentModel` is a config, not a hardcode.
- **Action injection:** into the VM via the same channel as streaming input
  (or a guest agent over vsock) — reuse the human input path.
- **Approval gates:** the policy engine already gates egress/clipboard/sudo for
  humans; for agents these become **"pause and ask a human"** checkpoints.

## Concrete AI features (roadmap-able)

1. **Natural-language tasks** — "reconcile these invoices", "set up this repo and
   run the tests", "fill this web form from the attached PDF". Agent drives the GUI/CLI.
2. **AI file triage in the sandbox** — when a risky file detonates, an LLM in the
   sandbox inspects it (macro analysis, phishing/malware verdict, summary) and
   reports back *before* the human opens it. Ties the original sandbox feature to AI.
3. **Co-pilot / take-over** — watch the agent live; grab control; approve gated steps.
4. **Parallel agent fleet** — spawn N disposable agent-computers for N tasks
   concurrently (RabbitMQ already fans out; Hetzner autoscaler adds capacity).
5. **Trajectory capture for training** — every agent session is a clean
   observation→action trace. Export (ShareGPT/own format) for evals, RL, fine-tuning.
   The audit log *is* the dataset.
6. **Skills / memory** — persistent workspace = the agent's long-lived environment
   and memory; document solved tasks as reusable skills (Hermes-style).
7. **Scheduled agents** — cron-triggered agent tasks ("every morning, pull the
   dashboards and email me a summary").

## Open-core split for AI

- **OSS:** the agent runner, driver model, computer-use loop, approval gates,
  trajectory export — single tenant.
- **Cloud:** managed model routing/keys, multi-tenant agent fleets, autoscaled
  capacity (see [`cloud-autoscaling.md`](./cloud-autoscaling.md)), usage billing.

## Risks to design around

- **Prompt injection / hostile content** steering the agent → strict egress
  allowlists, no ambient credentials, human approval for sensitive actions.
- **Cost/runaway loops** → per-task token/time/spend budgets enforced by the runner.
- **Determinism/debuggability** → full trajectory + video recording per session.
- **Data governance** → agent VMs are disposable and egress-controlled by default.

## Suggested build order

1. Land the human MVP (Phase 1) — it provides the substrate.
2. Add `driver` to Session + a `packages/agent` runner with a **mock** model loop
   (mirrors the `mock` isolation runtime) so the control flow is testable without a VM.
3. Wire Claude computer-use against a real Linux workspace (needs the Firecracker
   runtime first).
4. Add approval gates + trajectory export, then parallel fleets + scheduling.
