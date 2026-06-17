import {
  ArrowRightToLine,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Loader2,
  Plug,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { formatBytes } from "../lib/commandLine";
import { getTool, TOOL_ICONS } from "../lib/tools";
import type { AgentDefinition, CommandRunResult, FileEntry, SessionRecord, Workspace } from "../types/agent";
import type { ToolId } from "../types/ui";
import { ResearchPanel } from "./ResearchPanel";

interface ToolPanelsProps {
  activeTool: ToolId;
  bottomTools: ToolId[];
  agents: AgentDefinition[];
  files: FileEntry[];
  git: CommandRunResult | null;
  commandLine: string;
  commandResult: CommandRunResult | null;
  sessions: SessionRecord[];
  activeWorkspace: Workspace | null;
  busy: boolean;
  rightPanelWidth: number;
  onRightResizeStart: (event: React.MouseEvent) => void;
  onRefreshFiles: () => void;
  onRefreshGit: () => void;
  onCommandLineChange: (value: string) => void;
  onRunCommand: (event: React.FormEvent) => void;
  onCloseBottomTool: (tool: ToolId) => void;
}

export function ToolPanels(props: ToolPanelsProps) {
  return (
    <>
      <div className="resize-col" onMouseDown={props.onRightResizeStart}><span /></div>
      <aside className="tools-column" style={{ width: props.rightPanelWidth }}>
        <PanelShell tool={props.activeTool} grow>
          <ToolContent {...props} tool={props.activeTool} />
        </PanelShell>
      </aside>
      {props.bottomTools.length > 0 ? (
        <section className="bottom-dock">
          {props.bottomTools.map((tool) => (
            <PanelShell key={tool} tool={tool} onClose={() => props.onCloseBottomTool(tool)}>
              <ToolContent {...props} tool={tool} compact />
            </PanelShell>
          ))}
        </section>
      ) : null}
    </>
  );
}

function PanelShell({
  tool,
  grow,
  onClose,
  children,
}: {
  tool: ToolId;
  grow?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const def = getTool(tool);
  const Icon = TOOL_ICONS[tool];
  return (
    <section className={grow ? "tool-island island grow" : "tool-island island bottom-tool"}>
      <div className="panel-header">
        <div>
          <Icon size={14} />
          <h2>{def.label}</h2>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} title="Move to side">
            <ArrowRightToLine size={13} />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ToolContent(props: ToolPanelsProps & { tool: ToolId; compact?: boolean }) {
  switch (props.tool) {
    case "research":
      return <ResearchPanel activeWorkspace={props.activeWorkspace} />;
    case "terminal":
      return <TerminalPanel {...props} />;
    case "browser":
      return <BrowserPanel />;
    case "git":
      return <GitPanel {...props} />;
    case "files":
      return <OpenFilesPanel sessions={props.sessions} />;
    case "project-files":
      return <ProjectFilesPanel files={props.files} busy={props.busy} onRefresh={props.onRefreshFiles} />;
    case "mcp":
      return <McpPanel />;
    case "agents":
      return <AgentsPanel agents={props.agents} />;
    case "tasks":
      return <TasksPanel sessions={props.sessions} />;
  }
}

function ProjectFilesPanel({ files, busy, onRefresh }: { files: FileEntry[]; busy: boolean; onRefresh: () => void }) {
  return (
    <div className="panel-body">
      <div className="panel-action-row">
        <span>{files.length} visible entries</span>
        <button disabled={busy} onClick={onRefresh} type="button"><RefreshCw size={13} /> Refresh</button>
      </div>
      <div className="file-list rich">
        {files.map((file) => (
          <div className="file-item" key={file.path}>
            <span>{file.isDir ? <FolderTree size={13} /> : <FileText size={13} />}</span>
            <strong>{file.name}</strong>
            <small>{file.isDir ? "folder" : formatBytes(file.size)}</small>
          </div>
        ))}
      </div>
      {files.length === 0 ? <p className="muted">No project files loaded.</p> : null}
    </div>
  );
}

function OpenFilesPanel({ sessions }: { sessions: SessionRecord[] }) {
  const recent = sessions.slice(0, 8);
  return (
    <div className="panel-body">
      {recent.map((session) => (
        <div className="open-file-card" key={session.id}>
          <FileText size={14} />
          <div>
            <strong>{session.agentId} transcript</strong>
            <small>{session.prompt}</small>
          </div>
        </div>
      ))}
      {recent.length === 0 ? <p className="muted">Files touched by agent turns will appear here.</p> : null}
    </div>
  );
}

function GitPanel({ git, busy, activeWorkspace, onRefreshGit }: ToolPanelsProps) {
  const lines = git?.stdout.split("\n").filter(Boolean) ?? [];
  return (
    <div className="panel-body git-panel-body">
      <div className="repo-card">
        <div className="repo-title">
          <GitBranch size={14} />
          <strong>{activeWorkspace?.name ?? "No repository"}</strong>
          <button disabled={busy || !activeWorkspace} onClick={onRefreshGit} type="button"><RefreshCw size={13} /></button>
        </div>
        <div className="branch-picker"><GitBranch size={12} /> {parseBranch(lines[0])}</div>
      </div>
      <div className="change-groups">
        {lines.slice(1).map((line) => (
          <div className="change-row" key={line}>
            <span>{line.slice(0, 2).trim() || "?"}</span>
            <strong>{line.slice(3)}</strong>
          </div>
        ))}
      </div>
      {lines.length <= 1 ? <p className="muted">Working tree appears clean or git status is unavailable.</p> : null}
      {git?.stderr ? <pre>{git.stderr}</pre> : null}
    </div>
  );
}

function TerminalPanel({ commandLine, commandResult, busy, activeWorkspace, onCommandLineChange, onRunCommand }: ToolPanelsProps) {
  return (
    <div className="panel-body terminal-panel-body">
      <div className="terminal-tabs">
        <button className="active" type="button"><Terminal size={13} /> shell</button>
        <button type="button">+</button>
      </div>
      <form className="command-form" onSubmit={onRunCommand}>
        <input value={commandLine} onChange={(event) => onCommandLineChange(event.target.value)} placeholder="workspace command" />
        <button disabled={busy || !activeWorkspace || commandLine.trim() === ""} type="submit">Run</button>
      </form>
      <OutputBlock result={commandResult} empty="Run a workspace command. Full PTY tabs come next." />
    </div>
  );
}

function BrowserPanel() {
  return (
    <div className="panel-body browser-start">
      <Globe size={24} />
      <h3>Browser panel</h3>
      <p>Harnss exposes tabbed webviews, history, inspect mode, and grabbed page elements. This shell reserves the dock surface.</p>
      <button type="button"><ExternalLink size={13} /> Open research tab</button>
    </div>
  );
}

function McpPanel() {
  return (
    <div className="panel-body mcp-list">
      {['filesystem', 'github', 'screenpipe'].map((server) => (
        <div className="mcp-row" key={server}>
          <Plug size={13} />
          <strong>{server}</strong>
          <span>not connected</span>
        </div>
      ))}
    </div>
  );
}

function AgentsPanel({ agents }: { agents: AgentDefinition[] }) {
  return (
    <div className="panel-body agent-list">
      {agents.map((agent) => (
        <article className="agent-card" key={agent.id}>
          <div>
            <h3>{agent.name}</h3>
            <span>{agent.protocol}</span>
          </div>
          <p>{agent.summary}</p>
          <code>{agent.command} {agent.defaultArgs.join(" ")}</code>
        </article>
      ))}
    </div>
  );
}

function TasksPanel({ sessions }: { sessions: SessionRecord[] }) {
  return (
    <div className="panel-body task-list">
      <div className="task-row complete"><CheckCircle2 size={14} /> Open workspace shell</div>
      <div className="task-row complete"><CheckCircle2 size={14} /> Wire Tauri commands</div>
      <div className="task-row"><Loader2 size={14} /> Rich session event stream</div>
      <small>{sessions.length} completed agent turns</small>
    </div>
  );
}

function OutputBlock({ result, empty }: { result: CommandRunResult | null; empty: string }) {
  if (!result) return <p className="muted">{empty}</p>;
  return (
    <div>
      <p className="command-line"><code>{result.command}</code> · exit {result.exitCode ?? "unknown"}</p>
      {result.stdout ? <pre>{result.stdout}</pre> : null}
      {result.stderr ? <pre>{result.stderr}</pre> : null}
    </div>
  );
}

function parseBranch(firstLine: string | undefined): string {
  if (!firstLine) return "main";
  return firstLine.replace(/^##\s*/, "");
}
