// Canonical model + effort lists shared between the Composer and the
// Settings dialog. Sourced from scidekick's CLI (see `sk --list-models`
// and `THINKING_EFFORTS` in scidekick/packages/coding-agent). Future:
// populate from `sk --list-models` at startup.

export interface SelectOption {
  value: string;
  label: string;
}

export const MODEL_OPTIONS: SelectOption[] = [
  { value: "default", label: "Auto" },
  { value: "opus", label: "Claude Opus" },
  { value: "sonnet", label: "Claude Sonnet" },
  { value: "haiku", label: "Claude Haiku" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "o1", label: "o1" },
];

export const EFFORT_OPTIONS: SelectOption[] = [
  { value: "default", label: "Auto reasoning" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/// sk's `--approval-mode` values. `"default"` is the harness sentinel for
/// "do not pass --approval-mode" — sk falls back to its own
/// `tools.approvalMode` config in that case.
export interface ApprovalOption {
  value: "default" | "always-ask" | "write" | "yolo";
  label: string;
  hint: string;
}

export const APPROVAL_OPTIONS: ApprovalOption[] = [
  { value: "default", label: "sk default", hint: "Use sk's tools.approvalMode config." },
  { value: "always-ask", label: "Always ask", hint: "Prompt before every tool call." },
  { value: "write", label: "Auto reads", hint: "Reads run silently; writes still prompt." },
  { value: "yolo", label: "YOLO", hint: "Auto-approve everything." },
];
