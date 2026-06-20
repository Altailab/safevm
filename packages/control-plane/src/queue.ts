import amqp from "amqplib";
import { env } from "./env.ts";

// RabbitMQ is the control-plane <-> node-agent bus.
//  - EXCHANGE_JOBS: control plane -> agents (session.start / session.stop)
//  - EXCHANGE_EVENTS: agents -> control plane (status updates)
export const EXCHANGE_JOBS = "safevm.jobs";
export const EXCHANGE_EVENTS = "safevm.events";

export type SessionJob =
  | { type: "session.start"; sessionId: string; workspace: unknown }
  | { type: "session.stop"; sessionId: string };

export type SessionEvent =
  | {
      type: "session.status";
      sessionId: string;
      status: string;
      connectUrl?: string;
      nodeId?: string;
    }
  | { type: "session.reconcile"; nodeId: string; alive: string[] };

// Agent runner contracts.
export type AgentJob =
  | {
      type: "agent.task.start";
      taskId: string;
      goal: string;
      maxSteps: number;
      model: string;
      workspace: unknown;
    }
  | { type: "agent.task.stop"; taskId: string };

export type AgentEvent =
  | { type: "agent.status"; taskId: string; status: string; result?: string }
  | {
      type: "agent.step";
      taskId: string;
      idx: number;
      thought?: string;
      actionType: string;
      action: Record<string, unknown>;
      observation?: string;
      blocked?: boolean;
    };

let channel: amqp.Channel | null = null;

export async function getChannel(): Promise<amqp.Channel> {
  if (channel) return channel;
  const conn = await amqp.connect(env.RABBITMQ_URL);
  channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE_JOBS, "topic", { durable: true });
  await channel.assertExchange(EXCHANGE_EVENTS, "topic", { durable: true });
  return channel;
}

export async function publishJob(job: SessionJob | AgentJob): Promise<void> {
  const ch = await getChannel();
  ch.publish(EXCHANGE_JOBS, job.type, Buffer.from(JSON.stringify(job)), {
    persistent: true,
  });
}
