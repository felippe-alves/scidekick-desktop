// Pure, deterministic layered layout for a claim's evidence subgraph. The engine's
// claim_evaluate result carries { nodes:[{id,kind,title}], edges:[{from,rel,to}] };
// we lay it out left-to-right by BFS depth from the claim so evidence flows outward
// (claim → figure/analysis → dataset/experiment). No DOM, no measurement — sizes are
// fixed — so the result is fully testable with plain assertions.

export interface TraceGraphNode {
  id: string;
  kind: string;
  title: string;
}

export interface TraceGraphEdge {
  from: string;
  rel: string;
  to: string;
}

export interface TraceGraphData {
  nodes: TraceGraphNode[];
  edges: TraceGraphEdge[];
}

export interface LaidOutNode extends TraceGraphNode {
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidOutEdge extends TraceGraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TraceGraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export const NODE_W = 132;
export const NODE_H = 40;
const COL_GAP = 56;
const ROW_GAP = 16;
const PAD = 10;

/**
 * Pick the root to layer from: the claim node, else a node with no incoming edge,
 * else the first node. Keeps layout deterministic for any subgraph shape.
 */
function pickRoot(nodes: TraceGraphNode[], edges: TraceGraphEdge[]): string | undefined {
  const claim = nodes.find((n) => n.kind === "claim");
  if (claim) return claim.id;
  const hasIncoming = new Set(edges.map((e) => e.to));
  const source = nodes.find((n) => !hasIncoming.has(n.id));
  return (source ?? nodes[0])?.id;
}

/** BFS shortest-path depth from root over directed edges; unreached nodes get depth 0. */
function computeDepths(nodes: TraceGraphNode[], edges: TraceGraphEdge[], root: string | undefined): Map<string, number> {
  const depth = new Map<string, number>();
  for (const n of nodes) depth.set(n.id, 0);
  if (!root) return depth;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)?.push(e.to);
  }

  const seen = new Set<string>([root]);
  let frontier = [root];
  let d = 0;
  depth.set(root, 0);
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        depth.set(to, d + 1);
        next.push(to);
      }
    }
    frontier = next;
    d += 1;
  }
  return depth;
}

export function layoutTraceGraph(data: TraceGraphData): TraceGraphLayout {
  const { nodes, edges } = data;
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const root = pickRoot(nodes, edges);
  const depth = computeDepths(nodes, edges, root);

  // Group by depth, ordered within a column by id for stable output.
  const byDepth = new Map<number, TraceGraphNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)?.push(n);
  }
  for (const col of byDepth.values()) col.sort((a, b) => a.id.localeCompare(b.id));

  const maxDepth = Math.max(...byDepth.keys());
  const maxRows = Math.max(...[...byDepth.values()].map((c) => c.length));

  const laidOut: LaidOutNode[] = [];
  const pos = new Map<string, LaidOutNode>();
  for (const [d, col] of byDepth) {
    col.forEach((n, row) => {
      const node: LaidOutNode = {
        ...n,
        depth: d,
        x: PAD + d * (NODE_W + COL_GAP),
        y: PAD + row * (NODE_H + ROW_GAP),
        w: NODE_W,
        h: NODE_H,
      };
      laidOut.push(node);
      pos.set(n.id, node);
    });
  }

  const laidOutEdges: LaidOutEdge[] = [];
  for (const e of edges) {
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) continue; // edge to a node not in the subgraph — skip
    laidOutEdges.push({
      ...e,
      x1: from.x + from.w,
      y1: from.y + from.h / 2,
      x2: to.x,
      y2: to.y + to.h / 2,
    });
  }

  const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  return { nodes: laidOut, edges: laidOutEdges, width, height };
}
