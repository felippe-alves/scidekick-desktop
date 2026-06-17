export type ToolId =
  | "research"
  | "terminal"
  | "browser"
  | "git"
  | "files"
  | "project-files"
  | "mcp"
  | "tasks"
  | "agents";

/// sk's approval-mode flag values. `"default"` is the harness sentinel for
/// "do not pass --approval-mode" — sk falls back to its own
/// `tools.approvalMode` config in that case.
export type ApprovalMode = "default" | "always-ask" | "write" | "yolo";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  description: string;
  tint: string;
  side: boolean;
  bottom: boolean;
}

export interface ComposerState {
  prompt: string;
  selectedAgentId: string;
  customCommand: string;
  customArgs: string;
  approvalMode: ApprovalMode;
  thinkingVisible: boolean;
  attachments: string[];
}
