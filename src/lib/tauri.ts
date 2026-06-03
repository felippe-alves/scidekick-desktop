import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentDefinition,
  AgentProbeResult,
  CommandRunResult,
  FileEntry,
  HarnessHealth,
  HarnessSettings,
  SessionCompletePayload,
  SessionRecord,
  SessionStarted,
  SessionStreamPayload,
  ShellCommandRequest,
  StartSessionRequest,
  Workspace,
} from "../types/agent";

export function harnessHealth(): Promise<HarnessHealth> {
  return invoke("harness_health");
}

export function listSupportedAgents(): Promise<AgentDefinition[]> {
  return invoke("list_supported_agents");
}

export function probeAgent(command: string, args: string[]): Promise<AgentProbeResult> {
  return invoke("probe_agent", { command, args });
}

export function listWorkspaces(): Promise<Workspace[]> {
  return invoke("list_workspaces");
}

export function addWorkspace(path: string): Promise<Workspace[]> {
  return invoke("add_workspace", { path });
}

export function removeWorkspace(id: string): Promise<Workspace[]> {
  return invoke("remove_workspace", { id });
}

export function listSessions(): Promise<SessionRecord[]> {
  return invoke("list_sessions");
}

export function startAgentSession(request: StartSessionRequest): Promise<SessionStarted> {
  return invoke("start_agent_session", { request });
}

export function stopAgentSession(sessionId: string): Promise<boolean> {
  return invoke("stop_agent_session", { sessionId });
}

export function getSettings(): Promise<HarnessSettings> {
  return invoke("get_settings");
}

export function updateSettings(settings: HarnessSettings): Promise<HarnessSettings> {
  return invoke("update_settings", { settings });
}

export function listenSessionStream(
  handler: (event: SessionStreamPayload) => void,
): Promise<UnlistenFn> {
  return listen<SessionStreamPayload>("session-stream", (event) => handler(event.payload));
}

export function listenSessionComplete(
  handler: (event: SessionCompletePayload) => void,
): Promise<UnlistenFn> {
  return listen<SessionCompletePayload>("session-complete", (event) => handler(event.payload));
}

export function gitStatus(workspacePath: string): Promise<CommandRunResult> {
  return invoke("git_status", { workspacePath });
}

export function runShellCommand(request: ShellCommandRequest): Promise<CommandRunResult> {
  return invoke("run_shell_command", { request });
}

export function listWorkspaceFiles(workspacePath: string, limit = 80): Promise<FileEntry[]> {
  return invoke("list_workspace_files", { workspacePath, limit });
}

export async function pickWorkspaceDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: "Open Workspace" });
  return typeof selected === "string" ? selected : null;
}

export async function pickAgentBinary(): Promise<string | null> {
  // Single-file picker for an agent binary; we validate by re-probing
  // rather than trying to detect executability up-front.
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Choose agent binary",
  });
  return typeof selected === "string" ? selected : null;
}

/// Multi-file picker for attaching files to a turn. sk reads `@<path>`
/// tokens in the prompt, so the consumer side is responsible for prepending
/// the `@` prefix; this wrapper just returns absolute paths.
export async function pickAttachments(): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: "Attach files",
  });
  if (!selected) return [];
  const list = Array.isArray(selected) ? selected : [selected];
  return list.filter((value): value is string => typeof value === "string");
}
