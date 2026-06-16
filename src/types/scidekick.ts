// Subset of Scidekick's `--mode json` NDJSON events that we render.
// Source: scidekick/packages/agent/src/types.ts (AgentEvent) +
//         scidekick/packages/ai/src/types.ts (Message + content).
// We keep this loose to tolerate schema drift across sk versions.

export type SkRole = "user" | "developer" | "assistant" | "toolResult";

export type SkContent =
  | { type: "text"; text: string; textSignature?: string }
  | { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }
  | { type: "toolCall"; id: string; name: string; arguments?: unknown }
  | { type: "image"; mimeType?: string; source?: unknown };

export interface SkMessage {
  role: SkRole;
  content: string | SkContent[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  model?: string;
  provider?: string;
}

export type SkEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: SkMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: SkMessage; toolResults?: SkMessage[] }
  | { type: "message_start"; message: SkMessage }
  | { type: "message_update"; message: SkMessage; assistantMessageEvent?: unknown }
  | { type: "message_end"; message: SkMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      intent?: string;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      partialResult?: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result?: unknown;
      isError?: boolean;
    };

export interface SkToolExecution {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}

/**
 * Parse one NDJSON line into an SkEvent, or null if the line is not a recognised event.
 */
export function parseSkEvent(line: string): SkEvent | null {
  if (!line || !line.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(line) as { type?: unknown };
    if (typeof parsed.type !== "string") return null;
    return parsed as SkEvent;
  } catch {
    return null;
  }
}
