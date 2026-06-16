// Pure reduction of a Scidekick `--mode json` NDJSON event stream into the model the
// chat surface renders. Extracted from ChatSurface so it can be unit-tested against
// captured engine output (the deterministic stand-in for launching the GUI).

import type { SkEvent, SkMessage } from "../types/scidekick";

export interface ReducedTurn {
  assistantMessages: SkMessage[];
  toolExecutions: Map<
    string,
    { toolCallId: string; toolName: string; args?: unknown; result?: unknown; status: "running" | "complete" | "error" }
  >;
}

export function reduceEvents(events: SkEvent[]): ReducedTurn {
  const assistantMessages: SkMessage[] = [];
  const toolExecutions = new Map<string, ReducedTurn["toolExecutions"] extends Map<string, infer V> ? V : never>();

  // Track the index of the last in-progress assistant message so message_update can replace it.
  let openAssistantIndex = -1;

  for (const event of events) {
    switch (event.type) {
      case "message_start": {
        if (event.message.role === "assistant") {
          assistantMessages.push(event.message);
          openAssistantIndex = assistantMessages.length - 1;
        }
        break;
      }
      case "message_update": {
        if (event.message.role === "assistant" && openAssistantIndex >= 0) {
          assistantMessages[openAssistantIndex] = event.message;
        }
        break;
      }
      case "message_end": {
        if (event.message.role === "assistant" && openAssistantIndex >= 0) {
          assistantMessages[openAssistantIndex] = event.message;
          openAssistantIndex = -1;
        }
        break;
      }
      case "tool_execution_start": {
        toolExecutions.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
        });
        break;
      }
      case "tool_execution_update": {
        const existing = toolExecutions.get(event.toolCallId);
        if (existing) {
          toolExecutions.set(event.toolCallId, {
            ...existing,
            args: event.args ?? existing.args,
          });
        }
        break;
      }
      case "tool_execution_end": {
        const existing = toolExecutions.get(event.toolCallId) ?? {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: undefined,
          status: "complete" as const,
        };
        toolExecutions.set(event.toolCallId, {
          ...existing,
          result: event.result,
          status: event.isError ? "error" : "complete",
        });
        break;
      }
      default:
        // Unknown / not-yet-handled event types (session header, turn_*, agent_*, and any
        // newer engine events) are intentionally ignored here — never throw on drift.
        break;
    }
  }

  return { assistantMessages, toolExecutions };
}
