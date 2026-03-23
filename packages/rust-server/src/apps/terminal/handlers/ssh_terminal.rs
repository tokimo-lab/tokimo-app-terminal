//! SSH Terminal CRUD + WebSocket SSH relay + exec helpers (stats / ls / ps).
//!
//! CRUD endpoints manage connection configs stored in the DB.
//! The WebSocket endpoint establishes an SSH session to the remote host
//! and bridges it to the frontend xterm.js terminal.
//! The exec helpers open a short-lived SSH session to run a single command
//! and return the output as JSON.

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::{IntoResponse, Json},
};
use futures_util::{SinkExt, StreamExt};
use russh::client;
use russh::keys::PrivateKeyWithHashAlg;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use ts_rs::TS;
use uuid::Uuid;

use crate::db::repos::ssh_terminal_repo::SshTerminalRepo;
use crate::error::AppError;
use crate::handlers::user::AuthUser;
use crate::handlers::{ok, ok_empty, ApiResponse};
use crate::AppState;

// ── Input DTOs ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshTerminalInput {
    pub library_id: String,
    pub name: String,
    pub host: String,
    pub port: Option<i32>,
    pub username: String,
    pub auth_method: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub startup_command: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSshTerminalInput {
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub auth_method: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub startup_command: Option<String>,
    pub sort_order: Option<i32>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListByLibraryQuery {
    pub library_id: String,
}

// ── CRUD Handlers ──

/// GET /api/ssh-terminals?libraryId=...
pub async fn list_ssh_terminals(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Query(query): Query<ListByLibraryQuery>,
) -> Result<Json<ApiResponse<Vec<crate::db::models::ssh_terminal::SshTerminalOutput>>>, AppError> {
    let library_id: Uuid = query
        .library_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library_id".into()))?;
    let terminals = SshTerminalRepo::list_by_library(&state.db, library_id).await?;
    Ok(ok(terminals))
}

/// GET /api/ssh-terminals/:id
pub async fn get_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_by_id(&state.db, id).await?;
    Ok(ok(terminal))
}

/// POST /api/ssh-terminals
pub async fn create_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Json(input): Json<CreateSshTerminalInput>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let library_id: Uuid = input
        .library_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library_id".into()))?;

    let terminal = SshTerminalRepo::create(
        &state.db,
        library_id,
        &input.name,
        &input.host,
        input.port.unwrap_or(22),
        &input.username,
        input.auth_method.as_deref().unwrap_or("password"),
        input.password.as_deref(),
        input.private_key.as_deref(),
        input.passphrase.as_deref(),
        input.startup_command.as_deref(),
        input.sort_order.unwrap_or(0),
    )
    .await?;

    Ok(ok(terminal))
}

/// PATCH /api/ssh-terminals/:id
pub async fn update_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateSshTerminalInput>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::update(
        &state.db,
        id,
        input.name.as_deref(),
        input.host.as_deref(),
        input.port,
        input.username.as_deref(),
        input.auth_method.as_deref(),
        input.password.as_ref().map(|s| Some(s.as_str())),
        input.private_key.as_ref().map(|s| Some(s.as_str())),
        input.passphrase.as_ref().map(|s| Some(s.as_str())),
        input.startup_command.as_ref().map(|s| Some(s.as_str())),
        input.sort_order,
        input.is_enabled,
    )
    .await?;

    Ok(ok(terminal))
}

/// DELETE /api/ssh-terminals/:id
pub async fn delete_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    SshTerminalRepo::delete(&state.db, id).await?;
    Ok(ok_empty())
}

// ── WebSocket SSH relay ──

#[derive(Debug, Deserialize)]
pub struct SshWsQuery {
    pub id: String,
}

#[derive(Deserialize)]
struct ResizePayload {
    cols: u32,
    rows: u32,
}

/// GET /api/ssh-terminals/ws?id=... — WebSocket upgrade for SSH relay.
pub async fn ssh_terminal_ws(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Query(query): Query<SshWsQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let id: Uuid = query
        .id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    // Fetch the terminal config (with credentials)
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    Ok(ws.on_upgrade(move |socket| handle_ssh_session(socket, terminal)))
}

// ── SSH client handler (minimal — we use channel stream for data) ──

struct SshClientHandler;

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }
}

