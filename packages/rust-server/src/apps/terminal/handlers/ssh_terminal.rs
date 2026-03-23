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

/// Like `ssh_exec_command` but returns raw bytes (for binary file downloads).
async fn ssh_exec_command_bytes(
    terminal: &crate::db::entities::ssh_terminals::Model,
    cmd: &str,
) -> Result<Vec<u8>, AppError> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });
    let addr = (terminal.host.as_str(), terminal.port as u16);
    let mut handle = client::connect(config, addr, ExecSshHandler)
        .await
        .map_err(|e| AppError::Internal(format!("SSH connect: {e}")))?;
    ssh_authenticate(&mut handle, terminal).await?;

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
            russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(stdout)
}

/// Open an SSH connection, authenticate, run `cmd`, send `stdin_data`, return stdout.
async fn ssh_exec_command_with_stdin(
    terminal: &crate::db::entities::ssh_terminals::Model,
    cmd: &str,
    stdin_data: &[u8],
) -> Result<String, AppError> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });
    let addr = (terminal.host.as_str(), terminal.port as u16);
    let mut handle = client::connect(config, addr, ExecSshHandler)
        .await
        .map_err(|e| AppError::Internal(format!("SSH connect: {e}")))?;
    ssh_authenticate(&mut handle, terminal).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Internal(format!("channel: {e}")))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| AppError::Internal(format!("exec: {e}")))?;

    let (mut read_half, write_half) = channel.split();

    // Send stdin data
    write_half
        .data(&stdin_data[..])
        .await
        .map_err(|e| AppError::Internal(format!("write stdin: {e}")))?;
    write_half
        .eof()
        .await
        .map_err(|e| AppError::Internal(format!("eof: {e}")))?;

    let mut stdout = Vec::new();
    while let Some(msg) = read_half.wait().await {
        match msg {
            russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
            _ => {}
        }
    }
    String::from_utf8(stdout).map_err(|e| AppError::Internal(format!("utf8: {e}")))
}

/// Shared SSH authentication logic.
async fn ssh_authenticate(
    handle: &mut client::Handle<ExecSshHandler>,
    terminal: &crate::db::entities::ssh_terminals::Model,
) -> Result<(), AppError> {
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
    Ok(())
}

// ── File operation endpoints ─────────────────────────────────────────────────

