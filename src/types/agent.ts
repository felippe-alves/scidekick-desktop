export type AgentProtocol = "scidekick-cli" | "acp" | "json-rpc";

export interface AgentDefinition {
  id: string;
  name: string;
  protocol: AgentProtocol;
  command: string;
  defaultArgs: string[];
  macos: boolean;
  linux: boolean;
  summary: string;
}

export interface AgentProbeResult {
  command: string;
  available: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface HarnessHealth {
  ok: boolean;
  storePath: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
}

export interface StartSessionRequest {
  agentId: string;
  workspacePath: string;
  prompt: string;
  command?: string;
  args?: string[];
  model?: string;
  thinkingEffort?: string;
  previousScidekickSessionId?: string;
  conversationId?: string;
}

export interface SessionRecord {
  id: string;
  conversationId?: string | null;
  agentId: string;
  workspacePath: string;
  prompt: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number;
  scidekickSessionId?: string | null;
  interrupted?: boolean;
}

export interface SessionStarted {
  id: string;
  agentId: string;
  workspacePath: string;
  prompt: string;
  command: string;
  args: string[];
  startedAt: number;
  scidekickSessionId: string | null;
  conversationId: string;
}

export interface SessionStreamPayload {
  sessionId: string;
  channel: "stdout" | "stderr";
  line: string;
}

export interface SessionCompletePayload {
  sessionId: string;
  record: SessionRecord;
}

export interface CommandRunResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ShellCommandRequest {
  workspacePath: string;
  command: string;
  args: string[];
}

export interface ComposerDefaults {
  selectedAgentId?: string | null;
  selectedModel?: string | null;
  thinkingEffort?: string | null;
  approvalMode?: string | null;
  lastWorkspacePath?: string | null;
}

export interface HarnessSettings {
  /** Per-agent binary path override. Absent or whitespace-only entries fall back to the registry default. */
  agentCommands: Record<string, string>;
  composer: ComposerDefaults;
}

export function emptyHarnessSettings(): HarnessSettings {
  return { agentCommands: {}, composer: {} };
}