/// Bridge a WebSocket connection to a remote SSH shell session.
async fn handle_ssh_session(
    socket: WebSocket,
    terminal: crate::db::entities::ssh_terminals::Model,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    let host = terminal.host.clone();
    let port = terminal.port as u16;
    let username = terminal.username.clone();
    let auth_method = terminal.auth_method.clone();
    let password = terminal.password.clone();
    let private_key = terminal.private_key.clone();
    let passphrase = terminal.passphrase.clone();
    let startup_command = terminal.startup_command.clone();

    // ── Establish SSH connection ──

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let addr = (host.as_str(), port);
    let mut handle = match client::connect(config, addr, SshClientHandler).await {
        Ok(h) => h,
        Err(e) => {
            let msg = format!("\x1b[31mSSH connection failed: {e}\x1b[0m\r\n");
            let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
            return;
        }
    };

    // Authenticate
    let auth_result = match auth_method.as_str() {
        "private_key" => {
            if let Some(ref key_pem) = private_key {
                match russh::keys::decode_secret_key(key_pem, passphrase.as_deref()) {
                    Ok(key) => {
                        let best_hash = handle
                            .best_supported_rsa_hash()
                            .await
                            .ok()
                            .flatten()
                            .flatten();
                        handle
                            .authenticate_publickey(
                                &username,
                                PrivateKeyWithHashAlg::new(Arc::new(key), best_hash),
                            )
                            .await
                    }
                    Err(e) => {
                        let msg = format!("\x1b[31mFailed to decode private key: {e}\x1b[0m\r\n");
                        let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
                        return;
                    }
                }
            } else {
                let _ = ws_sink
                    .send(Message::Binary(
                        b"\x1b[31mNo private key configured\x1b[0m\r\n"
                            .to_vec()
                            .into(),
                    ))
                    .await;
                return;
            }
        }
        _ => {
            let pwd = password.as_deref().unwrap_or("");
            handle.authenticate_password(&username, pwd).await
        }
    };

    match auth_result {
        Ok(result) if result.success() => {}
        Ok(_) => {
            let _ = ws_sink
                .send(Message::Binary(
                    b"\x1b[31mSSH authentication failed\x1b[0m\r\n"
                        .to_vec()
                        .into(),
                ))
                .await;
            return;
        }
        Err(e) => {
            let msg = format!("\x1b[31mSSH authentication error: {e}\x1b[0m\r\n");
            let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
            return;
        }
    }

    // Open a shell channel
    let channel = match handle.channel_open_session().await {
        Ok(ch) => ch,
        Err(e) => {
            let msg = format!("\x1b[31mFailed to open channel: {e}\x1b[0m\r\n");
            let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
            return;
        }
    };

    // Request PTY
    if let Err(e) = channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
    {
        let msg = format!("\x1b[31mFailed to request PTY: {e}\x1b[0m\r\n");
        let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
        return;
    }

    // Request shell
    if let Err(e) = channel.request_shell(false).await {
        let msg = format!("\x1b[31mFailed to request shell: {e}\x1b[0m\r\n");
        let _ = ws_sink.send(Message::Binary(msg.into_bytes().into())).await;
        return;
    }

    // Split channel for bidirectional I/O
    let (mut read_half, write_half) = channel.split();

    // Wrap write_half in Arc<Mutex> so both data-writer and resize tasks can use it
    let write_half = Arc::new(tokio::sync::Mutex::new(write_half));

    // Send startup command if configured
    if let Some(ref cmd) = startup_command {
        if !cmd.is_empty() {
            let cmd_with_newline = format!("{cmd}\n");
            let wh = write_half.lock().await;
            let _ = wh.data(cmd_with_newline.as_bytes()).await;
        }
    }

    // Channel for resize commands (WebSocket → SSH)
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(16);

    // ── Task 1: SSH stdout → WebSocket ──
    let (ssh_out_tx, mut ssh_out_rx) = mpsc::channel::<Vec<u8>>(256);
    let read_task = tokio::spawn(async move {
        while let Some(msg) = read_half.wait().await {
            match msg {
                russh::ChannelMsg::Data { ref data } => {
                    if ssh_out_tx.send(data.to_vec()).await.is_err() {
                        break;
                    }
                }
                russh::ChannelMsg::ExtendedData { ref data, .. } => {
                    if ssh_out_tx.send(data.to_vec()).await.is_err() {
                        break;
                    }
                }
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
    });

    let send_task = tokio::spawn(async move {
        while let Some(data) = ssh_out_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // ── Task 2: WebSocket → SSH stdin ──
    let write_half_clone = Arc::clone(&write_half);
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) => {
                    let wh = write_half_clone.lock().await;
                    if wh.data(&data[..]).await.is_err() {
                        break;
                    }
                }
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) = serde_json::from_str::<ResizePayload>(json_str) {
                            let _ = resize_tx.send((resize.cols, resize.rows)).await;
                        }
                    } else {
                        let wh = write_half_clone.lock().await;
                        if wh.data(text.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // ── Task 3: Handle resize commands ──
    let resize_task = tokio::spawn(async move {
        while let Some((cols, rows)) = resize_rx.recv().await {
            let wh = write_half.lock().await;
            let _ = wh.window_change(cols, rows, 0, 0).await;
        }
    });

    tokio::select! {
        _ = read_task => {}
        _ = send_task => {}
        _ = recv_task => {}
        _ = resize_task => {}
    }

    tracing::debug!("SSH terminal session ended");
}

// ── SSH exec helpers ─────────────────────────────────────────────────────────

/// Short-lived SSH client handler for exec operations.
struct ExecSshHandler;

impl client::Handler for ExecSshHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }
}

/// Open a short-lived SSH connection, authenticate, run `cmd`, return stdout.
async fn ssh_exec_command(
    terminal: &crate::db::entities::ssh_terminals::Model,
    cmd: &str,
) -> Result<String, AppError> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(15)),
        ..Default::default()
    });

    let addr = (terminal.host.as_str(), terminal.port as u16);
    let mut handle = client::connect(config, addr, ExecSshHandler)
        .await
        .map_err(|e| AppError::Internal(format!("SSH connect: {e}")))?;

    // Authenticate
    match terminal.auth_method.as_str() {
        "private_key" => {
            let key_pem = terminal
                .private_key
                .as_deref()
                .ok_or_else(|| AppError::Internal("no private key".into()))?;
            let key = russh::keys::decode_secret_key(key_pem, terminal.passphrase.as_deref())
                .map_err(|e| AppError::Internal(format!("decode key: {e}")))?;
            let best_hash = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let result = handle
                .authenticate_publickey(
                    &terminal.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), best_hash),
                )
                .await
                .map_err(|e| AppError::Internal(format!("auth: {e}")))?;
            if !result.success() {
                return Err(AppError::Internal("auth failed".into()));
            }
        }
        _ => {
            let pwd = terminal.password.as_deref().unwrap_or("");
            let result = handle
                .authenticate_password(&terminal.username, pwd)
                .await
                .map_err(|e| AppError::Internal(format!("auth: {e}")))?;
            if !result.success() {
                return Err(AppError::Internal("auth failed".into()));
            }
        }
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Internal(format!("channel: {e}")))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| AppError::Internal(format!("exec: {e}")))?;

    let mut stdout = Vec::new();
    let (mut read_half, _write_half) = channel.split();
    while let Some(msg) = read_half.wait().await {
        match msg {
            russh::ChannelMsg::Data { ref data } => {
                stdout.extend_from_slice(data);
            }
            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
            _ => {}
        }
    }

    String::from_utf8(stdout).map_err(|e| AppError::Internal(format!("utf8: {e}")))
}