/// Escape a path for safe shell usage (single-quote wrapping).
fn shell_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[derive(Debug, Deserialize)]
pub struct SshFileOpInput {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRenameInput {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWriteFileInput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshFileContentResponse {
    pub path: String,
    pub content: String,
}

/// POST /api/ssh-terminals/{id}/mkdir — create directory on remote host.
pub async fn ssh_terminal_mkdir(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let safe = shell_escape(&input.path);
    ssh_exec_command(&terminal, &format!("mkdir -p '{safe}'")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/rm — delete file or directory on remote host.
pub async fn ssh_terminal_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let safe = shell_escape(&input.path);
    ssh_exec_command(&terminal, &format!("rm -rf '{safe}'")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/rename — rename/move file on remote host.
pub async fn ssh_terminal_rename(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshRenameInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let from = shell_escape(&input.from);
    let to = shell_escape(&input.to);
    ssh_exec_command(&terminal, &format!("mv '{from}' '{to}'")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/read-file — read text file content from remote host.
pub async fn ssh_terminal_read_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<SshFileContentResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let safe = shell_escape(&input.path);
    let content = ssh_exec_command(&terminal, &format!("cat '{safe}'")).await?;
    Ok(ok(SshFileContentResponse {
        path: input.path,
        content,
    }))
}

/// POST /api/ssh-terminals/{id}/write-file — write text content to file on remote host.
pub async fn ssh_terminal_write_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshWriteFileInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let safe = shell_escape(&input.path);
    let cmd = format!("cat > '{safe}'");
    ssh_exec_command_with_stdin(&terminal, &cmd, input.content.as_bytes()).await?;
    Ok(ok_empty())
}

/// GET /api/ssh-terminals/{id}/download — download file as binary stream.
pub async fn ssh_terminal_download(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SshFileOpInput>,
) -> Result<impl IntoResponse, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let safe = shell_escape(&query.path);
    let bytes = ssh_exec_command_bytes(&terminal, &format!("cat '{safe}'")).await?;

    // Extract filename from path
    let filename = query
        .path
        .rsplit('/')
        .next()
        .unwrap_or("download")
        .to_string();
    let safe_filename = filename.replace('"', "\\\"");

    Ok((
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/octet-stream".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{safe_filename}\""),
            ),
        ],
        bytes,
    ))
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

// ── GET /api/ssh-terminals/{id}/net ──────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshNetworkInterfaceEntry {
    /// Interface name (e.g. eth0, lo)
    pub name: String,
    /// IP addresses with prefix (e.g. 192.168.1.2/24)
    pub ip_addresses: Vec<String>,
    /// MAC address (e.g. 00:11:22:33:44:55)
    pub mac_address: String,
    /// Whether the interface is up
    pub is_up: bool,
    /// MTU value
    #[ts(type = "number | null")]
    pub mtu: Option<u64>,
    /// Total received bytes
    #[ts(type = "number")]
    pub rx_bytes: u64,
    /// Total transmitted bytes
    #[ts(type = "number")]
    pub tx_bytes: u64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshListeningSocketEntry {
    /// Protocol (tcp, udp)
    pub protocol: String,
    /// Local address (e.g. 0.0.0.0:80, :::443)
    pub local_address: String,
    /// Peer address
    pub peer_address: String,
    /// Socket state (LISTEN, ESTAB, etc.)
    pub state: String,
    /// Process info (e.g. "nginx" or "pid/name")
    pub process: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshConnectionEntry {
    /// Protocol (tcp, udp)
    pub protocol: String,
    /// Local address
    pub local_address: String,
    /// Peer/remote address
    pub peer_address: String,
    /// Connection state (ESTAB, TIME-WAIT, etc.)
    pub state: String,
    /// Process name
    pub process: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshRouteEntry {
    /// Destination network (e.g. "default", "192.168.1.0/24")
    pub destination: String,
    /// Gateway address (e.g. "172.17.0.1")
    pub gateway: String,
    /// Network interface (e.g. "eth0")
    pub iface: String,
    /// Protocol (e.g. "kernel", "dhcp", "static")
    pub protocol: String,
    /// Scope (e.g. "link", "global")
    pub scope: String,
    /// Metric value
    pub metric: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshNetworkResponse {
    pub interfaces: Vec<SshNetworkInterfaceEntry>,
    pub listening: Vec<SshListeningSocketEntry>,
    pub connections: Vec<SshConnectionEntry>,
    pub routes: Vec<SshRouteEntry>,
}

/// GET /api/ssh-terminals/{id}/net — fetch remote host network info.
pub async fn ssh_terminal_net(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshNetworkResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    // Collect interface info, listening sockets, and established connections in one script
    let script = r#"echo '===INTERFACES===';
ip -o addr show 2>/dev/null || ifconfig 2>/dev/null;
echo '===LINKS===';
ip -o link show 2>/dev/null;
echo '===LISTENING===';
ss -tunlp 2>/dev/null | tail -n +2;
echo '===CONNECTIONS===';
ss -tunp state established 2>/dev/null | tail -n +2;
echo '===RX_TX===';
cat /proc/net/dev 2>/dev/null | tail -n +3;
echo '===ROUTES===';
ip route show 2>/dev/null"#;

    let output = ssh_exec_command(&terminal, script).await?;

    let mut interfaces: Vec<SshNetworkInterfaceEntry> = Vec::new();
    let mut listening: Vec<SshListeningSocketEntry> = Vec::new();
    let mut connections: Vec<SshConnectionEntry> = Vec::new();
    let mut routes: Vec<SshRouteEntry> = Vec::new();

    // Parse sections
    let sections: Vec<&str> = output.split("===").collect();

    // Helper to find section content by name
    let find_section = |name: &str| -> String {
        for i in 0..sections.len() {
            if sections[i].trim() == name && i + 1 < sections.len() {
                return sections[i + 1].to_string();
            }
        }
        String::new()
    };

    let iface_section = find_section("INTERFACES");
    let links_section = find_section("LINKS");
    let listening_section = find_section("LISTENING");
    let connections_section = find_section("CONNECTIONS");
    let rxtx_section = find_section("RX_TX");
    let routes_section = find_section("ROUTES");

    // Parse ip -o addr output: "2: eth0    inet 172.17.0.2/16 ..."
    let mut iface_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for line in iface_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let name = parts[1].trim_end_matches(':').to_string();
            // parts[2] = "inet" or "inet6", parts[3] = addr/prefix
            let addr = parts[3].to_string();
            iface_map.entry(name).or_default().push(addr);
        }
    }

    // Parse ip -o link output for MAC and state: "2: eth0: <...UP...> ... link/ether aa:bb:cc ..."
    let mut link_info: std::collections::HashMap<String, (String, bool, Option<u64>)> =
        std::collections::HashMap::new();
    for line in links_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let name = parts[1].trim_end_matches(':').to_string();
            let is_up = line.contains("UP");
            let mut mac = String::new();
            let mut mtu: Option<u64> = None;
            for (i, p) in parts.iter().enumerate() {
                if *p == "link/ether" && i + 1 < parts.len() {
                    mac = parts[i + 1].to_string();
                }
                if *p == "mtu" && i + 1 < parts.len() {
                    mtu = parts[i + 1].parse().ok();
                }
            }
            link_info.insert(name, (mac, is_up, mtu));
        }
    }

