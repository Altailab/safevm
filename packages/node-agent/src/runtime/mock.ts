import type { Runtime, StartSpec, StartResult } from "./types.ts";

// Mac-local dev runtime: no real VM. Pretends to boot and returns a fake
// connect URL so the full control-plane -> queue -> agent loop is runnable
// without Linux/KVM.
export class MockRuntime implements Runtime {
  readonly name = "mock";

  async start(spec: StartSpec): Promise<StartResult> {
    return {
      connectUrl: `http://localhost:6080/?session=${spec.sessionId}`,
      nodeId: "mock-node",
    };
  }

  async stop(_sessionId: string): Promise<void> {
    // no-op
  }
}
