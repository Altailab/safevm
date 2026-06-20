// A Runtime is the isolation backend that actually boots a workspace.
// MVP ships two: `mock` (no real VM, for Mac-local dev) and `firecracker`
// (Linux + KVM microVM). Kata/QEMU can implement the same interface later.

export interface StartSpec {
  sessionId: string;
  vcpus: number;
  memMib: number;
  kernelRef: string;
  rootfsRef: string;
}

export interface StartResult {
  connectUrl: string; // streaming endpoint the browser dials
  nodeId: string;
}

export interface Runtime {
  readonly name: string;
  start(spec: StartSpec): Promise<StartResult>;
  stop(sessionId: string): Promise<void>;
  // Session IDs currently alive on this node (for stale-status reconciliation).
  // Optional: runtimes that can't enumerate (mock) omit it.
  list?(): Promise<string[]>;
}