    // Parse /proc/net/dev for RX/TX bytes
    let mut rxtx_map: std::collections::HashMap<String, (u64, u64)> =
        std::collections::HashMap::new();
    for line in rxtx_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((name, rest)) = line.split_once(':') {
            let name = name.trim().to_string();
            let nums: Vec<u64> = rest
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();
            if nums.len() >= 9 {
                rxtx_map.insert(name, (nums[0], nums[8])); // rx_bytes, tx_bytes
            }
        }
    }

    // Merge into interface entries
    let mut all_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for name in iface_map.keys() {
        all_names.insert(name.clone());
    }
    for name in link_info.keys() {
        all_names.insert(name.clone());
    }
    for name in &all_names {
        let ip_addresses = iface_map.get(name).cloned().unwrap_or_default();
        let (mac_address, is_up, mtu) = link_info.get(name).cloned().unwrap_or_default();
        let (rx_bytes, tx_bytes) = rxtx_map.get(name).copied().unwrap_or((0, 0));
        interfaces.push(SshNetworkInterfaceEntry {
            name: name.clone(),
            ip_addresses,
            mac_address,
            is_up,
            mtu,
            rx_bytes,
            tx_bytes,
        });
    }
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));

    // Parse ss -tunlp output for listening sockets
    // Format: "tcp   LISTEN  0  128  0.0.0.0:22  0.0.0.0:*  users:(("sshd",pid=1,fd=3))"
    for line in listening_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let protocol = parts[0].to_string();
            let state = parts[1].to_string();
            let local_address = parts[4].to_string();
            let peer_address = if parts.len() > 5 {
                parts[5].to_string()
            } else {
                String::new()
            };
            let process = if parts.len() > 6 {
                // Extract process name from users:(("name",...))
                let raw = parts[6..].join(" ");
                extract_process_name(&raw)
            } else {
                String::new()
            };
            listening.push(SshListeningSocketEntry {
                protocol,
                local_address,
                peer_address,
                state,
                process,
            });
        }
    }

    // Parse ss -tunp state established
    for line in connections_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let protocol = parts[0].to_string();
            let local_address = parts[3].to_string();
            let peer_address = parts[4].to_string();
            let process = if parts.len() > 5 {
                let raw = parts[5..].join(" ");
                extract_process_name(&raw)
            } else {
                String::new()
            };
            connections.push(SshConnectionEntry {
                protocol,
                local_address,
                peer_address,
                state: "ESTAB".to_string(),
                process,
            });
        }
    }

    // Parse ip route show output
    // Format: "default via 172.17.0.1 dev eth0 proto dhcp metric 100"
    //         "172.17.0.0/16 dev eth0 proto kernel scope link src 172.17.0.2"
    for line in routes_section.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let destination = parts[0].to_string();
        let mut gateway = String::new();
        let mut iface = String::new();
        let mut protocol = String::new();
        let mut scope = String::new();
        let mut metric = String::new();
        let mut i = 1;
        while i < parts.len() {
            match parts[i] {
                "via" if i + 1 < parts.len() => {
                    gateway = parts[i + 1].to_string();
                    i += 2;
                }
                "dev" if i + 1 < parts.len() => {
                    iface = parts[i + 1].to_string();
                    i += 2;
                }
                "proto" if i + 1 < parts.len() => {
                    protocol = parts[i + 1].to_string();
                    i += 2;
                }
                "scope" if i + 1 < parts.len() => {
                    scope = parts[i + 1].to_string();
                    i += 2;
                }
                "metric" if i + 1 < parts.len() => {
                    metric = parts[i + 1].to_string();
                    i += 2;
                }
                _ => i += 1,
            }
        }
        routes.push(SshRouteEntry {
            destination,
            gateway,
            iface,
            protocol,
            scope,
            metric,
        });
    }

    Ok(ok(SshNetworkResponse {
        interfaces,
        listening,
        connections,
        routes,
    }))
}

