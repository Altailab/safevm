import amqp from "amqplib";
import { prisma } from "./db.ts";
import { env } from "./env.ts";
import { redis, sessionKey } from "./redis.ts";
import { getChannel, EXCHANGE_EVENTS, type AgentEvent } from "./queue.ts";

type SessionStatusEvent = {
  type: "session.status";
  sessionId: string;
  status: string;
  connectUrl?: string;
  nodeId?: string;
};
type SessionReconcileEvent = { type: "session.reconcile"; nodeId: string; alive: string[] };

type SessionStatus = "pending" | "starting" | "running" | "stopping" | "stopped" | "failed";
type AgentTaskStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "stopped";
type AgentActionType =
  | "screenshot"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "exec"
  | "wait"
  | "finish";

// Consumes session.status events from node agents and reconciles them into
// Postgres (durable) + Redis (live/hot). This closes the connect loop:
// pending -> running(connectUrl) once an agent boots the workspace.
export async function startEventConsumer(): Promise<void> {
  const ch = await getChannel();
  const q = await ch.assertQueue("control-plane.events", { durable: true });
  await ch.bindQueue(q.queue, EXCHANGE_EVENTS, "session.status");
  await ch.bindQueue(q.queue, EXCHANGE_EVENTS, "session.reconcile");
  await ch.bindQueue(q.queue, EXCHANGE_EVENTS, "agent.status");
  await ch.bindQueue(q.queue, EXCHANGE_EVENTS, "agent.step");

  ch.consume(q.queue, async (msg: amqp.ConsumeMessage | null) => {
    if (!msg) return;
    try {
      const ev = JSON.parse(msg.content.toString());
      if (ev.type === "agent.status" || ev.type === "agent.step") {
        await handleAgentEvent(ev as AgentEvent);
      } else if (ev.type === "session.reconcile") {
        await handleReconcile(ev as SessionReconcileEvent);
      } else {
        await handleSessionEvent(ev as SessionStatusEvent);
      }
      ch.ack(msg);
    } catch (err) {
      console.error("event handling failed:", err);
      ch.ack(msg); // avoid poison-message loops; add a DLQ later
    }
  });

  console.log("control-plane event consumer bound to session.* and agent.*");
}

// Mark sessions the node still claims as running/starting but that no longer have
// a live container as stopped — kills stale statuses.
async function handleReconcile(ev: SessionReconcileEvent): Promise<void> {
  const alive = new Set(ev.alive);
  const candidates = await prisma.session.findMany({
    where: { tenantId: env.TENANT_ID, nodeId: ev.nodeId, status: { in: ["running", "starting"] } },
    select: { id: true },
  });
  const dead = candidates.filter((c) => !alive.has(c.id)).map((c) => c.id);
  if (dead.length) {
    await prisma.session.updateMany({
      where: { id: { in: dead } },
      data: { status: "stopped", endedAt: new Date() },
    });
    console.log(`reconcile(${ev.nodeId}): marked ${dead.length} stale session(s) stopped`);
  }
}

async function handleSessionEvent(ev: SessionStatusEvent): Promise<void> {
  await prisma.session.update({
    where: { id: ev.sessionId },
    data: {
      status: ev.status as SessionStatus,
      connectUrl: ev.connectUrl ?? null,
      nodeId: ev.nodeId ?? null,
      ...(ev.status === "stopped" || ev.status === "failed" ? { endedAt: new Date() } : {}),
    },
  });
  await redis.set(sessionKey(ev.sessionId), JSON.stringify(ev), "EX", 3600);
  console.log(`session ${ev.sessionId} -> ${ev.status}`);
}

async function handleAgentEvent(ev: AgentEvent): Promise<void> {
  if (ev.type === "agent.status") {
    await prisma.agentTask.update({
      where: { id: ev.taskId },
      data: {
        status: ev.status as AgentTaskStatus,
        result: ev.result ?? undefined,
        ...(ev.status === "succeeded" || ev.status === "failed" || ev.status === "stopped"
          ? { endedAt: new Date() }
          : {}),
      },
    });
    console.log(`agent ${ev.taskId} -> ${ev.status}`);
  } else {
    await prisma.agentStep.create({
      data: {
        taskId: ev.taskId,
        idx: ev.idx,
        thought: ev.thought,
        actionType: ev.actionType as AgentActionType,
        action: ev.action as object,
        observation: ev.observation,
        blocked: ev.blocked ?? false,
      },
    });
  }
}
