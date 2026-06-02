import {
  Bot,
  CheckSquare,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Plug,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { ToolDefinition, ToolId } from "../types/ui";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: "terminal",
    label: "Terminal",
    description: "Workspace command tabs and process output.",
    tint: "emerald",
    side: true,
    bottom: true,
  },
  {
    id: "browser",
    label: "Browser",
    description: "Research browser tabs and grabbed context.",
    tint: "sky",
    side: true,
    bottom: false,
  },
  {
    id: "git",
    label: "Source Control",
    description: "Branches, changes, diffs, and sync actions.",
    tint: "orange",
    side: true,
    bottom: false,
  },
  {
    id: "files",
    label: "Open Files",
    description: "Files touched by the active conversation.",
    tint: "amber",
    side: true,
    bottom: false,
  },
  {
    id: "project-files",
    label: "Project Files",
    description: "Project tree and previews.",
    tint: "teal",
    side: true,
    bottom: false,
  },
  {
    id: "mcp",
    label: "MCP Servers",
    description: "Model Context Protocol server status.",
    tint: "violet",
    side: true,
    bottom: false,
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Agent task checklist and progress.",
    tint: "blue",
    side: false,
    bottom: false,
  },
  {
    id: "agents",
    label: "Background Agents",
    description: "Agent registry and background workers.",
    tint: "indigo",
    side: false,
    bottom: false,
  },
];

export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  terminal: Terminal,
  browser: Globe,
  git: GitBranch,
  files: FileText,
  "project-files": FolderTree,
  mcp: Plug,
  tasks: CheckSquare,
  agents: Bot,
};

export function getTool(id: ToolId): ToolDefinition {
  return TOOL_DEFINITIONS.find((tool) => tool.id === id) ?? TOOL_DEFINITIONS[0];
}
