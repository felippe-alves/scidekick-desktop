# Harnss reuse and porting notes

Harnss is MIT-licensed and has already solved useful harness problems: multi-agent sessions, ACP agent registration, MCP server management, PTY terminals, file panels, git integration, rich tool-call rendering, and session/workspace organization. The reusable parts are mostly product behavior, UI components, protocol types, and pure helpers. The Electron-specific shell should not be carried over.

## Reuse directly or with light edits

| Harnss area | Upstream path | Porting approach |
| --- | --- | --- |
| React app shell and layout concepts | `src/components`, `src/hooks`, `src/lib/layout` | Keep React/TypeScript, replace `window.claude`/Electron bridge calls with Tauri command/event adapters. |
| Tool-call renderers and diff presentation | `src/components/tool-renderers`, `src/types/tools.ts`, `src/types/tool-islands.ts` | High-value reuse. Make renderers consume normalized Scidekick/ACP tool events instead of engine-specific event shapes. |
| ACP helper types and file helpers | `shared/lib/acp-helpers.ts`, `shared/types/acp*` | Good candidate for near-direct copy into `src/lib/acp` after license attribution. Avoid Electron imports. |
| Settings/state ideas | `src/stores/settings-store.ts`, `src/hooks/useSettings.ts` | Reuse schemas and UX, but persist through Tauri/Rust store commands rather than Electron IPC/localStorage-only flows. |
| Terminal UI | `src/lib/terminal-tabs.ts`, terminal React components | Reuse UI model. Replace Electron `node-pty` IPC with a Rust PTY backend. |
| Agent registry UX | `src/components/settings`, `electron/src/ipc/agent-registry.ts` | Reuse store/install flow ideas; implement registry fetch/install in Rust or framework-neutral TS. |

## Port, but rewrite the native boundary

| Harnss area | Upstream path | Required change |
| --- | --- | --- |
| ACP sessions | `electron/src/ipc/acp-sessions.ts` | Extract protocol/session state machine; replace `ipcMain`, `BrowserWindow`, and Node child-process lifecycle with Tauri commands/events plus Rust-supervised processes where practical. |
| Codex sessions | `electron/src/ipc/codex-sessions.ts` | Lower priority. Keep as a reference for JSON-RPC session framing, not first implementation. |
| Claude sessions | `electron/src/ipc/claude-sessions.ts` | Do not make this first-class before Scidekick. Useful for permission/plan-mode patterns only. |
| MCP/OAuth | `electron/src/lib/mcp-*`, `electron/src/ipc/mcp-*` | Reuse flow design. Reimplement token storage and callback handling in Rust/Tauri. |
| Git/files/folders IPC | `electron/src/ipc/files.ts`, `git.ts`, `folders.ts` | Replace with Tauri commands using canonicalized paths and explicit per-project scopes. |

## Do not port

| Harnss area | Reason |
| --- | --- |
| `electron/src/preload.ts` | Tauri does not use Electron preload/contextBridge. Keeping this would create a parallel API surface. |
| `electron-builder.config.js`, `scripts/notarize.js`, `electron-updater` wiring | Replaced by Tauri bundling and local macOS build policy. |
| `electron-liquid-glass` integration | Electron-only and macOS-polish-specific. Defer until core harness behavior works. |
| Windows packaging and native exclusions | Windows is explicitly later. Avoid designing the first release around Windows constraints. |
| PostHog analytics wiring | Not part of the requested harness structure. Add telemetry only after product/privacy policy is explicit. |

## First Scidekick integration seam

The first implementation should launch and supervise `sk` sessions through an adapter that exposes normalized events:

```ts
interface AgentAdapter {
  id: string;
  protocol: "scidekick-cli" | "acp" | "json-rpc";
  probe(): Promise<AgentProbeResult>;
  startSession(request: StartSessionRequest): Promise<SessionHandle>;
  sendInput(sessionId: string, input: AgentInput): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
}
```

The UI should render normalized session events, not Scidekick-specific or ACP-specific raw protocol messages. Scidekick can still have first-class affordances for `.sk/wiki`, journal entries, model-tier guardrails, and skills.
