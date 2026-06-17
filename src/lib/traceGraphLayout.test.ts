import { describe, expect, it } from "vitest";
import { layoutTraceGraph, NODE_W, type TraceGraphData } from "./traceGraphLayout";

// A linear evidence chain: claim -> figure -> analysis -> dataset.
const chain: TraceGraphData = {
  nodes: [
    { id: "claim_1", kind: "claim", title: "X improves Y" },
    { id: "fig_1", kind: "figure", title: "Result figure" },
    { id: "an_1", kind: "analysis", title: "Primary analysis" },
    { id: "ds_1", kind: "dataset", title: "Calibration data" },
  ],
  edges: [
    { from: "claim_1", rel: "Supports", to: "fig_1" },
    { from: "fig_1", rel: "DerivedFrom", to: "an_1" },
    { from: "an_1", rel: "Uses", to: "ds_1" },
  ],
};

describe("layoutTraceGraph", () => {
  it("layers nodes left-to-right by BFS depth from the claim", () => {
    const layout = layoutTraceGraph(chain);
    const depth = Object.fromEntries(layout.nodes.map((n) => [n.id, n.depth]));
    expect(depth).toEqual({ claim_1: 0, fig_1: 1, an_1: 2, ds_1: 3 });

    // x increases with depth; the claim is at the left margin.
    const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));
    expect(x.claim_1).toBeLessThan(x.fig_1);
    expect(x.fig_1).toBeLessThan(x.an_1);
    expect(x.an_1).toBeLessThan(x.ds_1);

    // Width spans 4 columns; height fits a single row (each column has one node).
    expect(layout.width).toBeGreaterThan(4 * NODE_W);
    expect(layout.nodes.every((n) => n.y === layout.nodes[0].y)).toBe(true);
  });

  it("connects edges from a source's right edge to a target's left edge", () => {
    const layout = layoutTraceGraph(chain);
    for (const e of layout.edges) {
      expect(e.x2).toBeGreaterThan(e.x1); // forward flow, left to right
    }
    expect(layout.edges).toHaveLength(3);
  });

  it("places sibling evidence in the same column", () => {
    const fan: TraceGraphData = {
      nodes: [
        { id: "claim_1", kind: "claim", title: "C" },
        { id: "fig_1", kind: "figure", title: "F" },
        { id: "note_1", kind: "note", title: "decision" },
        { id: "note_2", kind: "note", title: "synthesis" },
      ],
      edges: [
        { from: "claim_1", rel: "Supports", to: "fig_1" },
        { from: "claim_1", rel: "DocumentedBy", to: "note_1" },
        { from: "claim_1", rel: "SynthesizedIn", to: "note_2" },
      ],
    };
    const layout = layoutTraceGraph(fan);
    const depth1 = layout.nodes.filter((n) => n.depth === 1);
    expect(depth1).toHaveLength(3);
    // Same column => same x, distinct stacked y (deterministic by id).
    expect(new Set(depth1.map((n) => n.x)).size).toBe(1);
    expect(new Set(depth1.map((n) => n.y)).size).toBe(3);
    expect(depth1.map((n) => n.id)).toEqual(["fig_1", "note_1", "note_2"]);
  });

  it("returns an empty layout for an empty graph", () => {
    expect(layoutTraceGraph({ nodes: [], edges: [] })).toEqual({
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    });
  });
});
