import type { Model, Step } from "./types.ts";
import { MockComputer } from "./computer/mock.ts";
import { MockModel } from "./model/mock.ts";
import { ClaudeModel } from "./model/claude.ts";
import { reviewAction } from "./guard.ts";

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

export interface AgentJob {
  taskId: string;
  goal: string;
  maxSteps: number;
  model: string;
  workspace: { name?: string };
}

function makeModel(name: string): Model {
  return name === "claude" ? new ClaudeModel() : new MockModel();
}

// The observe -> think -> act -> guard -> record loop. Each iteration emits an
// agent.step event; the run ends on `finish`, max steps, a stop, or an error.
export async function runAgentTask(
  job: AgentJob,
  publish: (e: AgentEvent) => void,
  isStopped: () => boolean,
): Promise<void> {
  const computer = new MockComputer(job.workspace?.name ?? "workspace");
  let model: Model;
  try {
    model = makeModel(job.model);
  } catch (err) {
    publish({ type: "agent.status", taskId: job.taskId, status: "failed", result: String(err) });
    return;
  }

  publish({ type: "agent.status", taskId: job.taskId, status: "running" });
  const history: Step[] = [];

  try {
    for (let idx = 0; idx < job.maxSteps; idx++) {
      if (isStopped()) {
        publish({ type: "agent.status", taskId: job.taskId, status: "stopped" });
        return;
      }

      const obs = await computer.observe();
      const decision = await model.next(job.goal, obs, history);
      const verdict = reviewAction(decision.action);

      publish({
        type: "agent.step",
        taskId: job.taskId,
        idx,
        thought: decision.thought,
        actionType: decision.action.type,
        action: decision.action as unknown as Record<string, unknown>,
        observation: obs.text,
        blocked: !verdict.allowed,
      });
      history.push({
        idx,
        thought: decision.thought,
        action: decision.action,
        observation: obs.text,
        blocked: !verdict.allowed,
      });

      if (decision.action.type === "finish") {
        publish({
          type: "agent.status",
          taskId: job.taskId,
          status: "succeeded",
          result: decision.action.summary,
        });
        return;
      }
      if (verdict.allowed) await computer.act(decision.action);
      await Bun.sleep(400); // pace so the dashboard can show steps streaming
    }
    publish({
      type: "agent.status",
      taskId: job.taskId,
      status: "succeeded",
      result: "reached max steps",
    });
  } catch (err) {
    publish({ type: "agent.status", taskId: job.taskId, status: "failed", result: String(err) });
  } finally {
    await computer.close();
  }
}
