import { useEffect, useMemo, useRef } from "react";
import { Brain, FolderOpen, Hammer, Square, Terminal } from "lucide-react";
import { stripAnsi } from "../lib/commandLine";
import { parseSkEvent, type SkContent, type SkEvent, type SkMessage } from "../types/scidekick";
import { reduceEvents, type ReducedTurn } from "../lib/skEventReducer";
import { extractTraceView } from "../lib/traceView";
import { TraceResultCard } from "./TraceResultCard";
import { Markdown } from "./Markdown";
import type { RunningSession } from "../App";
import type { SessionRecord, Workspace } from "../types/agent";

interface ChatSurfaceProps {
  activeWorkspace: Workspace | null;
  activeSessions: SessionRecord[];
  runningSession: RunningSession | null;
  busy: boolean;
  error: string | null;
  loading?: boolean;
  stopping?: boolean;
  onPickWorkspace: () => void;
  onStop?: () => void;
  children: React.ReactNode;
}

export function ChatSurface({
  activeWorkspace,
  activeSessions,
  runningSession,
  error,
  loading,
  stopping,
  onPickWorkspace,
  onStop,
  children,
}: ChatSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runningSession || !scrollRef.current) return;
    const el = scrollRef.current;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom < 200) el.scrollTop = el.scrollHeight;
  }, [
    activeSessions.length,
    runningSession?.events.length,
    runningSession?.stdout,
    runningSession?.stderr,
    runningSession?.id,
  ]);

  const completedTurns = useMemo(
    () => [...activeSessions].sort((a, b) => a.startedAt - b.startedAt),
    [activeSessions],
  );
  const showCompleted = completedTurns.length > 0;
  const showWelcome = !loading && !runningSession && !showCompleted;

  const headerSubtitle =
    completedTurns[0]?.prompt ?? runningSession?.prompt ?? "New chat";

  return (
    <section className="chat-island island">
      <header className="chat-header">
        <div className="chat-title-group">
          <p>{activeWorkspace?.name ?? "No project"}</p>
          <h1>{headerSubtitle}</h1>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="chat-scroll" ref={scrollRef}>
        {loading ? <LoadingState /> : null}
        {showCompleted ? completedTurns.map((session) => (
          <CompletedSession key={session.id} session={session} />
        )) : null}
        {runningSession ? (
          <Transcript
            prompt={runningSession.prompt}
            agentId={runningSession.agentId}
            stdout={runningSession.stdout}
            stderr={runningSession.stderr}
            events={runningSession.events}
            status="running"
            exitCode={null}
            interrupted={false}
            stopping={stopping}
            onStop={onStop}
          />
        ) : null}
        {showWelcome ? (
          <WelcomeState activeWorkspace={activeWorkspace} onPickWorkspace={onPickWorkspace} />
        ) : null}
      </div>

      {children}
    </section>
  );
}