// ── GET /api/ssh-terminals/{id}/stats ────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshHostStats {
    /// CPU usage percentage (0–100)
    pub cpu_usage_percent: f64,
    /// Memory total in bytes
    #[ts(type = "number")]
    pub mem_total_bytes: u64,
    /// Memory used in bytes
    #[ts(type = "number")]
    pub mem_used_bytes: u64,
    /// Memory available in bytes
    #[ts(type = "number")]
    pub mem_available_bytes: u64,
    /// Memory usage percentage (0–100)
    pub mem_usage_percent: f64,
    /// Swap total in bytes
    #[ts(type = "number")]
    pub swap_total_bytes: u64,
    /// Swap used in bytes
    #[ts(type = "number")]
    pub swap_used_bytes: u64,
    /// Buffers in bytes
    #[ts(type = "number")]
    pub mem_buffers_bytes: u64,
    /// Cached in bytes
    #[ts(type = "number")]
    pub mem_cached_bytes: u64,
}

/// GET /api/ssh-terminals/{id}/stats — fetch remote host CPU + memory usage.
pub async fn ssh_terminal_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshHostStats>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    // One-liner: grab CPU idle% and memory stats in a single exec.
    // We sample /proc/stat twice (200 ms apart) to compute CPU usage.
    let script = r#"
