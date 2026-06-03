import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { ChatSurface } from "./components/ChatSurface";
import { Composer } from "./components/Composer";
import { SettingsDialog } from "./components/SettingsDialog";
import { ToolPanels } from "./components/ToolPanels";
import { ToolPicker } from "./components/ToolPicker";
import { parseCommandLine, readError } from "./lib/commandLine";
import {
  addWorkspace,
  getSettings,
  gitStatus,
  harnessHealth,
  listenSessionComplete,
  listenSessionStream,
  listSessions,
  listSupportedAgents,
  listWorkspaceFiles,
  listWorkspaces,
  pickAgentBinary,
  pickAttachments,
  pickWorkspaceDirectory,
  probeAgent,
  removeWorkspace,
  runShellCommand,
  startAgentSession,
  stopAgentSession,
  updateSettings,
} from "./lib/tauri";
import {
  emptyHarnessSettings,
  type AgentDefinition,
  type AgentProbeResult,
  type CommandRunResult,
  type FileEntry,
  type HarnessHealth,
  type HarnessSettings,
  type SessionRecord,
  type Workspace,
} from "./types/agent";
import type { ApprovalMode, ToolId } from "./types/ui";
import { parseSkEvent, type SkEvent } from "./types/scidekick";

export interface RunningSession {
  id: string;
  prompt: string;
  agentId: string;
  workspacePath: string;
  startedAt: number;
  stdout: string;
  stderr: string;
  events: SkEvent[];
  scidekickSessionId: string | null;
  conversationId: string;
}

const SCIDEKICK_PROBE_ARGS = ["--version"] as const;
const DEFAULT_PROMPT = "";

