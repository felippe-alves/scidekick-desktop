# Platform decision: Tauri first

## Decision

Use **Tauri v2** as the desktop foundation. Keep the frontend in React/TypeScript so Harnss UI and protocol concepts can be ported with low friction, but move native/session orchestration into a Rust backend exposed through narrow Tauri commands and events.

## Why not keep Electron

Electron is the lowest-risk choice for reusing Harnss directly: Harnss already has Electron main-process IPC, preload bridges, `electron-builder`, `electron-updater`, `node-pty`, and a mature React UI. The cost is that we inherit Chromium/Node packaging weight and a broad JavaScript native boundary before we have a Scidekick-specific harness.

For this project, that tradeoff is wrong. Scidekick already contains Rust and TypeScript, we are macOS/Linux-first, and we do not need Windows parity at the first cutover. A Rust native shell gives us a smaller trusted core for process supervision, PTYs, file access, and future model/tool mediation.

## Alternatives considered

| Platform | Fit | Strengths | Problems for this project |
| --- | --- | --- | --- |
| Tauri v2 | Best | Rust backend, explicit IPC boundary, system WebView, small bundles, macOS/Linux packaging, TypeScript frontend compatibility. | WebView rendering differs by OS; Harnss Electron IPC/preload code must be ported rather than copied. |
| Electron | Good fallback | Direct Harnss reuse, stable Chromium rendering, large packaging/updater ecosystem. | Larger bundles, more runtime surface, repeats Harnss architecture instead of taking advantage of Scidekick's Rust core. |
| Wails | Plausible | Go-native backend with WebView frontend and small binaries. | Scidekick is not Go-based; porting Harnss and Scidekick integration would add another language/runtime with little payoff. |
| Neutralinojs | Poor | Very small WebView wrapper and native API allowlists. | Too thin for a harness that needs PTYs, process supervision, browser/tool visualization, MCP/OAuth, and long-running sessions. |
| Flutter desktop | Poor | Strong native-feeling UI and Linux/macOS support. | Would discard Harnss React UI and Scidekick TypeScript UI assets; Dart is not aligned with either upstream repo. |

## Evidence

Tauri's own documentation says it builds on Rust, uses the system WebView instead of bundling a browser engine, and a minimal app can be under 600 KB: <https://v2.tauri.app/start/>. Tauri's security documentation describes a trust boundary between Rust core code and WebView frontend code, with frontend access limited to exposed IPC commands and configured capabilities: <https://v2.tauri.app/security/>.

For distribution, Tauri documents macOS `.app` bundle generation through `tauri build -- --bundles app`, entitlements in `src-tauri/Entitlements.plist`, and minimum macOS version configuration: <https://v2.tauri.app/distribute/macos-application-bundle/>. Tauri also documents that macOS code signing requires an Apple Developer account, while ad-hoc signing can be configured with signing identity `-`: <https://v2.tauri.app/distribute/sign/macos/>. That matches this repo's current constraint: no public notarized macOS downloads until an Apple Developer Program account exists.

Tauri's distribution docs cover Linux packages including Debian packages and AppImage: <https://v2.tauri.app/distribute/>. Its updater plugin requires signed update artifacts and produces `.sig` files for AppImage and macOS `.app.tar.gz` bundles: <https://v2.tauri.app/plugin/updater/>. We should not enable auto-update until signing keys and release ownership are settled.

## Architectural consequence

Do not port Harnss `electron/src/main.ts`, `electron/src/preload.ts`, or IPC handlers verbatim. Port the domain model and adapter behavior into framework-neutral TypeScript/Rust modules, then expose them through Tauri commands/events.

Initial target structure:

```text
src/                 React renderer and framework-neutral TypeScript helpers
src-tauri/           Rust native shell, process/session commands, bundle config
docs/research/       Platform and Harnss porting decisions
.github/workflows/   CI and release automation
```
