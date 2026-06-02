import { ArrowDownToLine, ArrowRightToLine } from "lucide-react";
import { TOOL_DEFINITIONS, TOOL_ICONS } from "../lib/tools";
import type { ToolId } from "../types/ui";

interface ToolPickerProps {
  activeSideTool: ToolId;
  bottomTools: ToolId[];
  onSelectSideTool: (tool: ToolId) => void;
  onToggleBottomTool: (tool: ToolId) => void;
}

export function ToolPicker({
  activeSideTool,
  bottomTools,
  onSelectSideTool,
  onToggleBottomTool,
}: ToolPickerProps) {
  return (
    <aside className="tool-picker" aria-label="Workspace tools">
      <div className="tool-picker-stack">
        {TOOL_DEFINITIONS.filter((tool) => tool.side).map((tool) => {
          const Icon = TOOL_ICONS[tool.id];
          const active = tool.id === activeSideTool;
          const bottom = bottomTools.includes(tool.id);
          return (
            <div className="tool-button-wrap" key={tool.id}>
              <button
                className={active ? "tool-button active" : "tool-button"}
                type="button"
                title={tool.label}
                onClick={() => onSelectSideTool(tool.id)}
              >
                <Icon size={15} strokeWidth={active ? 2.1 : 1.6} />
                {bottom ? <span className="bottom-dot" /> : null}
              </button>
              <div className="tool-popover">
                <strong>{tool.label}</strong>
                <span>{tool.description}</span>
                <button type="button" onClick={() => onToggleBottomTool(tool.id)}>
                  {bottom ? <ArrowRightToLine size={12} /> : <ArrowDownToLine size={12} />}
                  {bottom ? "Move to side" : "Move to bottom"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="tool-picker-divider" />

      <div className="tool-picker-stack contextual">
        {TOOL_DEFINITIONS.filter((tool) => !tool.side).map((tool) => {
          const Icon = TOOL_ICONS[tool.id];
          return (
            <button className="tool-button" key={tool.id} type="button" title={tool.label}>
              <Icon size={15} strokeWidth={1.6} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
