import type { AgentAction } from "./types.ts";

// Safety guard: vet each action before it touches the computer. This is the
// human-in-the-loop / policy seam from docs/ai-agents.md. Blocked actions are
// recorded (not executed); a future version escalates them for human approval
// instead of silently skipping.
export interface Verdict {
  allowed: boolean;
  reason?: string;
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash)\b/, // pipe-to-shell
  /\b:\(\)\s*\{.*\}\s*;/, // fork bomb
];

export function reviewAction(action: AgentAction): Verdict {
  if (action.type === "exec") {
    const hit = DANGEROUS_PATTERNS.find((re) => re.test(action.command));
    if (hit) return { allowed: false, reason: `blocked dangerous command (${hit.source})` };
  }
  return { allowed: true };
}
