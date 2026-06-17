import { describe, expect, it } from "vitest";
import { extractTraceView } from "./traceView";

// Shaped exactly like the claim_evaluate AgentToolResult the engine streams (tool result
// has { content, details }; details carries the TraceResult fields).
const incompleteResult = {
  content: [{ type: "text", text: "Claim claim_X support: incomplete" }],
  details: {
    status: "incomplete",
    satisfied: ["evidence", "data-lineage"],
    missing: [
      { requirement: "experiment", reason: "no reachable experiment or run" },
      { requirement: "code-commit", reason: "no provenance.git" },
    ],
    danglingRefs: ["fig_FAKE"],
  },
};

describe("extractTraceView", () => {
  it("extracts status, satisfied, missing, and dangling from a claim_evaluate result", () => {
    const m = extractTraceView(incompleteResult);
    expect(m).not.toBeNull();
    expect(m?.status).toBe("incomplete");
    expect(m?.satisfied).toEqual(["evidence", "data-lineage"]);
    expect(m?.missing.map((x) => x.requirement)).toEqual(["experiment", "code-commit"]);
    expect(m?.missing[0].reason).toMatch(/no reachable experiment/);
    expect(m?.danglingRefs).toEqual(["fig_FAKE"]);
  });

  it("handles a supported claim and a cycle", () => {
    expect(extractTraceView({ details: { status: "supported", satisfied: ["evidence"], missing: [], danglingRefs: [] } })?.status).toBe("supported");
    const cyc = extractTraceView({ details: { status: "unsupported", satisfied: [], missing: [], danglingRefs: [], cycle: ["a", "b", "a"] } });
    expect(cyc?.cycle).toEqual(["a", "b", "a"]);
  });

  it("returns null for results that are not a claim trace", () => {
    expect(extractTraceView(undefined)).toBeNull();
    expect(extractTraceView({ content: [{ type: "text", text: "Created note" }], details: { id: "note_1" } })).toBeNull();
    expect(extractTraceView({ content: [{ type: "text", text: "x" }] })).toBeNull();
    expect(extractTraceView("plain string")).toBeNull();
  });

  it("extracts the evidence subgraph when the engine emits one", () => {
    const m = extractTraceView({
      details: {
        status: "supported",
        satisfied: ["evidence"],
        missing: [],
        danglingRefs: [],
        graph: {
          nodes: [
            { id: "claim_1", kind: "claim", title: "C" },
            { id: "fig_1", kind: "figure", title: "F" },
          ],
          edges: [{ from: "claim_1", rel: "Supports", to: "fig_1" }],
        },
      },
    });
    expect(m?.graph?.nodes.map((n) => n.id)).toEqual(["claim_1", "fig_1"]);
    expect(m?.graph?.edges).toEqual([{ from: "claim_1", rel: "Supports", to: "fig_1" }]);
  });

  it("drops edges that point at nodes outside the subgraph, and tolerates a missing graph", () => {
    const m = extractTraceView({
      details: {
        status: "incomplete",
        satisfied: [],
        missing: [],
        danglingRefs: ["ghost"],
        graph: {
          nodes: [{ id: "claim_1", kind: "claim", title: "C" }],
          edges: [{ from: "claim_1", rel: "Supports", to: "ghost" }],
        },
      },
    });
    // The dangling edge to "ghost" is dropped; the node still extracts.
    expect(m?.graph?.nodes.map((n) => n.id)).toEqual(["claim_1"]);
    expect(m?.graph?.edges).toEqual([]);

    // Older engine with no graph field at all still yields a valid view model.
    const old = extractTraceView({ details: { status: "supported", satisfied: [], missing: [], danglingRefs: [] } });
    expect(old?.status).toBe("supported");
    expect(old?.graph).toBeUndefined();
  });
});
