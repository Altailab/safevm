import type { Computer, Observation, AgentAction } from "../types.ts";

// Mock computer: no real VM. Returns a synthetic textual observation and logs
// actions. Mirrors the node-agent `mock` runtime so the full agent loop runs
// without a desktop. Real impls drive the workspace over VNC (KasmVNC input
// injection) or a guest agent over vsock for the Firecracker tier.
export class MockComputer implements Computer {
  readonly name = "mock";
  private steps = 0;

  constructor(private workspaceName: string) {}

  async observe(): Promise<Observation> {
    this.steps += 1;
    return {
      text: `[mock desktop "${this.workspaceName}"] XFCE desktop, a file manager and a browser are open. (observation #${this.steps})`,
    };
  }

  async act(action: AgentAction): Promise<void> {
    // No-op: a real computer would inject the input / run the command.
    console.log(`  · mock act: ${JSON.stringify(action)}`);
  }

  async close(): Promise<void> {}
}
