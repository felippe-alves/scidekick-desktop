import { useMemo } from "react";
import { layoutTraceGraph, type TraceGraphData } from "../lib/traceGraphLayout";

// Node-link rendering of a claim's evidence subgraph (SVG, no external deps). The
// layout is computed by the pure layoutTraceGraph; this component only maps the
// positioned nodes/edges to SVG. Node fill is driven by kind via CSS classes.

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function TraceGraph({ data }: { data: TraceGraphData }) {
  const layout = useMemo(() => layoutTraceGraph(data), [data]);
  if (layout.nodes.length === 0) return null;

  return (
    <div className="trace-graph-wrap">
      <svg
        className="trace-graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="claim evidence graph"
      >
        <defs>
          <marker
            id="trace-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" className="trace-edge-arrow" />
          </marker>
        </defs>
        {layout.edges.map((e) => (
          <line
            key={`${e.from}-${e.rel}-${e.to}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            className="trace-edge"
            markerEnd="url(#trace-arrow)"
          >
            <title>{e.rel}</title>
          </line>
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id} className={`trace-node trace-node-${n.kind}`} transform={`translate(${n.x},${n.y})`}>
            <rect width={n.w} height={n.h} rx="6" />
            <text className="trace-node-kind" x="9" y="15">
              {n.kind}
            </text>
            <text className="trace-node-title" x="9" y="30">
              {truncate(n.title, 18)}
            </text>
            <title>
              {n.kind}: {n.title} ({n.id})
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}
