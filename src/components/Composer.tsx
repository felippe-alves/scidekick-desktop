import { ArrowUp, ChevronDown, Paperclip } from "lucide-react";
import { EFFORT_OPTIONS, MODEL_OPTIONS } from "../lib/agentOptions";
import type { AgentDefinition } from "../types/agent";
import type { PermissionMode } from "../types/ui";

interface ComposerProps {
  agents: AgentDefinition[];
  selectedAgentId: string;
  customCommand: string;
  customArgs: string;
  prompt: string;
  busy: boolean;
  workspaceReady: boolean;
  permissionMode: PermissionMode;
  selectedModel: string;
  thinkingEffort: string;
  attachments: string[];
  onSelectedAgentIdChange: (id: string) => void;
  onCustomCommandChange: (command: string) => void;
  onCustomArgsChange: (args: string) => void;
  onPromptChange: (prompt: string) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onSelectedModelChange: (model: string) => void;
  onThinkingEffortChange: (effort: string) => void;
  onAddAttachment: () => void;
  onRemoveAttachment: (name: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function Composer({
  agents,
  selectedAgentId,
  customCommand,
  customArgs,
  prompt,
  busy,
  workspaceReady,
  permissionMode,
  selectedModel,
  thinkingEffort,
  attachments,
  onSelectedAgentIdChange,
  onCustomCommandChange,
  onCustomArgsChange,
  onPromptChange,
  onPermissionModeChange,
  onSelectedModelChange,
  onThinkingEffortChange,
  onAddAttachment,
  onRemoveAttachment,
  onSubmit,
}: ComposerProps) {
  const sendDisabled = busy || !workspaceReady || prompt.trim() === "";
  const isScidekick = selectedAgentId === "scidekick";

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (sendDisabled) return;
    onSubmit(event as unknown as React.FormEvent);
  }

  return (
    <form className="composer" data-chat-composer onSubmit={onSubmit}>
      <div className="composer-input-shell">
        {prompt.trim() === "" ? (
          <div className="composer-placeholder">Ask Scidekick</div>
        ) : null}
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          spellCheck={false}
        />
      </div>

      {attachments.length > 0 ? (
        <div className="attachment-strip">
          {attachments.map((attachment) => (
            <button key={attachment} type="button" onClick={() => onRemoveAttachment(attachment)}>
              <Paperclip size={12} />
              {attachment}
            </button>
          ))}
        </div>
      ) : null}

      {!isScidekick ? (
        <div className="adapter-row">
          <input
            value={customCommand}
            onChange={(event) => onCustomCommandChange(event.target.value)}
            placeholder="agent command"
          />
          <input
            value={customArgs}
            onChange={(event) => onCustomArgsChange(event.target.value)}
            placeholder="args (use {prompt})"
          />
        </div>
      ) : null}

      <div className="composer-toolbar">
        <div className="composer-tools-left">
          <button className="toolbar-icon" type="button" title="Attach" onClick={onAddAttachment}>
            <Paperclip size={14} />
          </button>

          <span className="engine-picker" title="Agent adapter">
            <select value={selectedAgentId} onChange={(event) => onSelectedAgentIdChange(event.target.value)}>
              {agents.length === 0 ? <option value="scidekick">Scidekick</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <ChevronDown className="chev" size={11} />
          </span>

          {isScidekick ? (
            <>
              <span className="engine-picker" title="Model">
                <select
                  value={selectedModel}
                  onChange={(event) => onSelectedModelChange(event.target.value)}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="chev" size={11} />
              </span>

              <span className="engine-picker" title="Reasoning effort">
                <select
                  value={thinkingEffort}
                  onChange={(event) => onThinkingEffortChange(event.target.value)}
                >
                  {EFFORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="chev" size={11} />
              </span>
            </>
          ) : null}

          <button
            className="toolbar-chip"
            type="button"
            onClick={() =>
              onPermissionModeChange(permissionMode === "accept-edits" ? "default" : "accept-edits")
            }
            title="Permission mode"
          >
            {permissionMode === "accept-edits" ? "Accept edits" : "Default permissions"}
            <ChevronDown className="chev" size={11} />
          </button>
        </div>

        <div className="composer-tools-right">
          {busy ? (
            <button className="stop-button" type="button" title="Stop">
              Stop
            </button>
          ) : null}
          <button
            className="send-button"
            disabled={sendDisabled}
            type="submit"
            title="Send (Enter · Shift+Enter for newline)"
          >
            <ArrowUp size={15} strokeWidth={2.5} />
            <span className="send-label">Send</span>
          </button>
        </div>
      </div>
    </form>
  );
}
