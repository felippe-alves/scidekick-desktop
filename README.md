# Scidekick Desktop

Desktop harness for Scidekick, designed to stay agent-agnostic while making Scidekick the first-class default agent.

## Platform decision

This project starts on **Tauri v2 + React + TypeScript + Rust**, not Electron. Tauri uses the operating system WebView instead of bundling Chromium, can produce very small app bundles, and puts native capability access behind an explicit Rust/IPC boundary. That matches this project's macOS/Linux-first target and Scidekick's existing Rust/TypeScript codebase.

Electron remains useful as a reference because Harnss already solved a lot of agent-harness UX and protocol problems. We should port those ideas and TypeScript domain modules selectively, not carry over Electron main-process/preload architecture.

See:

- `docs/research/platform-decision.md`
- `docs/research/harnss-porting-notes.md`
- `docs/building.md`
- `docs/ci-release.md`

## Local development

```sh
npm install
npm run dev
```

The app currently provides the first Harnss-derived harness surfaces: persisted workspaces, a Scidekick-first session runner, custom command adapters for non-Scidekick agents, session history, git status, and a safe argument-vector command runner scoped to the selected workspace.

## Local macOS build

A notarized public macOS download is intentionally not produced until the project has an Apple Developer Program account. Build locally instead:

```sh
npm install
npm run build:mac:local
open "$HOME/.cache/scidekick-desktop-target/release/bundle/macos/Scidekick Desktop.app"
```

More details and Linux instructions are in `docs/building.md`.
