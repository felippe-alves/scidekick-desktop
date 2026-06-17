import type { TraceViewModel } from "../lib/traceView";
import { TraceGraph } from "./TraceGraph";

// Renders a claim's evidence trace as a colored requirement tree — the GUI twin of the
// TUI renderClaimTrace. Status drives the color: supported=green, incomplete=amber,
// unsupported=red.
export function TraceResultCard({ model }: { model: TraceViewModel }) {
  const variant =
    model.status === "supported" ? "supported" : model.status === "unsupported" ? "unsupported" : "incomplete";

  return (
    <div className={`trace-card trace-${variant}`}>
      <div className="trace-head">
        <span className="trace-title">claim trace</span>
        <span className="trace-badge">{model.status}</span>
      </div>
      <ul className="trace-list">
        {model.satisfied.map((s) => (
          <li key={`s-${s}`} className="trace-ok">
            <span className="trace-mark">✓</span>
            <span>{s}</span>
          </li>
        ))}
        {model.missing.map((m) => (
          <li key={`m-${m.requirement}`} className="trace-miss">
            <span className="trace-mark">✗</span>
            <span className="trace-req">{m.requirement}</span>
            {m.reason ? <span className="trace-reason">— {m.reason}</span> : null}
          </li>
        ))}
        {model.danglingRefs.length ? (
          <li className="trace-dangling">
            <span className="trace-mark">⚠</span>
            <span>dangling: {model.danglingRefs.join(", ")}</span>
          </li>
        ) : null}
        {model.cycle ? (
          <li className="trace-cycle">
            <span className="trace-mark">⤾</span>
            <span>cycle: {model.cycle.join(" → ")}</span>
          </li>
        ) : null}
      </ul>
      {model.graph && model.graph.nodes.length >= 2 ? (
        <details className="trace-graph-details" open>
          <summary>evidence graph · {model.graph.nodes.length} nodes</summary>
          <TraceGraph data={model.graph} />
        </details>
      ) : null}
    </div>
  );
}
