use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

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
    agent_id: String,
    workspace_path: String,
    prompt: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    started_at: u64,
    finished_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HarnessStore {
    workspaces: Vec<Workspace>,
    sessions: Vec<SessionRecord>,
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
    match Command::new(&command).args(&args).output() {
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
fn start_agent_session(
    app: AppHandle,
    request: StartSessionRequest,
) -> Result<SessionStarted, String> {
    let workspace = canonical_workspace_path(&request.workspace_path)?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required".to_string());
    }

    let (command, args) = command_for_session(&request, prompt)?;
    let session_id = make_id("session");
    let started_at = now_ms();
    let workspace_str = path_to_string(&workspace)?;
    let prompt_str = prompt.to_string();

    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(&workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start {command}: {err}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "process stdout pipe missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "process stderr pipe missing".to_string())?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    let stdout_thread = spawn_stream_reader(
        app.clone(),
        session_id.clone(),
        "stdout",
        stdout,
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
        let agent_id = request.agent_id.clone();
        let workspace_path = workspace_str.clone();
        let prompt_persist = prompt_str.clone();
        thread::spawn(move || {
            let exit_code = match child.wait() {
                Ok(status) => status.code(),
                Err(_) => None,
            };
            // ensure all output is drained
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();

            let stdout_text = stdout_buf
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            let stderr_text = stderr_buf
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();

            let record = SessionRecord {
                id: id.clone(),
                agent_id,
                workspace_path,
                prompt: prompt_persist,
                stdout: stdout_text,
                stderr: stderr_text,
                exit_code,
                started_at,
                finished_at: now_ms(),
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
        command,
        args,
        started_at,
    })
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
    if let Some(model) = request.model.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
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
    let output = Command::new(command)
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
    tauri::Builder::default()
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
            git_status,
            run_shell_command,
            list_workspace_files
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Scidekick Desktop");
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
        };
        let (_, args) =
            command_for_session(&request, "inspect").expect("valid scidekick command");
        assert_eq!(
            args,
            vec!["--print", "--mode", "json", "--model", "opus", "--thinking", "high", "inspect"]
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
    fn workspace_name_falls_back_for_root_paths() {
        assert_eq!(workspace_name(Path::new("/")), "Workspace");
    }
}
