import amqp from "amqplib";
import { runAgentTask, type AgentEvent, type AgentJob } from "./loop.ts";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://safevm:safevm@localhost:5672";
const EXCHANGE_JOBS = "safevm.jobs";
const EXCHANGE_EVENTS = "safevm.events";

// Tasks asked to stop mid-run; the loop checks this between steps.
const stopRequested = new Set<string>();

async function main() {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE_JOBS, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_EVENTS, "topic", { durable: true });

  // Shared durable queue (competing consumers) — each task runs on one runner.
  const QUEUE = "agent-runner.jobs";
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE_JOBS, "agent.task.*");

  const publish = (e: AgentEvent) =>
    ch.publish(EXCHANGE_EVENTS, e.type, Buffer.from(JSON.stringify(e)), { persistent: true });

  console.log("SafeVM agent runner up, waiting for agent.task.* jobs...");

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const job = JSON.parse(msg.content.toString());
    ch.ack(msg);

    if (job.type === "agent.task.stop") {
      stopRequested.add(job.taskId);
      return;
    }
    if (job.type !== "agent.task.start") return;

    console.log(`agent task ${job.taskId} (${job.model}): "${job.goal}"`);
    const agentJob: AgentJob = {
      taskId: job.taskId,
      goal: job.goal,
      maxSteps: job.maxSteps ?? 20,
      model: job.model ?? "mock",
      workspace: job.workspace ?? {},
    };
    await runAgentTask(agentJob, publish, () => stopRequested.has(job.taskId)).catch((err) =>
      console.error("agent task failed:", err),
    );
    stopRequested.delete(job.taskId);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