function WelcomeState({
  activeWorkspace,
  onPickWorkspace,
}: {
  activeWorkspace: Workspace | null;
  onPickWorkspace: () => void;
}) {
  if (activeWorkspace) {
    return (
      <div className="welcome-stage">
        <div className="welcome-card">
          <h2>
            Ready in <em>{activeWorkspace.name}</em>
          </h2>
          <p className="welcome-lede">
            Send a prompt to Scidekick, or pick another adapter from the composer.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="welcome-stage">
      <div className="welcome-card">
        <h2>Scidekick Desktop</h2>
        <p className="welcome-lede">A focused workspace for Scidekick and other coding agents.</p>
        <button className="welcome-cta" onClick={onPickWorkspace} type="button">
          <FolderOpen size={14} />
          Open a project folder
        </button>
      </div>
    </div>
  );
}

function CompletedSession({ session }: { session: SessionRecord }) {
  // Re-parse the stored stdout into events when the session was scidekick + JSON mode.
  const events = useMemo<SkEvent[]>(() => {
    if (session.agentId !== "scidekick" || !session.stdout) return [];
    const out: SkEvent[] = [];
    for (const line of session.stdout.split("\n")) {
      const event = parseSkEvent(line);
      if (event) out.push(event);
    }
    return out;
  }, [session.agentId, session.stdout]);

  // If we have events, we already see the prompt as a user message in them. Otherwise fall back to raw.
  const hasEvents = events.length > 0;
  const rawStdout = hasEvents ? "" : session.stdout;
  return (
    <Transcript
      prompt={session.prompt}
      agentId={session.agentId}
      stdout={rawStdout}
      stderr={session.stderr}
      events={events}
      status={(session.exitCode ?? 0) === 0 ? "complete" : "error"}
      exitCode={session.exitCode}
      interrupted={session.interrupted ?? false}
    />
  );
}

interface TranscriptProps {
  prompt: string;
  agentId: string;
  stdout: string;
  stderr: string;
  events: SkEvent[];
  status: "running" | "complete" | "error";
  exitCode: number | null;
  interrupted: boolean;
  stopping?: boolean;
  onStop?: () => void;
}

function Transcript({
  prompt,
  agentId,
  stdout,
  stderr,
  events,
  status,
  exitCode,
  interrupted,
  stopping,
  onStop,
}: TranscriptProps) {
  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  const stderrLines = cleanStderr.split("\n").filter(Boolean);
  const hasStderr = stderrLines.length > 0;
  const isRunning = status === "running";

  // Reduce the structured events into per-message snapshots + tool executions.
  const turn = useMemo(() => reduceEvents(events), [events]);
  const hasStructured = turn.assistantMessages.length > 0 || turn.toolExecutions.size > 0;

  return (
    <article className="transcript">
      <div className="message user-message">
        <div className="bubble user-bubble">{prompt}</div>
      </div>

      <div className={`message agent-message ${status}`}>
        <div className="bubble">
          {hasStructured ? (
            <AssistantBlocks turn={turn} />
          ) : cleanStdout ? (
            <div className="agent-stream">{cleanStdout}</div>
          ) : null}

          {isRunning ? (
            <div className="running-indicator">
              <span className="caret" />
              <span>
                {stopping
                  ? "Stopping…"
                  : turn.assistantMessages.length === 0
                    ? "Thinking"
                    : "Working"}
              </span>
              {onStop ? (
                <button
                  type="button"
                  className="stop-button"
                  onClick={onStop}
                  disabled={stopping}
                  aria-label="Stop running session"
                >
                  <Square size={11} strokeWidth={2.2} />
                  <span>{stopping ? "Stopping" : "Stop"}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {hasStderr ? (
            <details className={`tool-event ${status === "error" ? "error" : ""}`} open={status === "error"}>
              <summary>
                <span className="tool-event-icon">
                  <Terminal size={12} />
                </span>
                <strong>stderr</strong>
                <span>
                  {stderrLines.length} line{stderrLines.length === 1 ? "" : "s"}
                </span>
              </summary>
              <pre>{cleanStderr}</pre>
            </details>
          ) : null}

          {!isRunning ? (
            <div className="agent-footer">
              <span>{agentId}</span>
              <span>·</span>
              <span>exit {exitCode ?? "?"}</span>
              {interrupted ? (
                <>
                  <span>·</span>
                  <span className="agent-footer-flag">interrupted</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// reduceEvents + ReducedTurn now live in ../lib/skEventReducer.ts

function AssistantBlocks({ turn }: { turn: ReducedTurn }) {
  const blocks: SkContent[] = [];
  for (const msg of turn.assistantMessages) {
    if (typeof msg.content === "string") {
      blocks.push({ type: "text", text: msg.content });
    } else {
      for (const block of msg.content) blocks.push(block);
    }
  }

  return (
    <div className="assistant-blocks">
      {blocks.map((block, i) => {
        if (block.type === "thinking") {
          return <ThinkingBlock key={i} text={block.redacted ? "[redacted]" : block.thinking} redacted={block.redacted} />;
        }
        if (block.type === "text") {
          return <Markdown key={i}>{stripAnsi(block.text)}</Markdown>;
        }
        if (block.type === "toolCall") {
          const exec = turn.toolExecutions.get(block.id);
          if (block.name === "claim_evaluate") {
            const trace = extractTraceView(exec?.result);
            if (trace) return <TraceResultCard key={i} model={trace} />;
          }
          return (
            <ToolCallCard
              key={i}
              name={block.name}
              args={block.arguments}
              status={exec?.status ?? "running"}
              result={exec?.result}
            />
          );
        }
        return (
          <div key={i} className="agent-stream unknown-block">
            [unsupported block: {(block as { type?: string }).type ?? "unknown"}]
          </div>
        );
      })}
    </div>
  );
}

function ThinkingBlock({ text, redacted }: { text: string; redacted?: boolean }) {
  const wordCount = redacted ? 0 : text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <details className="thinking-block" open>
      <summary>
        <span className="thinking-icon">
          <Brain size={12} />
        </span>
        <strong>Thinking</strong>
        {redacted ? <span>redacted</span> : <span>{wordCount} word{wordCount === 1 ? "" : "s"}</span>}
      </summary>
      <div className="thinking-text">{text}</div>
    </details>
  );
}

function ToolCallCard({
  name,
  args,
  status,
  result,
}: {
  name: string;
  args?: unknown;
  status: "running" | "complete" | "error";
  result?: unknown;
}) {
  const argsLine = formatArgs(args);
  const hasResult = result !== undefined && result !== null;
  return (
    <details className={`tool-call ${status}`} open={status === "error"}>
      <summary>
        <span className="tool-call-icon">
          <Hammer size={12} />
        </span>
        <strong>{name}</strong>
        {argsLine ? <code>{argsLine}</code> : null}
        <span className="tool-call-status">{statusLabel(status)}</span>
      </summary>
      {hasResult ? <pre>{formatResult(result)}</pre> : null}
    </details>
  );
}

function statusLabel(status: "running" | "complete" | "error"): string {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "done";
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return truncate(args, 90);
  try {
    return truncate(JSON.stringify(args), 90);
  } catch {
    return "";
  }
}

function formatResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function LoadingState() {
  return (
    <div className="loading-stage">
      <div className="orbital" aria-hidden />
      <p>Connecting to backend</p>
    </div>
  );
}