export function App() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("scidekick");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("{prompt}");
  const [probe, setProbe] = useState<AgentProbeResult | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacePath, setWorkspacePath] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [runningSession, setRunningSession] = useState<RunningSession | null>(null);
  const runningSessionRef = useRef<RunningSession | null>(null);
  const pendingStreamsRef = useRef<
    Map<string, { stdout: string; stderr: string; events: SkEvent[]; scidekickSessionId: string | null }>
  >(new Map());
  const [git, setGit] = useState<CommandRunResult | null>(null);
  const [commandLine, setCommandLine] = useState("pwd");
  const [commandResult, setCommandResult] = useState<CommandRunResult | null>(null);
  const [health, setHealth] = useState<HarnessHealth | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeTool, setActiveTool] = useState<ToolId>("project-files");
  const [bottomTools, setBottomTools] = useState<ToolId[]>([]);
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  // approvalMode is derived from settings.composer.approvalMode; persistence
  // happens through persistComposerChange below.
  const [thinkingEffort, setThinkingEffort] = useState<string>("default");
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [activeScidekickSessionId, setActiveScidekickSessionId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<HarnessSettings>(emptyHarnessSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0],
    [agents, selectedAgentId],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.path === workspacePath) ?? null,
    [workspacePath, workspaces],
  );

  const activeConversationSessions = useMemo(() => {
    if (!activeConversationId) return [];
    return sessions.filter((session) => conversationIdForSession(session) === activeConversationId);
  }, [activeConversationId, sessions]);

  // Approval mode is the single source of truth for the --approval-mode
  // flag. We derive it from settings.composer.approvalMode and guard the
  // string against legacy values that may live in old harness-store.json
  // files (e.g. the obsolete "accept-edits").
  const approvalMode: ApprovalMode = useMemo(() => {
    const raw = settings.composer.approvalMode;
    if (raw === "always-ask" || raw === "write" || raw === "yolo" || raw === "default") {
      return raw;
    }
    return "default";
  }, [settings.composer.approvalMode]);


  useEffect(() => {
    let cancelled = false;

    async function safeCall<T>(label: string, fn: () => Promise<T>, onOk: (value: T) => void) {
      try {
        onOk(await fn());
      } catch (err) {
        console.error(`[scidekick-desktop] ${label} failed:`, err);
      }
    }

    async function load() {
      let loadedSettings: HarnessSettings = emptyHarnessSettings();
      await safeCall("getSettings", getSettings, (value) => {
        if (cancelled) return;
        loadedSettings = value;
        setSettings(value);
        const composer = value.composer;
        if (composer.selectedAgentId) setSelectedAgentId(composer.selectedAgentId);
        if (composer.selectedModel) setSelectedModel(composer.selectedModel);
        if (composer.thinkingEffort) setThinkingEffort(composer.thinkingEffort);
      });
      await safeCall("harnessHealth", harnessHealth, (value) => { if (!cancelled) setHealth(value); });
      await safeCall("listSupportedAgents", listSupportedAgents, (value) => { if (!cancelled) setAgents(value); });
      await safeCall("listWorkspaces", listWorkspaces, (value) => {
        if (cancelled) return;
        setWorkspaces(value);
        if (!workspacePath) {
          const preferred = loadedSettings.composer.lastWorkspacePath;
          const fallback = value[0]?.path ?? "";
          const next = preferred && value.some((w) => w.path === preferred) ? preferred : fallback;
          setWorkspacePath(next);
        }
      });
      await safeCall("listSessions", listSessions, (value) => {
        if (cancelled) return;
        setSessions(value);
        setActiveConversationId(value[0] ? conversationIdForSession(value[0]) : null);
        setActiveScidekickSessionId(value[0] ? scidekickSessionIdForSession(value[0]) : null);
      });

      if (cancelled) return;

      // Probe whichever binary the user has configured (override > registry default).
      const scidekickCommand =
        loadedSettings.agentCommands.scidekick?.trim() || "sk";
      try {
        const result = await probeAgent(scidekickCommand, [...SCIDEKICK_PROBE_ARGS]);
        if (!cancelled) setProbe(result);
      } catch (err) {
        console.error("[scidekick-desktop] probeAgent failed:", err);
      }

      if (!cancelled) setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      setFiles([]);
      setGit(null);
      return;
    }

    async function loadWorkspaceTools() {
      try {
        const [nextFiles, nextGit] = await Promise.all([
          listWorkspaceFiles(workspacePath, 100),
          gitStatus(workspacePath).catch(() => null),
        ]);
        if (cancelled) return;
        setFiles(nextFiles);
        setGit(nextGit);
      } catch (err) {
        if (!cancelled) setError(readError(err));
      }
    }

    void loadWorkspaceTools();

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // Persist the last opened workspace so the harness reopens to where the
  // user was. Skip when settings haven't loaded yet (empty path) or the
  // value already matches what we just hydrated.
  useEffect(() => {
    if (!workspacePath) return;
    setSettings((current) => {
      if (current.composer.lastWorkspacePath === workspacePath) return current;
      const next: HarnessSettings = {
        ...current,
        composer: { ...current.composer, lastWorkspacePath: workspacePath },
      };
      void updateSettings(next).catch((err) =>
        console.error("[scidekick-desktop] updateSettings(lastWorkspacePath) failed:", err),
      );
      return next;
    });
  }, [workspacePath]);

  useEffect(() => {
    let active = true;
    let unlistenStream: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;

    void (async () => {
      try {
        const stream = await listenSessionStream((payload) => {
          const pending = pendingStreamsRef.current.get(payload.sessionId) ?? {
            stdout: "",
            stderr: "",
            events: [],
            scidekickSessionId: null,
          };
          if (payload.channel === "stdout") {
            const headerId = tryExtractSessionId(payload.line);
            if (headerId && !pending.scidekickSessionId) {
              pending.scidekickSessionId = headerId;
            }
            const parsedEvent = parseSkEvent(payload.line);
            if (parsedEvent) {
              pending.events = [...pending.events, parsedEvent];
            } else {
              pending.stdout += `${payload.line}\n`;
            }
          } else {
            pending.stderr += `${payload.line}\n`;
          }
          pendingStreamsRef.current.set(payload.sessionId, pending);

          setRunningSession((current) => {
            if (!current || current.id !== payload.sessionId) return current;
            const next: RunningSession = {
              ...current,
              stdout: pending.stdout,
              stderr: pending.stderr,
              events: pending.events,
              scidekickSessionId:
                pending.scidekickSessionId ?? current.scidekickSessionId,
            };
            runningSessionRef.current = next;
            return next;
          });
        });
        const complete = await listenSessionComplete((payload) => {
          pendingStreamsRef.current.delete(payload.sessionId);
          setStoppingSessionId((current) => (current === payload.sessionId ? null : current));
          setRunningSession((current) => {
            if (!current || current.id !== payload.sessionId) return current;
            setActiveConversationId(
              payload.record.conversationId ?? current.conversationId,
            );
            setActiveScidekickSessionId(
              payload.record.scidekickSessionId ?? current.scidekickSessionId,
            );
            runningSessionRef.current = null;
            return null;
          });
          setSessions((current) => [
            payload.record,
            ...current.filter((session) => session.id !== payload.record.id),
          ]);
          void listSessions().then(setSessions).catch(() => {});
        });

        if (!active) {
          stream();
          complete();
          return;
        }
        unlistenStream = stream;
        unlistenComplete = complete;
      } catch (err) {
        console.error("[scidekick-desktop] failed to subscribe to session events:", err);
      }
    })();

    return () => {
      active = false;
      unlistenStream?.();
      unlistenComplete?.();
    };
  }, []);

  async function handleOpenWorkspacePath() {
    await openWorkspacePath(workspacePath);
  }

  async function handlePickWorkspace() {
    await runBusy(async () => {
      const selected = await pickWorkspaceDirectory();
      if (selected) await openWorkspacePath(selected, false);
    });
  }

  async function openWorkspacePath(path: string, manageBusy = true) {
    const action = async () => {
      const next = await addWorkspace(path);
      setWorkspaces(next);
      setWorkspacePath(next[0]?.path ?? path);
    };
    if (manageBusy) await runBusy(action);
    else await action();
  }

  async function handleRemoveWorkspace(id: string) {
    await runBusy(async () => {
      const next = await removeWorkspace(id);
      setWorkspaces(next);
      setWorkspacePath(next[0]?.path ?? "");
    });
  }

  async function handleStartSession(event: FormEvent) {
    event.preventDefault();
    if (!selectedAgent || !workspacePath) return;
    if (runningSession) return;
    if (prompt.trim() === "") return;

    const sentPrompt = prompt;
    const sentAttachments = attachments;
    const isScidekick = selectedAgent.id === "scidekick";
    const followUpSid =
      isScidekick && activeScidekickSessionId ? activeScidekickSessionId : undefined;
    const conversationId = activeConversationId ?? undefined;

    setError(null);
    setPrompt("");
    // Clear attachments optimistically; restore on failure so the user does
    // not lose their selection.
    setAttachments([]);

    try {
      const started = await startAgentSession({
        agentId: selectedAgent.id,
        workspacePath,
        prompt: sentPrompt,
        command: isScidekick ? undefined : customCommand,
        args: isScidekick ? undefined : parseCommandLine(customArgs),
        model: isScidekick && selectedModel !== "default" ? selectedModel : undefined,
        thinkingEffort:
          isScidekick && thinkingEffort !== "default" ? thinkingEffort : undefined,
        approvalMode:
          isScidekick && approvalMode !== "default" ? approvalMode : undefined,
        attachments:
          isScidekick && sentAttachments.length > 0 ? sentAttachments : undefined,
        previousScidekickSessionId: followUpSid,
        conversationId,
      });
      const pending = pendingStreamsRef.current.get(started.id) ?? {
        stdout: "",
        stderr: "",
        events: [] as SkEvent[],
        scidekickSessionId: null as string | null,
      };
      const next: RunningSession = {
        id: started.id,
        prompt: started.prompt,
        agentId: started.agentId,
        workspacePath: started.workspacePath,
        startedAt: started.startedAt,
        conversationId: started.conversationId,
        stdout: pending.stdout,
        stderr: pending.stderr,
        events: pending.events,
        scidekickSessionId:
          pending.scidekickSessionId ?? started.scidekickSessionId,
      };
      runningSessionRef.current = next;
      setRunningSession(next);
      setActiveConversationId(started.conversationId);
      setActiveScidekickSessionId(
        next.scidekickSessionId ?? activeScidekickSessionId,
      );
    } catch (err) {
      console.error("[scidekick-desktop] startAgentSession failed:", err);
      setError(readError(err));
      setPrompt(sentPrompt);
      setAttachments(sentAttachments);
    }
  }

  async function handleStopSession() {
    const current = runningSessionRef.current;
    if (!current) return;
    if (stoppingSessionId === current.id) return;
    setStoppingSessionId(current.id);
    try {
      await stopAgentSession(current.id);
      // We do not clear runningSession here — the wait thread still has to
      // drain stdio and emit session-complete with the final SessionRecord
      // (interrupted: true). The existing listener clears runningSession.
    } catch (err) {
      console.error("[scidekick-desktop] stopAgentSession failed:", err);
      setError(readError(err));
      setStoppingSessionId(null);
    }
  }

  function persistComposerChange(patch: Partial<HarnessSettings["composer"]>) {
    // Mirror the change into local state immediately for snappy UI,
    // then push to disk asynchronously. We swallow write errors because the
    // user already sees the new value reflected; a failure surfaces on
    // the next legitimate operation.
    setSettings((current) => {
      const next: HarnessSettings = {
        ...current,
        composer: { ...current.composer, ...patch },
      };
      void updateSettings(next).catch((err) =>
        console.error("[scidekick-desktop] updateSettings failed:", err),
      );
      return next;
    });
  }

  function handleSelectedAgentIdChange(id: string) {
    setSelectedAgentId(id);
    persistComposerChange({ selectedAgentId: id });
  }

  function handleSelectedModelChange(model: string) {
    setSelectedModel(model);
    persistComposerChange({ selectedModel: model });
  }

  function handleThinkingEffortChange(effort: string) {
    setThinkingEffort(effort);
    persistComposerChange({ thinkingEffort: effort });
  }

  function handleApprovalModeChange(mode: ApprovalMode) {
    persistComposerChange({ approvalMode: mode });
  }

  async function handlePickAttachments() {
    try {
      const picked = await pickAttachments();
      if (picked.length === 0) return;
      setAttachments((current) => {
        const known = new Set(current);
        const additions = picked.filter((path) => !known.has(path));
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    } catch (err) {
      console.error("[scidekick-desktop] pickAttachments failed:", err);
      setError(readError(err));
    }
  }

  async function handleNewChat() {
    // Stop any running session before resetting conversation state — otherwise
    // the session-complete handler will overwrite the freshly cleared
    // activeConversationId with the now-dead conversation's id.
    const running = runningSessionRef.current;
    if (running) {
      try {
        await stopAgentSession(running.id);
      } catch (err) {
        console.error("[scidekick-desktop] stopAgentSession during new chat failed:", err);
      }
      runningSessionRef.current = null;
      setRunningSession(null);
      setStoppingSessionId(null);
    }
    setActiveConversationId(null);
    setActiveScidekickSessionId(null);
    setPrompt(DEFAULT_PROMPT);
  }

  function handleOpenSettings() {
    setSettingsOpen(true);
  }

  async function handleSaveSettings(next: HarnessSettings) {
    const saved = await updateSettings(next);
    setSettings(saved);
    // Re-probe immediately so the sidebar status reflects the new binary.
    const command = saved.agentCommands.scidekick?.trim() || "sk";
    try {
      setProbe(await probeAgent(command, [...SCIDEKICK_PROBE_ARGS]));
    } catch (err) {
      console.error("[scidekick-desktop] probeAgent after save failed:", err);
    }
    // Apply the latest composer defaults to live state in case the user
    // changed them through the dialog instead of the composer toolbar.
    const composer = saved.composer;
    if (composer.selectedAgentId) setSelectedAgentId(composer.selectedAgentId);
    if (composer.selectedModel) setSelectedModel(composer.selectedModel);
    if (composer.thinkingEffort) setThinkingEffort(composer.thinkingEffort);
  }

  async function handleGitStatus() {
    if (!workspacePath) return;
    await runBusy(async () => {
      setGit(await gitStatus(workspacePath));
    });
  }

  async function handleRefreshFiles() {
    if (!workspacePath) return;
    await runBusy(async () => {
      setFiles(await listWorkspaceFiles(workspacePath, 100));
    });
  }

  async function handleRunCommand(event: FormEvent) {
    event.preventDefault();
    if (!workspacePath) return;
    const parts = parseCommandLine(commandLine);
    const command = parts[0];
    if (!command) return;

    await runBusy(async () => {
      setCommandResult(await runShellCommand({ workspacePath, command, args: parts.slice(1) }));
    });
  }

  function handleToggleBottomTool(tool: ToolId) {
    setBottomTools((current) => {
      if (current.includes(tool)) return current.filter((item) => item !== tool);
      return [...current, tool].slice(-2);
    });
    setActiveTool(tool);
  }

  function handleRightResizeStart(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setRightPanelWidth(Math.min(560, Math.max(280, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function runBusy(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      console.error("[scidekick-desktop] runBusy failed:", err);
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="harnss-shell">
      <AppSidebar
        workspaces={workspaces}
        sessions={sessions}
        activeWorkspace={activeWorkspace}
        activeConversationId={activeConversationId}
        workspacePath={workspacePath}
        busy={busy}
        health={health}
        probe={probe}
        onWorkspacePathChange={setWorkspacePath}
        onOpenWorkspacePath={handleOpenWorkspacePath}
        onPickWorkspace={handlePickWorkspace}
        onSelectWorkspace={setWorkspacePath}
        onRemoveWorkspace={handleRemoveWorkspace}
        onSelectSession={(session) => {
          setActiveConversationId(conversationIdForSession(session));
          setActiveScidekickSessionId(scidekickSessionIdForSession(session));
        }}
        onNewChat={handleNewChat}
        onOpenSettings={handleOpenSettings}
      />

      <section className={bottomTools.length > 0 ? "workspace-area with-bottom-dock" : "workspace-area"}>
        <ChatSurface
          activeWorkspace={activeWorkspace}
          activeSessions={activeConversationSessions}
          runningSession={runningSession}
          busy={busy}
          error={error}
          loading={loading}
          stopping={stoppingSessionId !== null && runningSession?.id === stoppingSessionId}
          onStop={handleStopSession}
          onPickWorkspace={handlePickWorkspace}
        >
          <Composer
            agents={agents}
            selectedAgentId={selectedAgentId}
            customCommand={customCommand}
            customArgs={customArgs}
            prompt={prompt}
            busy={busy || runningSession !== null}
            workspaceReady={!!activeWorkspace}
            approvalMode={approvalMode}
            selectedModel={selectedModel}
            thinkingEffort={thinkingEffort}
            attachments={attachments}
            onSelectedAgentIdChange={handleSelectedAgentIdChange}
            onCustomCommandChange={setCustomCommand}
            onCustomArgsChange={setCustomArgs}
            onPromptChange={setPrompt}
            onApprovalModeChange={handleApprovalModeChange}
            onSelectedModelChange={handleSelectedModelChange}
            onThinkingEffortChange={handleThinkingEffortChange}
            onAddAttachment={handlePickAttachments}
            onRemoveAttachment={(path) => setAttachments((current) => current.filter((item) => item !== path))}
            onSubmit={handleStartSession}
          />
        </ChatSurface>

        <ToolPicker
          activeSideTool={activeTool}
          bottomTools={bottomTools}
          onSelectSideTool={setActiveTool}
          onToggleBottomTool={handleToggleBottomTool}
        />

        <ToolPanels
          activeTool={activeTool}
          bottomTools={bottomTools}
          agents={agents}
          files={files}
          git={git}
          commandLine={commandLine}
          commandResult={commandResult}
          sessions={sessions}
          activeWorkspace={activeWorkspace}
          busy={busy}
          rightPanelWidth={rightPanelWidth}
          onRightResizeStart={handleRightResizeStart}
          onRefreshFiles={handleRefreshFiles}
          onRefreshGit={handleGitStatus}
          onCommandLineChange={setCommandLine}
          onRunCommand={handleRunCommand}
          onCloseBottomTool={(tool) => setBottomTools((current) => current.filter((item) => item !== tool))}
        />
      </section>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        scidekickProbe={probe}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        onPickBinary={pickAgentBinary}
        onProbeBinary={(command) => probeAgent(command, [...SCIDEKICK_PROBE_ARGS])}
      />
    </main>
  );
}

function conversationIdForSession(session: SessionRecord): string {
  return session.conversationId ?? session.id;
}

function scidekickSessionIdForSession(session: SessionRecord): string | null {
  if (session.agentId !== "scidekick") return null;
  if (session.scidekickSessionId) return session.scidekickSessionId;
  for (const line of session.stdout.split("\n")) {
    const id = tryExtractSessionId(line);
    if (id) return id;
  }
  return null;
}
/**
 * Try to extract the Scidekick session ID from a JSON line that looks like
 * {"type":"session","id":"<uuid>",...}. Returns the ID string or null.
 */
function tryExtractSessionId(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  // Quick check before parsing — avoid JSON.parse for non-matching lines
  if (!trimmed.includes('"session"')) return null;
  try {
    const obj = JSON.parse(trimmed) as { type?: unknown; id?: unknown };
    if (obj.type === "session" && typeof obj.id === "string" && obj.id.length > 8) {
      return obj.id;
    }
  } catch {
    // not valid JSON
  }
  return null;
}
