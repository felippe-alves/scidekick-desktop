// Pure extraction of a claim_evaluate tool result into a trace-view model the GUI renders
// as a colored requirement tree (mirrors the TUI's renderClaimTrace) plus a node-link
// evidence graph. The data is already in-stream: the engine forwards
// {status,satisfied,missing,danglingRefs,cycle,reachable,graph} in the tool result's
// `details`.

import type { TraceGraphData, TraceGraphEdge, TraceGraphNode } from "./traceGraphLayout";

export interface TraceMissing {
  requirement: string;
  reason: string;
}

export interface TraceViewModel {
  status: string; // "supported" | "incomplete" | "unsupported" | "unverified"
  satisfied: string[];
  missing: TraceMissing[];
  danglingRefs: string[];
  cycle?: string[];
  /** Reachable evidence subgraph, present on engines that emit it (older ones don't). */
  graph?: TraceGraphData;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Returns a trace model from a claim_evaluate AgentToolResult, or null if it isn't one. */
export function extractTraceView(result: unknown): TraceViewModel | null {
  const details = (result as { details?: unknown } | null | undefined)?.details;
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (typeof d.status !== "string") return null;

  const missing = Array.isArray(d.missing)
    ? d.missing
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .map((m) => ({
          requirement: typeof m.requirement === "string" ? m.requirement : "requirement",
          reason: typeof m.reason === "string" ? m.reason : "",
        }))
    : [];
  const cycle = strArray(d.cycle);

  return {
    status: d.status,
    satisfied: strArray(d.satisfied),
    missing,
    danglingRefs: strArray(d.danglingRefs),
    cycle: cycle.length ? cycle : undefined,
    graph: extractGraph(d.graph),
  };
}

/** Parse the optional evidence subgraph, tolerating older engines that omit it. */
function extractGraph(raw: unknown): TraceGraphData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return undefined;

  const nodes: TraceGraphNode[] = g.nodes
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .filter((n) => typeof n.id === "string")
    .map((n) => ({
      id: n.id as string,
      kind: typeof n.kind === "string" ? n.kind : "object",
      title: typeof n.title === "string" ? n.title : (n.id as string),
    }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges: TraceGraphEdge[] = g.edges
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .filter((e) => typeof e.from === "string" && typeof e.to === "string")
    .filter((e) => ids.has(e.from as string) && ids.has(e.to as string))
    .map((e) => ({
      from: e.from as string,
      rel: typeof e.rel === "string" ? e.rel : "",
      to: e.to as string,
    }));

  if (nodes.length === 0) return undefined;
  return { nodes, edges };
}