/// Extract process name from ss users field like `users:(("sshd",pid=1234,fd=3))`
fn extract_process_name(raw: &str) -> String {
    if let Some(start) = raw.find("((\"") {
        if let Some(end) = raw[start + 3..].find('"') {
            return raw[start + 3..start + 3 + end].to_string();
        }
    }
    raw.to_string()
}

// ── Docker helpers ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerContainerEntry {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    #[ts(type = "number")]
    pub created_ts: i64,
    pub ports: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerPsResponse {
    pub available: bool,
    pub containers: Vec<DockerContainerEntry>,
}

/// GET /api/ssh-terminals/{id}/docker/ps — list Docker containers on remote host.
pub async fn ssh_docker_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerPsResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;

    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    // Check if docker/podman is available, then list all containers
    let script = r#"command -v docker >/dev/null 2>&1 && echo '__DOCKER_OK__' && docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.CreatedAt}}\t{{.Ports}}' 2>/dev/null || echo '__NO_DOCKER__'"#;
    let output = ssh_exec_command(&terminal, script).await?;

    if output.contains("__NO_DOCKER__") {
        return Ok(ok(SshDockerPsResponse {
            available: false,
            containers: Vec::new(),
        }));
    }

    let mut containers = Vec::new();
    for line in output.lines() {
        if line.starts_with("__DOCKER_OK__") || line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(7, '\t').collect();
        if parts.len() < 5 {
            continue;
        }
        containers.push(DockerContainerEntry {
            id: parts[0].to_string(),
            name: parts[1].to_string(),
            image: parts[2].to_string(),
            state: parts[3].to_string(),
            status: parts.get(4).unwrap_or(&"").to_string(),
            created_ts: parse_docker_time(parts.get(5).unwrap_or(&"")),
            ports: parts.get(6).unwrap_or(&"").to_string(),
        });
    }

    Ok(ok(SshDockerPsResponse {
        available: true,
        containers,
    }))
}

fn parse_docker_time(s: &str) -> i64 {
    // Docker outputs "2025-03-20 12:34:56 +0800 CST"
    // We just parse best-effort, return 0 on failure
    chrono::NaiveDateTime::parse_from_str(s.get(..19).unwrap_or(""), "%Y-%m-%d %H:%M:%S")
        .map(|dt| dt.and_utc().timestamp())
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerActionInput {
    pub container_id: String,
}

/// POST /api/ssh-terminals/{id}/docker/start — start a container.
pub async fn ssh_docker_start(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker start {cid}")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/docker/stop — stop a container.
pub async fn ssh_docker_stop(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker stop {cid}")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/docker/restart — restart a container.
pub async fn ssh_docker_restart(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker restart {cid}")).await?;
    Ok(ok_empty())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerLogsInput {
    pub container_id: String,
    pub tail: Option<u32>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerLogsResponse {
    pub logs: String,
}

/// POST /api/ssh-terminals/{id}/docker/logs — get recent container logs.
pub async fn ssh_docker_logs(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerLogsInput>,
) -> Result<Json<ApiResponse<SshDockerLogsResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    let tail = body.tail.unwrap_or(200).min(2000);
    let logs =
        ssh_exec_command(&terminal, &format!("docker logs --tail {tail} {cid} 2>&1")).await?;

    Ok(ok(SshDockerLogsResponse { logs }))
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerImageEntry {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerImagesResponse {
    pub images: Vec<DockerImageEntry>,
}

/// GET /api/ssh-terminals/{id}/docker/images — list Docker images.
pub async fn ssh_docker_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerImagesResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let script = r#"docker images --format '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null"#;
    let output = ssh_exec_command(&terminal, script).await?;

    let mut images = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(5, '\t').collect();
        if parts.len() < 4 {
            continue;
        }
        images.push(DockerImageEntry {
            id: parts[0].to_string(),
            repository: parts[1].to_string(),
            tag: parts[2].to_string(),
            size: parts.get(3).unwrap_or(&"").to_string(),
            created: parts.get(4).unwrap_or(&"").to_string(),
        });
    }

    Ok(ok(SshDockerImagesResponse { images }))
}

/// Validate container ID — only allow alphanumeric, dash, underscore, dot, colon, slash.
fn sanitize_container_id(id: &str) -> Result<&str, AppError> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::BadRequest("invalid container id".into()));
    }
    if id.chars().all(|c| {
        c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ':' || c == '/'
    }) {
        Ok(id)
    } else {
        Err(AppError::BadRequest("invalid container id".into()))
    }
}

// ── Docker container remove ──────────────────────────────────────────────────

/// POST /api/ssh-terminals/{id}/docker/rm — remove a stopped container.
pub async fn ssh_docker_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker rm {cid}")).await?;
    Ok(ok_empty())
}

