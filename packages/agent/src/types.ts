// Shared types for the agent runner.

// What the agent can do to the computer it operates.
export type AgentAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string }
  | { type: "scroll"; dx: number; dy: number }
  | { type: "exec"; command: string }
  | { type: "wait"; ms: number }
  | { type: "finish"; summary: string };

// What the agent perceives each turn.
export interface Observation {
  text: string; // textual description / accessibility summary
  screenshot?: string; // base64 PNG, when the computer provides one
}

// One model decision: optional reasoning + the action to take.
export interface Decision {
  thought?: string;
  action: AgentAction;
}

// A recorded loop iteration (history fed back to the model).
export interface Step {
  idx: number;
  thought?: string;
  action: AgentAction;
  observation: string;
  blocked: boolean;
}

// The computer the agent drives (the workspace). Pluggable, like the node-agent
// isolation runtime: `mock` for key-free local dev, real VNC/Firecracker later.
export interface Computer {
  readonly name: string;
  observe(): Promise<Observation>;
  act(action: AgentAction): Promise<void>;
  close(): Promise<void>;
}

// The decision-maker. `mock` is scripted; `claude` uses Anthropic computer-use.
export interface Model {
  readonly name: string;
  next(goal: string, observation: Observation, history: Step[]): Promise<Decision>;
}
