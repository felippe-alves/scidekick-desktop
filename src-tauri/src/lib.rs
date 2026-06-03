use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentDefinition {
    id: &'static str,
    name: &'static str,
    protocol: &'static str,
    command: &'static str,
    default_args: &'static [&'static str],
    macos: bool,
    linux: bool,
    summary: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentProbeResult {
    command: String,
    available: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    id: String,
    name: String,
    path: String,
    created_at: u64,
    last_opened_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SessionRecord {
    id: String,
    conversation_id: Option<String>,
    agent_id: String,
    workspace_path: String,
    prompt: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    started_at: u64,
    finished_at: u64,
    scidekick_session_id: Option<String>,
    #[serde(default)]
    interrupted: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HarnessStore {
    workspaces: Vec<Workspace>,
    sessions: Vec<SessionRecord>,
    #[serde(default)]
    settings: HarnessSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct HarnessSettings {
    /// Override binary path per agent id (e.g. "scidekick" -> "/usr/local/bin/sk").
    /// Empty values are ignored; absent keys fall back to the registry default.
    #[serde(default)]
    agent_commands: HashMap<String, String>,
    /// Last-known composer state, re-applied on launch so the user does not
    /// have to re-pick model/effort/workspace every time.
    #[serde(default)]
    composer: ComposerDefaults,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ComposerDefaults {
    #[serde(default)]
    selected_agent_id: Option<String>,
    #[serde(default)]
    selected_model: Option<String>,
    #[serde(default)]
    thinking_effort: Option<String>,
    #[serde(default)]
    approval_mode: Option<String>,
    #[serde(default)]
    last_workspace_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSessionRequest {
    agent_id: String,
    workspace_path: String,
    prompt: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    model: Option<String>,
    thinking_effort: Option<String>,
    previous_scidekick_session_id: Option<String>,
    conversation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandRunResult {
    command: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellCommandRequest {
    workspace_path: String,
    command: String,
    args: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessHealth {
    ok: bool,
    store_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SessionStarted {
    id: String,
    agent_id: String,
    workspace_path: String,
    prompt: String,
    command: String,
    args: Vec<String>,
    started_at: u64,
    scidekick_session_id: Option<String>,
    conversation_id: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SessionStreamPayload {
    session_id: String,
    channel: &'static str,
    line: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SessionCompletePayload {
    session_id: String,
    record: SessionRecord,
}

/// Per-session handle held while a child is alive: shared so the wait thread
/// can `wait()` and the stop command can `kill()` concurrently, plus a flag
/// the stop command flips so the wait thread can mark the persisted record.
struct RunningChild {
    child: Arc<SharedChild>,
    stop_requested: Arc<AtomicBool>,
}

#[derive(Default)]
struct RunningSessions(Mutex<HashMap<String, RunningChild>>);

fn register_running(
    sessions: &RunningSessions,
    session_id: &str,
    entry: RunningChild,
) -> Result<(), String> {
    let mut map = sessions
        .0
        .lock()
        .map_err(|err| format!("failed to lock session registry: {err}"))?;
    map.insert(session_id.to_string(), entry);
    Ok(())
}

/// Removes a running session from the registry, sets its stop flag, and kills
/// the child. Returns `Ok(true)` if a live entry was found, `Ok(false)` if no
/// session is currently registered under `session_id` (so callers can treat a
/// double-click on Stop or a stop-after-natural-exit as a no-op).
fn stop_running(sessions: &RunningSessions, session_id: &str) -> Result<bool, String> {
    let entry = {
        let mut map = sessions
            .0
            .lock()
            .map_err(|err| format!("failed to lock session registry: {err}"))?;
        map.remove(session_id)
    };
    let Some(entry) = entry else {
        return Ok(false);
    };
    entry.stop_requested.store(true, Ordering::SeqCst);
    entry
        .child
        .kill()
        .map_err(|err| format!("failed to stop session {session_id}: {err}"))?;
    Ok(true)
}

/// Best-effort shutdown of every live child. Used on app exit so we do not
/// leak Scidekick processes behind the harness.
fn kill_all_running(sessions: &RunningSessions) {
    let entries: Vec<RunningChild> = match sessions.0.lock() {
        Ok(mut map) => map.drain().map(|(_, entry)| entry).collect(),
        Err(_) => return,
    };
    for entry in entries {
        entry.stop_requested.store(true, Ordering::SeqCst);
        let _ = entry.child.kill();
    }
}

/// Resolve the per-agent binary override, if one is set and non-empty.
/// Returns `None` when reading the store fails or no override exists so
/// callers can fall back to the registry default.
fn agent_command_override(app: &AppHandle, agent_id: &str) -> Option<String> {
    let store = read_store(app).ok()?;
    let raw = store.settings.agent_commands.get(agent_id)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

static USER_PATH: OnceLock<String> = OnceLock::new();

/// Resolve the user's shell-level PATH once and cache it. macOS launchd
/// hands GUI apps a spartan PATH (`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`)
/// that omits everything users actually install agents into (`~/.local/bin`,
/// `~/.cargo/bin`, Homebrew prefixes, asdf shims, etc.). We spawn the user's
/// login shell once to recover the real PATH and inject it into every child
/// we launch. Falls back to the inherited PATH if the shell call fails.
fn user_path() -> &'static str {
    USER_PATH.get_or_init(|| {
        let inherited = std::env::var("PATH").unwrap_or_default();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });
        // `-l -i` is the broadest combination: login shells read profile files
        // and interactive shells read rc files. `printf %s` avoids a trailing
        // newline. stderr is discarded because interactive shells happily
        // print "no jobs", MOTD lines, or color-prompt garbage there.
        let output = Command::new(&shell)
            .args(["-l", "-i", "-c", "printf %s \"$PATH\""])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        match output {
            Ok(out) if out.status.success() => {
                let resolved = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if resolved.is_empty() {
                    inherited
                } else if inherited.is_empty() {
                    resolved
                } else {
                    // Merge the inherited PATH onto the end so explicit env
                    // overrides (e.g. `PATH=… npm run tauri dev`) still win,
                    // and shell-only entries still get a turn.
                    merge_paths(&resolved, &inherited)
                }
            }
            _ => inherited,
        }
    })
}

/// Combine two PATH strings, keeping the order of `primary` and appending
/// any entries from `secondary` that are not already present.
fn merge_paths(primary: &str, secondary: &str) -> String {
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut out = String::with_capacity(primary.len() + secondary.len() + 1);
    for entry in primary.split(':').chain(secondary.split(':')) {
        if entry.is_empty() || !seen.insert(entry) {
            continue;
        }
        if !out.is_empty() {
            out.push(':');
        }
        out.push_str(entry);
    }
    out
}

/// Build a `Command` with the resolved login-shell PATH injected. Every
/// child the harness spawns must go through this so binaries installed at
/// non-default locations resolve identically in dev and bundled launches.
fn agent_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", user_path());
    cmd
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

const MAX_HISTORY: usize = 100;
const SUPPORTED_AGENTS: &[AgentDefinition] = &[
    AgentDefinition {
        id: "scidekick",
        name: "Scidekick",
        protocol: "scidekick-cli",
        command: "sk",
        default_args: &["-p", "<prompt>"],
        macos: true,
        linux: true,
        summary: "First-class terminal/research agent integration through the Scidekick CLI.",
    },
    AgentDefinition {
        id: "acp",
        name: "ACP-compatible agents",
        protocol: "acp",
        command: "<agent command>",
        default_args: &[],
        macos: true,
        linux: true,
        summary: "Agent Client Protocol adapters; UI and registry seams are present while protocol sessions are ported from Harnss.",
    },
    AgentDefinition {
        id: "codex",
        name: "Codex CLI",
        protocol: "json-rpc",
        command: "codex",
        default_args: &[],
        macos: true,
        linux: true,
        summary: "JSON-RPC command adapter for future parity with Harnss Codex sessions.",
    },
];

#[tauri::command]
fn list_supported_agents() -> &'static [AgentDefinition] {
    SUPPORTED_AGENTS
}

#[tauri::command]
fn probe_agent(command: String, args: Vec<String>) -> AgentProbeResult {
    match agent_command(&command).args(&args).output() {
        Ok(output) => AgentProbeResult {
            command,
            available: output.status.success(),
            stdout: decode_lossy(output.stdout),
            stderr: decode_lossy(output.stderr),
            exit_code: output.status.code(),
        },
        Err(err) => AgentProbeResult {
            command,
            available: false,
            stdout: String::new(),
            stderr: err.to_string(),
            exit_code: None,
        },
    }
}

#[tauri::command]
fn list_workspaces(app: AppHandle) -> Result<Vec<Workspace>, String> {
    Ok(read_store(&app)?.workspaces)
}

#[tauri::command]
fn add_workspace(app: AppHandle, path: String) -> Result<Vec<Workspace>, String> {
    let path = canonical_workspace_path(&path)?;
    let name = workspace_name(&path);
    let path_string = path_to_string(&path)?;
    let mut store = read_store(&app)?;
    let now = now_ms();

    if let Some(existing) = store
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.path == path_string)
    {
        existing.last_opened_at = now;
    } else {
        store.workspaces.push(Workspace {
            id: make_id("workspace"),
            name,
            path: path_string,
            created_at: now,
            last_opened_at: now,
        });
    }

    store
        .workspaces
        .sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    write_store(&app, &store)?;
    Ok(store.workspaces)
}

#[tauri::command]
fn remove_workspace(app: AppHandle, id: String) -> Result<Vec<Workspace>, String> {
    let mut store = read_store(&app)?;
    store.workspaces.retain(|workspace| workspace.id != id);
    write_store(&app, &store)?;
    Ok(store.workspaces)
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionRecord>, String> {
    Ok(read_store(&app)?.sessions)
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<HarnessSettings, String> {
    Ok(read_store(&app)?.settings)
}

/// Replaces the persisted settings wholesale. The frontend reads, mutates,
/// and writes back the entire object so the merge semantics live where the
/// user actually sees them; the backend just persists what it is handed
/// (with one normalization: agent-command overrides that are entirely
/// whitespace are dropped so the registry default takes over again).
#[tauri::command]
fn update_settings(
    app: AppHandle,
    settings: HarnessSettings,
) -> Result<HarnessSettings, String> {
    let mut store = read_store(&app)?;
    store.settings = normalize_settings(settings);
    write_store(&app, &store)?;
    Ok(store.settings)
}

/// Drop whitespace-only overrides and trim the ones we keep. Pure so it can
/// be unit-tested without an `AppHandle`.
fn normalize_settings(mut settings: HarnessSettings) -> HarnessSettings {
    settings
        .agent_commands
        .retain(|_, value| !value.trim().is_empty());
    for value in settings.agent_commands.values_mut() {
        *value = value.trim().to_string();
    }
    settings
}

#[tauri::command]
fn start_agent_session(
    app: AppHandle,
    sessions: State<RunningSessions>,
    request: StartSessionRequest,
) -> Result<SessionStarted, String> {
    let workspace = canonical_workspace_path(&request.workspace_path)?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }

    let (mut command_str, args) = command_for_session(&request, prompt)?;
    // User-provided custom commands always win. For agents whose binary
    // comes from the registry default (currently only Scidekick), honor a
    // per-agent override from persisted settings so a user-installed `sk`
    // at a non-PATH location can be wired up without launching from a terminal.
    let user_provided_command = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if !user_provided_command {
        if let Some(override_path) = agent_command_override(&app, &request.agent_id) {
            command_str = override_path;
        }
    }
    let session_id = make_id("session");
    let started_at = now_ms();
    let workspace_str = path_to_string(&workspace)?;
    let conversation_id = request
        .conversation_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| make_id("conversation"));
    let prompt_str = prompt.to_string();

    let mut cmd = agent_command(&command_str);
    cmd.args(&args)
        .current_dir(&workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let shared = SharedChild::spawn(&mut cmd)
        .map_err(|err| format!("failed to start {command_str}: {err}"))?;
    let stdout = shared
        .take_stdout()
        .ok_or_else(|| "process stdout pipe missing".to_string())?;
    let stderr = shared
        .take_stderr()
        .ok_or_else(|| "process stderr pipe missing".to_string())?;
    let child = Arc::new(shared);
    let stop_requested = Arc::new(AtomicBool::new(false));

    // Register before any blocking IO so a fast stop can find the child.
    register_running(
        sessions.inner(),
        &session_id,
        RunningChild {
            child: child.clone(),
            stop_requested: stop_requested.clone(),
        },
    )?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    // Read the first stdout line synchronously — Scidekick emits the session header
    // as { "type": "session", "id": "<uuid>", ... } before any agent events.
    // We extract the session ID here so it can be returned in SessionStarted and
    // later fed back as --resume <id> for multi-turn conversations.
    let mut first_line_reader = BufReader::new(stdout);
    let mut first_line = String::new();
    let scidekick_session_id = if first_line_reader
        .read_line(&mut first_line)
        .is_ok()
        && !first_line.is_empty()
    {
        stdout_buf
            .lock()
            .ok()
            .map(|mut guard| guard.push_str(&first_line));
        // Also emit the header as a stream event so the frontend's
        // tryExtractSessionId can capture it (belt + suspenders).
        let line = first_line.trim_end_matches('\n').to_string();
        if !line.is_empty() {
            let _ = app.emit(
                "session-stream",
                SessionStreamPayload {
                    session_id: session_id.clone(),
                    channel: "stdout",
                    line,
                },
            );
        }
        extract_scidekick_session_id(&first_line)
    } else {
        None
    };
    let stdout_thread = spawn_stream_reader(
        app.clone(),
        session_id.clone(),
        "stdout",
        first_line_reader,
        stdout_buf.clone(),
    );

    let stderr_thread = spawn_stream_reader(
        app.clone(),
        session_id.clone(),
        "stderr",
        stderr,
        stderr_buf.clone(),
    );

    // wait + persist thread
    {
        let app = app.clone();
        let id = session_id.clone();
        let conversation_id_persist = conversation_id.clone();
        let agent_id = request.agent_id.clone();
        let workspace_path = workspace_str.clone();
        let prompt_persist = prompt_str.clone();
        let scidekick_session_id_persist = scidekick_session_id.clone();
        let child_for_wait = child.clone();
        let stop_flag = stop_requested.clone();
        thread::spawn(move || {
            let exit_code = match child_for_wait.wait() {
                Ok(status) => status.code(),
                Err(_) => None,
            };
            // ensure all output is drained
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();

            // Drop our entry if a natural exit beat any pending stop request.
            if let Some(state) = app.try_state::<RunningSessions>() {
                if let Ok(mut map) = state.0.lock() {
                    map.remove(&id);
                }
            }

            let stdout_text = stdout_buf
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            let stderr_text = stderr_buf
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            let persisted_scidekick_session_id = scidekick_session_id_persist.or_else(|| {
                stdout_text
                    .lines()
                    .find_map(extract_scidekick_session_id)
            });

            let record = SessionRecord {
                id: id.clone(),
                conversation_id: Some(conversation_id_persist),
                agent_id,
                workspace_path,
                prompt: prompt_persist,
                stdout: stdout_text,
                stderr: stderr_text,
                exit_code,
                started_at,
                finished_at: now_ms(),
                scidekick_session_id: persisted_scidekick_session_id,
                interrupted: stop_flag.load(Ordering::SeqCst),
            };

            if let Ok(mut store) = read_store(&app) {
                store.sessions.insert(0, record.clone());
                if store.sessions.len() > MAX_HISTORY {
                    store.sessions.truncate(MAX_HISTORY);
                }
                let _ = write_store(&app, &store);
            }

            let _ = app.emit(
                "session-complete",
                SessionCompletePayload {
                    session_id: id,
                    record,
                },
            );
        });
    }

    Ok(SessionStarted {
        id: session_id,
        agent_id: request.agent_id,
        workspace_path: workspace_str,
        prompt: prompt_str,
        command: command_str,
        args,
        started_at,
        scidekick_session_id,
        conversation_id,
    })
}

#[tauri::command]
fn stop_agent_session(
    sessions: State<RunningSessions>,
    session_id: String,
) -> Result<bool, String> {
    stop_running(sessions.inner(), &session_id)
}

#[tauri::command]
fn harness_health(app: AppHandle) -> Result<HarnessHealth, String> {
    let path = store_path(&app)?;
    Ok(HarnessHealth {
        ok: true,
        store_path: path_to_string(&path)?,
    })
}

#[tauri::command]
fn list_workspace_files(
    workspace_path: String,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let workspace = canonical_workspace_path(&workspace_path)?;
    list_files_in_dir(&workspace, limit.unwrap_or(80).min(240))
}

#[tauri::command]
fn git_status(workspace_path: String) -> Result<CommandRunResult, String> {
    let workspace = canonical_workspace_path(&workspace_path)?;
    run_command_in_dir(&workspace, "git", &["status", "--short", "--branch"])
}

#[tauri::command]
fn run_shell_command(request: ShellCommandRequest) -> Result<CommandRunResult, String> {
    let workspace = canonical_workspace_path(&request.workspace_path)?;
    if request.command.trim().is_empty() {
        return Err("Command is required".to_string());
    }
    let arg_refs: Vec<&str> = request.args.iter().map(String::as_str).collect();
    run_command_in_dir(&workspace, &request.command, &arg_refs)
}

fn command_for_session(
    request: &StartSessionRequest,
    prompt: &str,
) -> Result<(String, Vec<String>), String> {
    match request.agent_id.as_str() {
        "scidekick" => Ok(("sk".to_string(), build_scidekick_args(request, prompt))),
        _ => {
            let command = request
                .command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Custom agent command is required for this adapter".to_string())?;
            let args = expand_prompt_args(request.args.as_deref().unwrap_or(&[]), prompt);
            Ok((command.to_string(), args))
        }
    }
}

fn build_scidekick_args(request: &StartSessionRequest, prompt: &str) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        "--mode".to_string(),
        "json".to_string(),
    ];
    if let Some(sid) = request
        .previous_scidekick_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--resume".to_string());
        args.push(sid.to_string());
    }
    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(effort) = request
        .thinking_effort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--thinking".to_string());
        args.push(effort.to_string());
    }
    args.push(prompt.to_string());
    args
}

fn expand_prompt_args(args: &[String], prompt: &str) -> Vec<String> {
    if args.is_empty() {
        return vec![prompt.to_string()];
    }
    args.iter()
        .map(|arg| arg.replace("{prompt}", prompt))
        .collect()
}

fn run_command_in_dir(
    workspace: &Path,
    command: &str,
    args: &[&str],
) -> Result<CommandRunResult, String> {
    let output = agent_command(command)
        .args(args)
        .current_dir(workspace)
        .output()
        .map_err(|err| format!("failed to run {command}: {err}"))?;

    Ok(CommandRunResult {
        command: if args.is_empty() {
            command.to_string()
        } else {
            format!("{} {}", command, args.join(" "))
        },
        stdout: decode_lossy(output.stdout),
        stderr: decode_lossy(output.stderr),
        exit_code: output.status.code(),
    })
}

fn list_files_in_dir(workspace: &Path, limit: usize) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    for entry in
        fs::read_dir(workspace).map_err(|err| format!("failed to read workspace files: {err}"))?
    {
        let entry = entry.map_err(|err| format!("failed to read workspace entry: {err}"))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|value| value.to_str()) {
            Some(name) if !name.starts_with('.') => name.to_string(),
            Some(_) | None => continue,
        };
        let metadata = entry
            .metadata()
            .map_err(|err| format!("failed to read file metadata for {name}: {err}"))?;
        entries.push(FileEntry {
            name,
            path: path_to_string(&path)?,
            is_dir: metadata.is_dir(),
            size: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    entries.truncate(limit);
    Ok(entries)
}

fn canonical_workspace_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_string());
    }
    let path = Path::new(trimmed)
        .canonicalize()
        .map_err(|err| format!("workspace path does not exist: {err}"))?;
    if !path.is_dir() {
        return Err("Workspace path must be a directory".to_string());
    }
    Ok(path)
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace")
        .to_string()
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}

fn read_store(app: &AppHandle) -> Result<HarnessStore, String> {
    let path = store_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content)
            .map_err(|err| format!("failed to parse harness store: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(HarnessStore::default()),
        Err(err) => Err(format!("failed to read harness store: {err}")),
    }
}

fn write_store(app: &AppHandle, store: &HarnessStore) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create app data directory: {err}"))?;
    }
    let content = serde_json::to_string_pretty(store)
        .map_err(|err| format!("failed to serialize harness store: {err}"))?;
    fs::write(path, content).map_err(|err| format!("failed to write harness store: {err}"))
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("harness-store.json"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn make_id(prefix: &str) -> String {
    let next = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{next}", now_ms())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn decode_lossy(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).into_owned()
}

fn extract_scidekick_session_id(line: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(line.trim()).ok()?;
    if parsed.get("type")?.as_str()? != "session" {
        return None;
    }
    parsed
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(str::to_string)
}

fn spawn_stream_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    session_id: String,
    channel: &'static str,
    reader: R,
    buffer: Arc<Mutex<String>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let buf_reader = BufReader::new(reader);
        for line in buf_reader.lines().map_while(Result::ok) {
            {
                let mut guard = match buffer.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };
                guard.push_str(&line);
                guard.push('\n');
            }
            let _ = app.emit(
                "session-stream",
                SessionStreamPayload {
                    session_id: session_id.clone(),
                    channel,
                    line,
                },
            );
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(RunningSessions::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_supported_agents,
            probe_agent,
            harness_health,
            list_workspaces,
            add_workspace,
            remove_workspace,
            list_sessions,
            start_agent_session,
            stop_agent_session,
            get_settings,
            update_settings,
            git_status,
            run_shell_command,
            list_workspace_files
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Scidekick Desktop");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app_handle.try_state::<RunningSessions>() {
                kill_all_running(state.inner());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_prompt_placeholder_without_shell() {
        let args = vec![
            "-p".to_string(),
            "{prompt}".to_string(),
            "--json".to_string(),
        ];
        assert_eq!(
            expand_prompt_args(&args, "hello world"),
            vec!["-p", "hello world", "--json"]
        );
    }

    #[test]
    fn default_custom_agent_receives_prompt_as_single_arg() {
        assert_eq!(expand_prompt_args(&[], "two words"), vec!["two words"]);
    }

    #[test]
    fn scidekick_session_uses_json_print_mode() {
        let request = StartSessionRequest {
            agent_id: "scidekick".to_string(),
            workspace_path: ".".to_string(),
            prompt: "ignored".to_string(),
            command: Some("other".to_string()),
            args: Some(vec!["bad".to_string()]),
            model: None,
            thinking_effort: None,
            previous_scidekick_session_id: None,
            conversation_id: None,
        };
        let (command, args) =
            command_for_session(&request, "inspect").expect("valid scidekick command");
        assert_eq!(command, "sk");
        assert_eq!(args, vec!["--print", "--mode", "json", "inspect"]);
    }

    #[test]
    fn scidekick_session_includes_model_and_effort() {
        let request = StartSessionRequest {
            agent_id: "scidekick".to_string(),
            workspace_path: ".".to_string(),
            prompt: "ignored".to_string(),
            command: None,
            args: None,
            model: Some("opus".to_string()),
            thinking_effort: Some("high".to_string()),
            previous_scidekick_session_id: None,
            conversation_id: None,
        };
        let (_, args) = command_for_session(&request, "inspect").expect("valid scidekick command");
        assert_eq!(
            args,
            vec![
                "--print",
                "--mode",
                "json",
                "--model",
                "opus",
                "--thinking",
                "high",
                "inspect"
            ]
        );
    }

    #[test]
    fn scidekick_session_passes_resume_flag() {
        let request = StartSessionRequest {
            agent_id: "scidekick".to_string(),
            workspace_path: ".".to_string(),
            prompt: "ignored".to_string(),
            command: None,
            args: None,
            model: None,
            thinking_effort: None,
            previous_scidekick_session_id: Some("01abcdef-1234-5678".to_string()),
            conversation_id: None,
        };
        let (_, args) = command_for_session(&request, "followup").expect("valid");
        assert_eq!(
            args,
            vec![
                "--print",
                "--mode",
                "json",
                "--resume",
                "01abcdef-1234-5678",
                "followup"
            ]
        );
    }

    #[test]
    fn custom_session_requires_command() {
        let request = StartSessionRequest {
            agent_id: "acp".to_string(),
            workspace_path: ".".to_string(),
            prompt: "ignored".to_string(),
            command: None,
            args: None,
            model: None,
            thinking_effort: None,
            previous_scidekick_session_id: None,
            conversation_id: None,
        };
        assert!(command_for_session(&request, "inspect").is_err());
    }

    #[test]
    fn file_listing_hides_dotfiles_and_sorts_directories_first() {
        let root = std::env::temp_dir().join(make_id("scidekick-desktop-test"));
        fs::create_dir(&root).expect("create temp root");
        fs::create_dir(root.join("src")).expect("create src dir");
        fs::write(root.join("README.md"), b"hello").expect("write readme");
        fs::write(root.join(".env"), b"secret").expect("write dotfile");

        let files = list_files_in_dir(&root, 10).expect("list files");
        fs::remove_dir_all(&root).expect("cleanup temp root");

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "src");
        assert!(files[0].is_dir);
        assert_eq!(files[1].name, "README.md");
        assert_eq!(files[1].size, Some(5));
    }

    #[test]
    fn extracts_scidekick_session_id_with_json_spacing() {
        assert_eq!(
            extract_scidekick_session_id(
                r#"{ "type": "session", "id": "01abcdef-1234-5678", "cwd": "/tmp" }"#
            ),
            Some("01abcdef-1234-5678".to_string())
        );
        assert_eq!(
            extract_scidekick_session_id(r#"{ "type": "turn_start", "id": "nope" }"#),
            None
        );
    }

    #[test]
    fn workspace_name_falls_back_for_root_paths() {
        assert_eq!(workspace_name(Path::new("/")), "Workspace");
    }

    /// Spawn a long-lived child for use in registry tests. Returns the
    /// SharedChild plus the stop-flag we register alongside it.
    fn spawn_test_child(secs: u32) -> (Arc<SharedChild>, Arc<AtomicBool>) {
        let mut cmd = Command::new("sleep");
        cmd.arg(secs.to_string());
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        let shared = SharedChild::spawn(&mut cmd).expect("spawn sleep");
        (Arc::new(shared), Arc::new(AtomicBool::new(false)))
    }

    /// Bounded wait so a runaway test cannot hang CI.
    fn wait_until_exit(child: &SharedChild) -> std::process::ExitStatus {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if let Some(status) = child.try_wait().expect("try_wait") {
                return status;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                panic!("child did not exit within 5s after stop");
            }
            thread::sleep(std::time::Duration::from_millis(25));
        }
    }

    #[test]
    fn stop_running_kills_registered_child() {
        let sessions = RunningSessions::default();
        let (child, stop_flag) = spawn_test_child(30);
        let id = "stop-test-1";
        register_running(
            &sessions,
            id,
            RunningChild {
                child: child.clone(),
                stop_requested: stop_flag.clone(),
            },
        )
        .expect("register");

        assert!(stop_running(&sessions, id).expect("stop ok"));
        assert!(stop_flag.load(Ordering::SeqCst));

        let status = wait_until_exit(&child);
        assert!(!status.success(), "killed child must not report success");

        // Registry entry is gone; a second stop is a no-op.
        assert!(!stop_running(&sessions, id).expect("second stop ok"));
    }

    #[test]
    fn stop_running_is_noop_when_session_missing() {
        let sessions = RunningSessions::default();
        assert!(!stop_running(&sessions, "no-such-session").expect("no panic"));
    }

    #[test]
    fn kill_all_running_drains_registry() {
        let sessions = RunningSessions::default();
        let (child_a, flag_a) = spawn_test_child(30);
        let (child_b, flag_b) = spawn_test_child(30);
        register_running(
            &sessions,
            "drain-a",
            RunningChild {
                child: child_a.clone(),
                stop_requested: flag_a.clone(),
            },
        )
        .expect("register a");
        register_running(
            &sessions,
            "drain-b",
            RunningChild {
                child: child_b.clone(),
                stop_requested: flag_b.clone(),
            },
        )
        .expect("register b");

        kill_all_running(&sessions);

        assert!(flag_a.load(Ordering::SeqCst));
        assert!(flag_b.load(Ordering::SeqCst));
        wait_until_exit(&child_a);
        wait_until_exit(&child_b);
        assert!(
            sessions.0.lock().expect("registry lock").is_empty(),
            "registry must be empty after kill_all_running"
        );
    }

    #[test]
    fn merge_paths_keeps_primary_order_and_dedupes() {
        let merged = merge_paths(
            "/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin",
            "/usr/bin:/usr/sbin:/Users/me/.cargo/bin",
        );
        assert_eq!(
            merged,
            "/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/usr/sbin:/Users/me/.cargo/bin"
        );
    }

    #[test]
    fn merge_paths_skips_empty_segments() {
        assert_eq!(merge_paths(":/usr/bin::/bin:", "/usr/bin:/sbin"), "/usr/bin:/bin:/sbin");
        assert_eq!(merge_paths("", "/usr/bin"), "/usr/bin");
        assert_eq!(merge_paths("/usr/bin", ""), "/usr/bin");
    }

    #[test]
    fn normalize_settings_drops_whitespace_overrides() {
        let mut settings = HarnessSettings::default();
        settings
            .agent_commands
            .insert("scidekick".to_string(), "   ".to_string());
        settings
            .agent_commands
            .insert("acp".to_string(), "  /opt/acp  ".to_string());

        let normalized = normalize_settings(settings);

        assert!(
            !normalized.agent_commands.contains_key("scidekick"),
            "whitespace-only override must be dropped"
        );
        assert_eq!(
            normalized.agent_commands.get("acp"),
            Some(&"/opt/acp".to_string()),
            "kept overrides must be trimmed"
        );
    }

    #[test]
    fn harness_store_back_compat_parses_without_settings() {
        // Existing on-disk stores written before the settings field existed
        // must still deserialize so users do not lose their workspaces on upgrade.
        let json = r#"{"workspaces":[],"sessions":[]}"#;
        let store: HarnessStore = serde_json::from_str(json).expect("parses legacy store");
        assert_eq!(store.workspaces.len(), 0);
        assert_eq!(store.sessions.len(), 0);
        assert!(store.settings.agent_commands.is_empty());
        assert!(store.settings.composer.selected_model.is_none());
    }

    #[test]
    fn session_record_back_compat_parses_without_interrupted() {
        // Records written before SessionRecord.interrupted existed must still
        // load and default to false.
        let json = r#"{
            "id": "session-1",
            "conversationId": "conv-1",
            "agentId": "scidekick",
            "workspacePath": "/tmp",
            "prompt": "hi",
            "stdout": "",
            "stderr": "",
            "exitCode": 0,
            "startedAt": 1,
            "finishedAt": 2,
            "scidekickSessionId": null
        }"#;
        let record: SessionRecord = serde_json::from_str(json).expect("parses legacy record");
        assert!(!record.interrupted);
    }
}