// ── Docker pause / unpause ───────────────────────────────────────────────────

/// POST /api/ssh-terminals/{id}/docker/pause — pause a running container.
pub async fn ssh_docker_pause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker pause {cid}")).await?;
    Ok(ok_empty())
}

/// POST /api/ssh-terminals/{id}/docker/unpause — unpause a paused container.
pub async fn ssh_docker_unpause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let cid = sanitize_container_id(&body.container_id)?;
    ssh_exec_command(&terminal, &format!("docker unpause {cid}")).await?;
    Ok(ok_empty())
}

// ── Docker image remove ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImageActionInput {
    pub image_id: String,
}

/// POST /api/ssh-terminals/{id}/docker/rmi — remove a Docker image.
pub async fn ssh_docker_rmi(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerImageActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let img = sanitize_container_id(&body.image_id)?;
    ssh_exec_command(&terminal, &format!("docker rmi {img}")).await?;
    Ok(ok_empty())
}

// ── Docker networks ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerNetworkEntry {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub ipam_subnet: String,
    pub ipam_gateway: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerNetworksResponse {
    pub networks: Vec<DockerNetworkEntry>,
}

/// GET /api/ssh-terminals/{id}/docker/networks — list Docker networks.
pub async fn ssh_docker_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerNetworksResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let script =
        r#"docker network ls --format '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}' 2>/dev/null"#;
    let output = ssh_exec_command(&terminal, script).await?;

    // Also get IPAM info via inspect
    let inspect_script = r#"docker network inspect --format '{{.ID}}\t{{range .IPAM.Config}}{{.Subnet}}\t{{.Gateway}}{{end}}' $(docker network ls -q) 2>/dev/null"#;
    let inspect_output = ssh_exec_command(&terminal, inspect_script)
        .await
        .unwrap_or_default();

    // Build a map of network ID -> (subnet, gateway)
    let mut ipam_map = std::collections::HashMap::new();
    for line in inspect_output.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 1 {
            let nid = parts[0];
            let subnet = parts.get(1).unwrap_or(&"").to_string();
            let gateway = parts.get(2).unwrap_or(&"").to_string();
            ipam_map.insert(nid.to_string(), (subnet, gateway));
        }
    }

    let mut networks = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let net_id = parts[0].to_string();
        let (subnet, gateway) = ipam_map
            .get(&net_id)
            .cloned()
            .unwrap_or((String::new(), String::new()));
        networks.push(DockerNetworkEntry {
            id: net_id,
            name: parts[1].to_string(),
            driver: parts[2].to_string(),
            scope: parts.get(3).unwrap_or(&"").to_string(),
            ipam_subnet: subnet,
            ipam_gateway: gateway,
        });
    }

    Ok(ok(SshDockerNetworksResponse { networks }))
}

