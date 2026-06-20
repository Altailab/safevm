import type { Model, Decision, Observation, Step } from "../types.ts";

// Scripted model: no API key needed. Produces a believable, goal-aware
// observe->act sequence that ends with `finish`, so the whole loop (events,
// guard, trajectory recording) is exercisable end-to-end. Swap in ClaudeModel
// for real autonomy.
export class MockModel implements Model {
  readonly name = "mock";

  async next(goal: string, _obs: Observation, history: Step[]): Promise<Decision> {
    const n = history.length;
    const plan: Decision[] = [
      { thought: `Goal: "${goal}". First, look at the screen.`, action: { type: "screenshot" } },
      { thought: "Open the application I need from the panel.", action: { type: "click", x: 48, y: 720 } },
      { thought: "Type the query relevant to the goal.", action: { type: "type", text: goal.slice(0, 64) } },
      { thought: "Submit it.", action: { type: "key", keys: "Return" } },
      { thought: "Verify the result from a terminal.", action: { type: "exec", command: "echo done" } },
      { thought: "Goal achieved.", action: { type: "finish", summary: `Completed: ${goal}` } },
    ];
    return plan[Math.min(n, plan.length - 1)];
  }
}
