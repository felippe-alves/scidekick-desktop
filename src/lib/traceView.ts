// Pure extraction of a claim_evaluate tool result into a trace-view model the GUI renders
// as a colored requirement tree (mirrors the TUI's renderClaimTrace). The data is already
// in-stream: the engine forwards {status,satisfied,missing,danglingRefs,cycle} in the
// claim_evaluate tool result's `details`.

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
  };
}
