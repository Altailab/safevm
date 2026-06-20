import amqp from "amqplib";
import type { Runtime } from "./runtime/types.ts";
import { MockRuntime } from "./runtime/mock.ts";
import { DockerRuntime } from "./runtime/docker.ts";
import { FirecrackerRuntime } from "./runtime/firecracker.ts";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://safevm:safevm@localhost:5672";
const RUNTIME = process.env.RUNTIME ?? "mock";
const NODE_ID = process.env.NODE_ID ?? "docker-node-1";
const EXCHANGE_JOBS = "safevm.jobs";
const EXCHANGE_EVENTS = "safevm.events";

function makeRuntime(kind: string): Runtime {
  switch (kind) {
    case "firecracker":
      return new FirecrackerRuntime(); // Linux + KVM, hardened tier
    case "docker":
      return new DockerRuntime(); // real streamed desktop, no KVM (Mac-local dev / standard tier)
    default:
      return new MockRuntime(); // logic-only, no VM
  }
}

const runtime: Runtime = makeRuntime(RUNTIME);

async function main() {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE_JOBS, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_EVENTS, "topic", { durable: true });

  // Shared, durable queue with competing consumers: each job is delivered to
  // exactly ONE node-agent (not fanned out to every instance), so multiple
  // agents never collide on the same session/container.
  const QUEUE = "node-agent.jobs";
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE_JOBS, "session.*");
  await ch.prefetch(1);

  console.log(`SafeVM node-agent up (runtime=${runtime.name}), waiting for jobs...`);

  // Periodically report which sessions are actually alive so the control plane
  // can mark crashed/removed ones as stopped (fixes stale "running" statuses).
  if (runtime.list) {
    setInterval(async () => {
      const alive = await runtime.list!().catch(() => null);
      if (!alive) return;
      ch.publish(
        EXCHANGE_EVENTS,
        "session.reconcile",
        Buffer.from(JSON.stringify({ type: "session.reconcile", nodeId: NODE_ID, alive })),
        { persistent: false },
      );
    }, 10_000);
  }

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const job = JSON.parse(msg.content.toString());
    console.log(`job ${job.type} session=${job.sessionId}`);
    try {
      if (job.type === "session.start") {
        const ws = job.workspace ?? {};
        const result = await runtime.start({
          sessionId: job.sessionId,
          vcpus: Number(ws.vcpus ?? 2),
          memMib: Number(ws.memMib ?? 2048),
          kernelRef: ws.kernelRef ?? "",
          rootfsRef: ws.rootfsRef ?? "",
        });
        publishEvent(ch, {
          type: "session.status",
          sessionId: job.sessionId,
          status: "running",
          connectUrl: result.connectUrl,
          nodeId: result.nodeId,
        });
      } else if (job.type === "session.stop") {
        await runtime.stop(job.sessionId);
        publishEvent(ch, { type: "session.status", sessionId: job.sessionId, status: "stopped" });
      }
      ch.ack(msg);
    } catch (err) {
      console.error("job failed:", err);
      publishEvent(ch, { type: "session.status", sessionId: job.sessionId, status: "failed" });
      ch.ack(msg); // ack to avoid poison-message redelivery loops; revisit with a DLQ
    }
  });
}

function publishEvent(ch: amqp.Channel, event: Record<string, unknown>) {
  ch.publish(EXCHANGE_EVENTS, "session.status", Buffer.from(JSON.stringify(event)), {
    persistent: true,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
