import type { Model, Decision, Observation, Step, AgentAction } from "../types.ts";

// Real autonomy via Anthropic computer use. SKELETON — structurally complete but
// only usable with (a) ANTHROPIC_API_KEY and (b) a Computer that supplies real
// screenshots (the `mock` computer does not). Default model is `mock`; this
// plugs in once the Firecracker/VNC tier provides pixels + input injection.
//
// Computer use sends the screenshot each turn and the model replies with a
// `tool_use` describing the next UI action. See the Anthropic computer-use docs
// for the exact tool schema / beta header (verify before production use).
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.AGENT_MODEL_ID ?? "claude-opus-4-8";

export class ClaudeModel implements Model {
  readonly name = "claude";
  private apiKey: string;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ClaudeModel needs ANTHROPIC_API_KEY. Use model=mock for key-free local runs.",
      );
    }
    this.apiKey = key;
  }

  async next(goal: string, obs: Observation, history: Step[]): Promise<Decision> {
    if (!obs.screenshot) {
      throw new Error(
        "ClaudeModel requires real screenshots — run against a screenshot-capable " +
          "Computer (VNC/Firecracker), not the mock computer.",
      );
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        // Computer-use is gated behind a beta header; verify the current value.
        "anthropic-beta": "computer-use-2025-01-24",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [
          { type: "computer_20250124", name: "computer", display_width_px: 1280, display_height_px: 720 },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Goal: ${goal}\nSteps so far: ${history.length}` },
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: obs.screenshot },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    };

    const text = data.content.find((c) => c.type === "text")?.text;
    const tool = data.content.find((c) => c.type === "tool_use");
    return { thought: text, action: toAction(tool?.input ?? {}) };
  }
}

// Map a computer-use tool_use input to our AgentAction. Best-effort; expand as
// more action variants are wired.
function toAction(input: Record<string, unknown>): AgentAction {
  const a = (input.action as string) ?? "wait";
  const coord = (input.coordinate as [number, number]) ?? [0, 0];
  switch (a) {
    case "screenshot":
      return { type: "screenshot" };
    case "left_click":
      return { type: "click", x: coord[0], y: coord[1] };
    case "type":
      return { type: "type", text: String(input.text ?? "") };
    case "key":
      return { type: "key", keys: String(input.text ?? "") };
    default:
      return { type: "wait", ms: 500 };
  }
}
