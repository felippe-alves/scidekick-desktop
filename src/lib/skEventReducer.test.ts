import { describe, expect, it } from "vitest";
import { parseSkEvent, type SkContent, type SkEvent } from "../types/scidekick";
import { reduceEvents } from "./skEventReducer";

// Static NDJSON fixture matching the new (vendored-pi) engine's `--print --mode json`
// output: a real session header line (consumed by the Rust side, not by reduceEvents),
// then the core agent_start → turn → message_* → tool_execution_* → agent_end stream.
const SESSION_NDJSON = [
  `{"type":"session","version":3,"id":"019ed082-a1dc-7e6d-aa77-fe07deddaed2","timestamp":"2026-06-16T12:58:02.588Z","cwd":"/tmp/proj"}`,
  `{"type":"agent_start"}`,
  `{"type":"turn_start"}`,
  `{"type":"message_start","message":{"role":"assistant","content":[]}}`,
  `{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"Working"}]}}`,
  `{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"plan it","redacted":false},{"type":"text","text":"Created the note."},{"type":"toolCall","id":"tool_1","name":"object_create","arguments":{"kind":"note","title":"x"}}]}}`,
  `{"type":"tool_execution_start","toolCallId":"tool_1","toolName":"object_create","args":{"kind":"note"}}`,
  `{"type":"tool_execution_end","toolCallId":"tool_1","toolName":"object_create","result":{"content":[{"type":"text","text":"Created note note_AB23"}],"details":{"id":"note_AB23"}},"isError":false}`,
  `{"type":"turn_end"}`,
  `{"type":"agent_end","messages":[]}`,
];

function parseAll(lines: string[]): SkEvent[] {
  return lines.map((l) => parseSkEvent(l)).filter((e): e is SkEvent => e !== null);
}

describe("parseSkEvent", () => {
  it("ignores blank / non-JSON lines", () => {
    expect(parseSkEvent("")).toBeNull();
    expect(parseSkEvent("not json")).toBeNull();
    expect(parseSkEvent("{ broken")).toBeNull();
  });

  it("parses the session header (Rust extracts the id; reduceEvents ignores it)", () => {
    const ev = parseSkEvent(SESSION_NDJSON[0]);
    expect(ev?.type).toBe("session");
  });

  it("tolerates unknown future event types without throwing", () => {
    const ev = parseSkEvent(`{"type":"queue_update","queued":2}`);
    expect(ev?.type).toBe("queue_update");
  });
});

describe("reduceEvents (the GUI's render reduction)", () => {
  it("reduces a real session into the final assistant message + tool execution", () => {
    const turn = reduceEvents(parseAll(SESSION_NDJSON));

    expect(turn.assistantMessages).toHaveLength(1);
    const blocks = turn.assistantMessages[0].content as SkContent[];
    expect(blocks.map((b) => b.type)).toEqual(["thinking", "text", "toolCall"]);

    const exec = turn.toolExecutions.get("tool_1");
    expect(exec?.status).toBe("complete");
    expect(exec?.toolName).toBe("object_create");
    expect(exec?.result).toMatchObject({ details: { id: "note_AB23" } });
  });

  it("carries the thinking.redacted flag (new schema; the old redactedThinking block is gone)", () => {
    const turn = reduceEvents(parseAll(SESSION_NDJSON));
    const thinking = (turn.assistantMessages[0].content as SkContent[])[0];
    expect(thinking.type).toBe("thinking");
    expect(thinking).toMatchObject({ type: "thinking", redacted: false });
  });

  it("marks a failed tool execution as error", () => {
    const turn = reduceEvents(
      parseAll([
        `{"type":"tool_execution_start","toolCallId":"t2","toolName":"bash","args":{}}`,
        `{"type":"tool_execution_end","toolCallId":"t2","toolName":"bash","result":{"content":[{"type":"text","text":"boom"}]},"isError":true}`,
      ]),
    );
    expect(turn.toolExecutions.get("t2")?.status).toBe("error");
  });

  it("does not pollute assistantMessages with non-assistant roles or unknown events", () => {
    const turn = reduceEvents(
      parseAll([
        `{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
        `{"type":"some_future_event","foo":1}`,
        `{"type":"session","id":"x"}`,
      ]),
    );
    expect(turn.assistantMessages).toHaveLength(0);
    expect(turn.toolExecutions.size).toBe(0);
  });
});
