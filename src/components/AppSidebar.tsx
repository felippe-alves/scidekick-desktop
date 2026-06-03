import {
  Bot,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MoreHorizontal,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { AgentProbeResult, HarnessHealth, SessionRecord, Workspace } from "../types/agent";

interface AppSidebarProps {
  workspaces: Workspace[];
  sessions: SessionRecord[];
  activeWorkspace: Workspace | null;
  activeConversationId: string | null;
  workspacePath: string;
  busy: boolean;
  health: HarnessHealth | null;
  probe: AgentProbeResult | null;
  onWorkspacePathChange: (path: string) => void;
  onOpenWorkspacePath: () => void;
  onPickWorkspace: () => void;
  onSelectWorkspace: (path: string) => void;
  onRemoveWorkspace: (id: string) => void;
  onSelectSession: (session: SessionRecord) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}

export function AppSidebar({
  workspaces,
  sessions,
  activeWorkspace,
  activeConversationId,
  workspacePath,
  busy,
  health,
  probe,
  onWorkspacePathChange,
  onOpenWorkspacePath,
  onPickWorkspace,
  onSelectWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onNewChat,
  onOpenSettings,
}: AppSidebarProps) {
  const conversations = conversationSummaries(sessions);
  return (
    <aside className="app-sidebar">
      <div className="sidebar-titlebar">
        <span className="brand-mark">Scidekick</span>
      </div>

      <div className="sidebar-actions">
        <button className="new-chat-btn" disabled={!activeWorkspace || busy} onClick={onNewChat} type="button">
          <SquarePen size={14} />
          New chat
        </button>
        <button className="new-chat-btn secondary" disabled={busy} onClick={onPickWorkspace} type="button" title="Open project">
          <FolderPlus size={14} />
        </button>
      </div>

      <form className="sidebar-search" onSubmit={(event) => { event.preventDefault(); onOpenWorkspacePath(); }}>
        <Search size={13} />
        <input
          value={workspacePath}
          onChange={(event) => onWorkspacePathChange(event.target.value)}
          placeholder="Paste folder path"
        />
        <button disabled={busy || workspacePath.trim() === ""} type="submit">Open</button>
      </form>

      <div className={health?.ok ? "connection ok" : "connection"}>
        <span />
        <strong>{health?.ok ? "Connected" : "Not connected"}</strong>
        {probe?.available ? <small>· {probe.stdout.trim()}</small> : null}
      </div>

      <div className="sidebar-scroll">
        <section className="project-block">
          <div className="sidebar-heading">
            <span>Projects</span>
            <small>{workspaces.length}</small>
          </div>
          {workspaces.length === 0 ? <p className="sidebar-empty">Open a project folder to start.</p> : null}
          {workspaces.map((workspace) => (
            <div className="project-row-group" key={workspace.id}>
              <button
                className={workspace.path === activeWorkspace?.path ? "project-row active" : "project-row"}
                onClick={() => onSelectWorkspace(workspace.path)}
                type="button"
              >
                <FolderOpen size={14} />
                <span>{workspace.name}</span>
                <small>{conversationCountForWorkspace(sessions, workspace.path)}</small>
              </button>
              <div className="project-hover-actions">
                <button type="button" title="New chat" onClick={onNewChat}><SquarePen size={12} /></button>
                <button type="button" title="Remove" onClick={() => onRemoveWorkspace(workspace.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </section>

        <section className="project-block nested">
          <div className="sidebar-heading">
            <span>Chats</span>
            <small>{conversations.length}</small>
          </div>
          {activeWorkspace ? <div className="branch-chip"><GitBranch size={11} /> main</div> : null}
          {conversations.map((conversation, index) => (
            <button
              className={conversation.id === activeConversationId ? "session-row active" : "session-row"}
              key={conversation.id}
              onClick={() => onSelectSession(conversation.latest)}
              type="button"
            >
              <span className="session-agent-icon"><Bot size={12} /></span>
              <span className="session-text">
                <strong>{conversation.title || `Chat ${index + 1}`}</strong>
                <small>
                  {conversation.latest.agentId}
                  {conversation.turns > 1 ? ` · ${conversation.turns} turns` : ""}
                </small>
              </span>
              <MoreHorizontal className="row-more" size={13} />
            </button>
          ))}
          {conversations.length === 0 ? <p className="sidebar-empty">No chats yet.</p> : null}
        </section>
      </div>

      <div className="sidebar-footer">
        <button type="button" onClick={onOpenSettings}>
          <Settings size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
}

interface ConversationSummary {
  id: string;
  title: string;
  latest: SessionRecord;
  earliestStartedAt: number;
  turns: number;
}

function conversationSummaries(sessions: SessionRecord[]): ConversationSummary[] {
  const byId = new Map<string, ConversationSummary>();
  for (const session of sessions) {
    const id = conversationIdForSession(session);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        title: session.prompt,
        latest: session,
        earliestStartedAt: session.startedAt,
        turns: 1,
      });
      continue;
    }
    existing.turns += 1;
    if (session.startedAt > existing.latest.startedAt) existing.latest = session;
    if (session.startedAt < existing.earliestStartedAt) {
      existing.earliestStartedAt = session.startedAt;
      existing.title = session.prompt;
    }
  }
  return [...byId.values()].sort((a, b) => b.latest.startedAt - a.latest.startedAt);
}

function conversationCountForWorkspace(sessions: SessionRecord[], path: string): number {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (session.workspacePath === path) ids.add(conversationIdForSession(session));
  }
  return ids.size;
}

function conversationIdForSession(session: SessionRecord): string {
  return session.conversationId ?? session.id;
}