cpu1=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat);
sleep 0.2;
cpu2=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat);
echo "CPU $cpu1 $cpu2";
awk '/MemTotal:|MemAvailable:|Buffers:|^Cached:|SwapTotal:|SwapFree:/ {print $1, $2}' /proc/meminfo
"#;

    let output = ssh_exec_command(&terminal, script).await?;
    let stats = parse_host_stats(&output)?;
    Ok(ok(stats))
}

fn parse_host_stats(output: &str) -> Result<SshHostStats, AppError> {
    let mut cpu_usage = 0.0;
    let mut mem_total_kb: u64 = 0;
    let mut mem_available_kb: u64 = 0;
    let mut mem_buffers_kb: u64 = 0;
    let mut mem_cached_kb: u64 = 0;
    let mut swap_total_kb: u64 = 0;
    let mut swap_free_kb: u64 = 0;

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("CPU ") {
            let parts: Vec<f64> = rest
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();
            if parts.len() >= 4 {
                let total_delta = parts[2] - parts[0];
                let idle_delta = parts[3] - parts[1];
                if total_delta > 0.0 {
                    cpu_usage =
                        ((total_delta - idle_delta) / total_delta * 100.0).clamp(0.0, 100.0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("MemTotal:") {
            mem_total_kb = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            mem_available_kb = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("Buffers:") {
            mem_buffers_kb = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("Cached:") {
            mem_cached_kb = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("SwapTotal:") {
            swap_total_kb = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("SwapFree:") {
            swap_free_kb = rest.trim().parse().unwrap_or(0);
        }
    }

    let mem_total_bytes = mem_total_kb * 1024;
    let mem_available_bytes = mem_available_kb * 1024;
    let mem_used_bytes = mem_total_bytes.saturating_sub(mem_available_bytes);
    let mem_usage_percent = if mem_total_bytes > 0 {
        (mem_used_bytes as f64 / mem_total_bytes as f64 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let swap_total_bytes = swap_total_kb * 1024;
    let swap_used_bytes = swap_total_bytes.saturating_sub(swap_free_kb * 1024);

    Ok(SshHostStats {
        cpu_usage_percent: (cpu_usage * 10.0).round() / 10.0,
        mem_total_bytes,
        mem_used_bytes,
        mem_available_bytes,
        mem_usage_percent: (mem_usage_percent * 10.0).round() / 10.0,
        swap_total_bytes,
        swap_used_bytes,
        mem_buffers_bytes: mem_buffers_kb * 1024,
        mem_cached_bytes: mem_cached_kb * 1024,
    })
}

// ── GET /api/ssh-terminals/{id}/ls ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LsQuery {
    #[serde(default = "default_ls_path")]
    pub path: String,
}

fn default_ls_path() -> String {
    "/".into()
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshFileEntry {
    pub name: String,
    pub is_dir: bool,
    /// Size in bytes (0 for directories)
    #[ts(type = "number")]
    pub size: u64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshLsResponse {
    pub path: String,
    pub entries: Vec<SshFileEntry>,
}

/// GET /api/ssh-terminals/{id}/ls?path=/ — list remote directory.
pub async fn ssh_terminal_ls(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<LsQuery>,
) -> Result<Json<ApiResponse<SshLsResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    // Use find -printf for reliable cross-platform output.
    // %y = type char (d/f/l/…), %s = size, %f = filename only
    let safe_path = query.path.replace('\'', "'\\''");
    let cmd = format!(
        "find '{safe_path}' -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%f\\n' 2>/dev/null; echo '---END---'"
    );

    let output = ssh_exec_command(&terminal, &cmd).await?;
    let entries = parse_ls_output(&output);

    Ok(ok(SshLsResponse {
        path: query.path,
        entries,
    }))
}

fn parse_ls_output(output: &str) -> Vec<SshFileEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        if line == "---END---" || line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let file_type = parts[0];
        let size: u64 = parts[1].parse().unwrap_or(0);
        let name = parts[2].to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        // find -printf %y: d = directory, f = regular file, l = symlink, etc.
        let is_dir = file_type == "d";
        entries.push(SshFileEntry {
            name,
            is_dir,
            size: if is_dir { 0 } else { size },
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

// ── GET /api/ssh-terminals/{id}/ps ───────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshProcessEntry {
    pub pid: u32,
    pub user: String,
    pub cpu: f64,
    pub mem: f64,
    #[ts(type = "number")]
    pub vsz_kb: u64,
    #[ts(type = "number")]
    pub rss_kb: u64,
    pub stat: String,
    pub command: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshPsResponse {
    pub processes: Vec<SshProcessEntry>,
}

/// GET /api/ssh-terminals/{id}/ps — list remote processes.
pub async fn ssh_terminal_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshPsResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cmd = "ps aux --sort=-%cpu 2>/dev/null || ps aux 2>/dev/null; echo '---PS_END---'";
    let output = ssh_exec_command(&terminal, cmd).await?;
    let processes = parse_ps_output(&output);

    Ok(ok(SshPsResponse { processes }))
}

fn parse_ps_output(output: &str) -> Vec<SshProcessEntry> {
    let mut entries = Vec::new();
    let mut header_seen = false;
    for line in output.lines() {
        if line == "---PS_END---" || line.is_empty() {
            continue;
        }
        // Skip the header line (starts with USER or user)
        if !header_seen {
            if line.starts_with("USER") || line.starts_with("user") {
                header_seen = true;
            }
            continue;
        }
        // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        let mut parts = line.split_whitespace();
        let user = match parts.next() {
            Some(u) => u.to_string(),
            None => continue,
        };
        let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let cpu: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
        let mem: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
        let vsz_kb: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let rss_kb: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let _tty = parts.next(); // skip TTY
        let stat = parts.next().unwrap_or("").to_string();
        let _start = parts.next(); // skip START
        let _time = parts.next(); // skip TIME
                                  // Remaining is the command (may contain spaces)
        let command: String = parts.collect::<Vec<_>>().join(" ");
        if pid == 0 && command.is_empty() {
            continue;
        }
        entries.push(SshProcessEntry {
            pid,
            user,
            cpu,
            mem,
            vsz_kb,
            rss_kb,
            stat,
            command,
        });
    }
    entries
}

/// POST /api/ssh-terminals/{id}/kill — kill a process on remote host.
pub async fn ssh_terminal_kill(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<KillProcessInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let signal = body.signal.as_deref().unwrap_or("TERM");
    // Validate signal name to prevent command injection
    if !signal.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("invalid signal".into()));
    }
    let cmd = format!("kill -{signal} {} 2>&1", body.pid);
    let output = ssh_exec_command(&terminal, &cmd).await?;
    if output.contains("No such process") {
        return Err(AppError::NotFound("process not found".into()));
    }
    Ok(ok(()))
}

#[derive(Debug, Deserialize)]
pub struct KillProcessInput {
    pub pid: u32,
    pub signal: Option<String>,
}

// ── GET /api/ssh-terminals/{id}/df ───────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDiskEntry {
    /// Filesystem device name (e.g. /dev/sda1)
    pub filesystem: String,
    /// Mount point (e.g. /)
    pub mount_point: String,
    /// Total bytes
    #[ts(type = "number")]
    pub total_bytes: u64,
    /// Used bytes
    #[ts(type = "number")]
    pub used_bytes: u64,
    /// Available bytes
    #[ts(type = "number")]
    pub available_bytes: u64,
    /// Usage percentage (0–100)
    pub usage_percent: f64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDfResponse {
    pub disks: Vec<SshDiskEntry>,
}

/// GET /api/ssh-terminals/{id}/df — fetch remote host disk usage.
pub async fn ssh_terminal_df(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDfResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    // df -B1 outputs in bytes for precise values, --output selects columns
    let script = "df -B1 --output=source,target,size,used,avail 2>/dev/null | tail -n +2";
    let output = ssh_exec_command(&terminal, script).await?;

    let mut disks = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let filesystem = parts[0].to_string();
        // Skip pseudo/virtual filesystems
        if filesystem.starts_with("tmpfs")
            || filesystem.starts_with("devtmpfs")
            || filesystem == "none"
            || filesystem == "udev"
            || filesystem == "overlay"
        {
            continue;
        }
        let mount_point = parts[1].to_string();
        let total_bytes: u64 = parts[2].parse().unwrap_or(0);
        let used_bytes: u64 = parts[3].parse().unwrap_or(0);
        let available_bytes: u64 = parts[4].parse().unwrap_or(0);
        if total_bytes == 0 {
            continue;
        }
        let usage_percent =
            ((used_bytes as f64 / total_bytes as f64) * 100.0 * 10.0).round() / 10.0;

        disks.push(SshDiskEntry {
            filesystem,
            mount_point,
            total_bytes,
            used_bytes,
            available_bytes,
            usage_percent,
        });
    }

    Ok(ok(SshDfResponse { disks }))
}
