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
