export type ToolId = "terminal" | "browser" | "git" | "files" | "project-files" | "mcp" | "tasks" | "agents";

export type PermissionMode = "default" | "accept-edits" | "plan";

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
  planMode: boolean;
  permissionMode: PermissionMode;
  thinkingVisible: boolean;
  attachments: string[];
}