// ── Docker container inspect ─────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerContainerInspect {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub pid: i64,
    pub started_at: String,
    pub finished_at: String,
    pub restart_count: i64,
    pub platform: String,
    pub env: Vec<String>,
    pub cmd: String,
    pub entrypoint: String,
    pub working_dir: String,
    pub hostname: String,
    pub network_mode: String,
    pub port_bindings: String,
    pub mounts: Vec<DockerMountEntry>,
    pub networks: Vec<DockerContainerNetwork>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerMountEntry {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub rw: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerContainerNetwork {
    pub name: String,
    pub ip_address: String,
    pub gateway: String,
    pub mac_address: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerInspectResponse {
    pub container: DockerContainerInspect,
}

/// GET /api/ssh-terminals/{id}/docker/inspect?containerId=xxx — inspect a container.
pub async fn ssh_docker_inspect(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(params): Query<DockerInspectQuery>,
) -> Result<Json<ApiResponse<SshDockerInspectResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let cid = sanitize_container_id(&params.container_id)?;

    // Get JSON inspect output
    let output = ssh_exec_command(&terminal, &format!("docker inspect {cid} 2>/dev/null")).await?;

    let parsed: serde_json::Value =
        serde_json::from_str(&output).map_err(|e| AppError::Internal(format!("json: {e}")))?;

    let c = parsed
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| AppError::Internal("empty inspect".into()))?;

    let mounts = c["Mounts"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| DockerMountEntry {
                    source: m["Source"].as_str().unwrap_or("").to_string(),
                    destination: m["Destination"].as_str().unwrap_or("").to_string(),
                    mode: m["Mode"].as_str().unwrap_or("").to_string(),
                    rw: m["RW"].as_bool().unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();

    let networks = c["NetworkSettings"]["Networks"]
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(name, v)| DockerContainerNetwork {
                    name: name.clone(),
                    ip_address: v["IPAddress"].as_str().unwrap_or("").to_string(),
                    gateway: v["Gateway"].as_str().unwrap_or("").to_string(),
                    mac_address: v["MacAddress"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let env = c["Config"]["Env"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let port_bindings_val = &c["HostConfig"]["PortBindings"];
    let port_bindings = if port_bindings_val.is_object() {
        serde_json::to_string(port_bindings_val).unwrap_or_default()
    } else {
        String::new()
    };

    let container = DockerContainerInspect {
        id: c["Id"].as_str().unwrap_or("").to_string(),
        name: c["Name"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches('/')
            .to_string(),
        image: c["Config"]["Image"].as_str().unwrap_or("").to_string(),
        state: c["State"]["Status"].as_str().unwrap_or("").to_string(),
        pid: c["State"]["Pid"].as_i64().unwrap_or(0),
        started_at: c["State"]["StartedAt"].as_str().unwrap_or("").to_string(),
        finished_at: c["State"]["FinishedAt"].as_str().unwrap_or("").to_string(),
        restart_count: c["RestartCount"].as_i64().unwrap_or(0),
        platform: c["Platform"].as_str().unwrap_or("").to_string(),
        env,
        cmd: c["Config"]["Cmd"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default(),
        entrypoint: c["Config"]["Entrypoint"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default(),
        working_dir: c["Config"]["WorkingDir"].as_str().unwrap_or("").to_string(),
        hostname: c["Config"]["Hostname"].as_str().unwrap_or("").to_string(),
        network_mode: c["HostConfig"]["NetworkMode"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        port_bindings,
        mounts,
        networks,
    };

    Ok(ok(SshDockerInspectResponse { container }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInspectQuery {
    pub container_id: String,
}

// ── Docker volumes ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerVolumeEntry {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub scope: String,
    pub created: String,
    pub size: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerVolumesResponse {
    pub volumes: Vec<DockerVolumeEntry>,
}

/// GET /api/ssh-terminals/{id}/docker/volumes — list Docker volumes.
pub async fn ssh_docker_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerVolumesResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let script = r#"docker volume ls --format '{{.Name}}\t{{.Driver}}\t{{.Mountpoint}}\t{{.Scope}}\t{{.CreatedAt}}' 2>/dev/null"#;
    let output = ssh_exec_command(&terminal, script).await?;

    // Try to get sizes via docker system df -v
    let size_script = r#"docker system df -v --format '{{.Name}}\t{{.Size}}' 2>/dev/null | grep -v 'VOLUME' || true"#;
    let size_output = ssh_exec_command(&terminal, size_script)
        .await
        .unwrap_or_default();

    let mut size_map = std::collections::HashMap::new();
    for line in size_output.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() == 2 {
            size_map.insert(parts[0].to_string(), parts[1].to_string());
        }
    }

    let mut volumes = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(5, '\t').collect();
        if parts.is_empty() {
            continue;
        }
        let name = parts[0].to_string();
        let size = size_map.get(&name).cloned().unwrap_or_default();
        volumes.push(DockerVolumeEntry {
            name,
            driver: parts.get(1).unwrap_or(&"").to_string(),
            mountpoint: parts.get(2).unwrap_or(&"").to_string(),
            scope: parts.get(3).unwrap_or(&"").to_string(),
            created: parts.get(4).unwrap_or(&"").to_string(),
            size,
        });
    }

    Ok(ok(SshDockerVolumesResponse { volumes }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolumeActionInput {
    pub volume_name: String,
}

/// POST /api/ssh-terminals/{id}/docker/volume-rm — remove a Docker volume.
pub async fn ssh_docker_volume_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerVolumeActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let vname = sanitize_container_id(&body.volume_name)?;
    ssh_exec_command(&terminal, &format!("docker volume rm {vname}")).await?;
    Ok(ok_empty())
}

// ── Docker container stats ───────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DockerStatsEntry {
    pub container_id: String,
    pub name: String,
    pub cpu_percent: String,
    pub mem_usage: String,
    pub mem_limit: String,
    pub mem_percent: String,
    pub net_io: String,
    pub block_io: String,
    pub pids: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerStatsResponse {
    pub stats: Vec<DockerStatsEntry>,
}

/// GET /api/ssh-terminals/{id}/docker/stats — get resource usage of all running containers.
pub async fn ssh_docker_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerStatsResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let script = r#"docker stats --no-stream --format '{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' 2>/dev/null"#;
    let output = ssh_exec_command(&terminal, script).await?;

    let mut stats = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(8, '\t').collect();
        if parts.len() < 5 {
            continue;
        }
        // MemUsage format: "123MiB / 1GiB"
        let mem_parts: Vec<&str> = parts.get(3).unwrap_or(&"").split(" / ").collect();
        stats.push(DockerStatsEntry {
            container_id: parts[0].to_string(),
            name: parts[1].to_string(),
            cpu_percent: parts[2].to_string(),
            mem_usage: mem_parts.first().unwrap_or(&"").to_string(),
            mem_limit: mem_parts.get(1).unwrap_or(&"").to_string(),
            mem_percent: parts.get(4).unwrap_or(&"").to_string(),
            net_io: parts.get(5).unwrap_or(&"").to_string(),
            block_io: parts.get(6).unwrap_or(&"").to_string(),
            pids: parts.get(7).unwrap_or(&"").to_string(),
        });
    }

    Ok(ok(SshDockerStatsResponse { stats }))
}

// ── Docker network remove ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetworkActionInput {
    pub network_id: String,
}

/// POST /api/ssh-terminals/{id}/docker/network-rm — remove a Docker network.
pub async fn ssh_docker_network_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerNetworkActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let nid = sanitize_container_id(&body.network_id)?;
    ssh_exec_command(&terminal, &format!("docker network rm {nid}")).await?;
    Ok(ok_empty())
}

// ── Docker prune operations ──────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshDockerPruneResponse {
    pub output: String,
}

/// POST /api/ssh-terminals/{id}/docker/prune-images — remove unused images.
pub async fn ssh_docker_prune_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerPruneResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let output = ssh_exec_command(&terminal, "docker image prune -f 2>&1").await?;
    Ok(ok(SshDockerPruneResponse { output }))
}

/// POST /api/ssh-terminals/{id}/docker/prune-volumes — remove unused volumes.
pub async fn ssh_docker_prune_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerPruneResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let output = ssh_exec_command(&terminal, "docker volume prune -f 2>&1").await?;
    Ok(ok(SshDockerPruneResponse { output }))
}

/// POST /api/ssh-terminals/{id}/docker/prune-networks — remove unused networks.
pub async fn ssh_docker_prune_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerPruneResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let output = ssh_exec_command(&terminal, "docker network prune -f 2>&1").await?;
    Ok(ok(SshDockerPruneResponse { output }))
}

/// POST /api/ssh-terminals/{id}/docker/prune-system — docker system prune.
pub async fn ssh_docker_prune_system(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshDockerPruneResponse>>, AppError> {
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;

    let output = ssh_exec_command(&terminal, "docker system prune -f 2>&1").await?;
    Ok(ok(SshDockerPruneResponse { output }))
}
