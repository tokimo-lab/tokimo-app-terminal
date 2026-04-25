use std::sync::Arc;

use axum::{
    body::Body,
    extract::{
        Multipart, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json},
};
use futures_util::{SinkExt, StreamExt};
use tokimo_package_ssh::SshCredentials;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::AppState;
use crate::db::repos::ssh_terminal_repo::{CreateSshTerminalData, SshTerminalRepo, UpdateSshTerminalData};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::media::stream::mime_for;
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok, ok_empty};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn to_creds(m: &crate::db::entities::ssh_terminals::Model) -> SshCredentials {
    SshCredentials {
        host: m.host.clone(),
        port: m.port as u16,
        username: m.username.clone(),
        auth_method: m.auth_method.clone(),
        password: m.password.clone(),
        private_key: m.private_key.clone(),
        passphrase: m.passphrase.clone(),
    }
}

async fn get_creds(state: &AppState, id: &str) -> Result<SshCredentials, AppError> {
    let id: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    Ok(to_creds(&terminal))
}

// ── Input DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshTerminalInput {
    pub name: String,
    pub host: String,
    pub port: Option<i32>,
    pub username: String,
    pub auth_method: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub startup_command: Option<String>,
    pub notes: Option<String>,
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
    pub notes: Option<String>,
    pub sort_order: Option<i32>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SshWsQuery {
    pub id: String,
    /// Client-supplied session ID for reconnecting to an existing shell.
    /// If omitted, a fresh session is started.
    pub session_id: Option<String>,
}

#[derive(Deserialize)]
struct ResizePayload {
    cols: u32,
    rows: u32,
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
pub struct SshMvInput {
    pub from: String,
    pub to_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWriteFileInput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct LsQuery {
    #[serde(default = "default_ls_path")]
    pub path: String,
}

fn default_ls_path() -> String {
    "/".into()
}

#[derive(Debug, Deserialize)]
pub struct KillProcessInput {
    pub pid: u32,
    pub signal: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerActionInput {
    pub container_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerLogsInput {
    pub container_id: String,
    pub tail: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImageActionInput {
    pub image_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInspectQuery {
    pub container_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetworkActionInput {
    pub network_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolumeActionInput {
    pub volume_name: String,
}

// ── CRUD Handlers ────────────────────────────────────────────────────────────

pub async fn list_ssh_terminals(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
) -> Result<Json<ApiResponse<Vec<crate::db::models::ssh_terminal::SshTerminalOutput>>>, AppError> {
    let terminals = SshTerminalRepo::list_all(&state.db).await?;
    Ok(ok(terminals))
}

pub async fn get_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let id: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_by_id(&state.db, id).await?;
    Ok(ok(terminal))
}

pub async fn create_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Json(input): Json<CreateSshTerminalInput>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let terminal = SshTerminalRepo::create(
        &state.db,
        CreateSshTerminalData {
            name: input.name.clone(),
            host: input.host.clone(),
            port: input.port.unwrap_or(22),
            username: input.username.clone(),
            auth_method: input.auth_method.clone().unwrap_or_else(|| "password".to_string()),
            password: input.password.clone(),
            private_key: input.private_key.clone(),
            passphrase: input.passphrase.clone(),
            startup_command: input.startup_command.clone(),
            notes: input.notes.clone(),
            sort_order: input.sort_order.unwrap_or(0),
        },
    )
    .await?;
    Ok(ok(terminal))
}

pub async fn update_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateSshTerminalInput>,
) -> Result<Json<ApiResponse<crate::db::models::ssh_terminal::SshTerminalOutput>>, AppError> {
    let id: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::update(
        &state.db,
        id,
        UpdateSshTerminalData {
            name: input.name.clone(),
            host: input.host.clone(),
            port: input.port,
            username: input.username.clone(),
            auth_method: input.auth_method.clone(),
            password: input.password.as_ref().map(|s| Some(s.clone())),
            private_key: input.private_key.as_ref().map(|s| Some(s.clone())),
            passphrase: input.passphrase.as_ref().map(|s| Some(s.clone())),
            startup_command: input.startup_command.as_ref().map(|s| Some(s.clone())),
            notes: input.notes.as_ref().map(|s| Some(s.clone())),
            sort_order: input.sort_order,
            is_enabled: input.is_enabled,
        },
    )
    .await?;
    Ok(ok(terminal))
}

pub async fn delete_ssh_terminal(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let id: Uuid = id.parse().map_err(|_| AppError::BadRequest("invalid id".into()))?;
    SshTerminalRepo::delete(&state.db, id).await?;
    Ok(ok_empty())
}

// ── WebSocket SSH relay ──────────────────────────────────────────────────────

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
    let session_id = query.session_id.clone();
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let creds = to_creds(&terminal);
    let startup_command = terminal.startup_command.clone();
    let registry = state.ssh_sessions.clone();
    Ok(ws.on_upgrade(move |socket| handle_ssh_ws(socket, session_id, creds, startup_command, registry)))
}

/// Attach a WebSocket client to a (possibly existing) SSH shell session.
///
/// * If `session_id` already exists in the registry, the client receives a
///   history replay and then streams live output from the running shell.
/// * If not, a new SSH connection is established and registered under
///   `session_id` (or a fresh UUID when none is supplied).
async fn handle_ssh_ws(
    socket: WebSocket,
    session_id: Option<String>,
    creds: SshCredentials,
    startup_command: Option<String>,
    registry: crate::common::ssh_session_registry::SshSessionRegistry,
) {
    use crate::common::ssh_session_registry::SshSessionEntry;

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Per-client output channel (capacity large enough to buffer history replay).
    let (client_tx, mut client_rx) = mpsc::channel::<bytes::Bytes>(1024);

    let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    // ── Attach to existing session or create a new one ────────────────────
    let input_tx = {
        let mut reg = registry.lock().await;

        if let Some(entry) = reg.get_mut(&session_id) {
            // Replay scrollback so the reconnecting client sees previous output.
            if !entry.history.is_empty() {
                // best-effort; channel is freshly created so this won't block.
                let _ = client_tx.try_send(bytes::Bytes::from(entry.history.clone()));
            }
            // The session is already authenticated & running — tell the client immediately.
            let _ = client_tx.try_send(bytes::Bytes::from_static(tokimo_package_ssh::session::SSH_READY_MARKER));
            entry.clients.push(client_tx);
            entry.input_tx.clone()
        } else {
            // New session: open SSH shell and register in the map.
            let (input_tx, input_rx) = mpsc::channel::<tokimo_package_ssh::ShellInput>(256);
            let (output_tx, mut output_rx) = mpsc::channel::<bytes::Bytes>(256);

            reg.insert(
                session_id.clone(),
                SshSessionEntry {
                    input_tx: input_tx.clone(),
                    history: Vec::new(),
                    clients: vec![client_tx],
                },
            );
            drop(reg); // release lock before spawning

            // Task: distribute SSH output → history buffer + all clients.
            let registry_d = registry.clone();
            let session_id_d = session_id.clone();
            tokio::spawn(async move {
                while let Some(data) = output_rx.recv().await {
                    let mut reg = registry_d.lock().await;
                    if let Some(entry) = reg.get_mut(&session_id_d) {
                        entry.broadcast(data);
                    }
                }
                // Shell exited (output_tx dropped) — remove from registry.
                registry_d.lock().await.remove(&session_id_d);
                tracing::debug!("SSH session {session_id_d} ended; removed from registry");
            });

            // Task: run the interactive SSH shell.
            tokio::spawn(async move {
                if let Err(e) = tokimo_package_ssh::session::run_interactive_shell(
                    &creds,
                    startup_command.as_deref(),
                    output_tx,
                    input_rx,
                )
                .await
                {
                    tracing::error!("SSH session error: {e}");
                }
            });

            input_tx
        }
    };

    // ── Bridge: WebSocket → SSH input ─────────────────────────────────────
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data)
                    if input_tx
                        .send(tokimo_package_ssh::ShellInput::Data(data.to_vec()))
                        .await
                        .is_err()
                    => {
                        break;
                    }
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) = serde_json::from_str::<ResizePayload>(json_str) {
                            let _ = input_tx
                                .send(tokimo_package_ssh::ShellInput::Resize {
                                    cols: resize.cols,
                                    rows: resize.rows,
                                })
                                .await;
                        }
                    } else if input_tx
                        .send(tokimo_package_ssh::ShellInput::Data(text.as_bytes().to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // ── Bridge: client_rx → WebSocket output ──────────────────────────────
    let send_task = tokio::spawn(async move {
        while let Some(data) = client_rx.recv().await {
            if ws_sink.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
        // Channel closed (SSH session ended) — send a proper close frame so the
        // browser fires `onclose`.
        let _ = ws_sink.send(Message::Close(None)).await;
        let _ = ws_sink.close().await;
    });

    tokio::select! {
        _ = recv_task => {}
        _ = send_task => {}
    }

    tracing::debug!("SSH WebSocket client disconnected from session {session_id}");
}

// ── System info handlers ─────────────────────────────────────────────────────

pub async fn ssh_terminal_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshHostStats>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let stats = tokimo_package_ssh::system::get_stats(&creds).await?;
    Ok(ok(stats))
}

pub async fn ssh_terminal_ls(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<LsQuery>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::files::SshLsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::files::list_dir(&creds, &query.path).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshPsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::system::list_processes(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_kill(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<KillProcessInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let signal = body.signal.as_deref().unwrap_or("TERM");
    tokimo_package_ssh::system::kill_process(&creds, body.pid, signal).await?;
    Ok(ok(()))
}

pub async fn ssh_terminal_df(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshDfResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::system::get_disk_usage(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_net(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::network::SshNetworkResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::network::get_network_info(&creds).await?;
    Ok(ok(response))
}

// ── File operation handlers ──────────────────────────────────────────────────

pub async fn ssh_terminal_mkdir(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::files::mkdir(&creds, &input.path).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::files::rm(&creds, &input.path).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_rename(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshRenameInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::files::rename(&creds, &input.from, &input.to).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_mv(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshMvInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::files::mv_to_dir(&creds, &input.from, &input.to_dir).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_read_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::files::SshFileContentResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::files::read_file(&creds, &input.path).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_write_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshWriteFileInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::files::write_file(&creds, &input.path, &input.content).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_download(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SshFileOpInput>,
) -> Result<impl IntoResponse, AppError> {
    let creds = get_creds(&state, &id).await?;

    // Stream filename from the path
    let filename = query.path.rsplit('/').next().unwrap_or("download").to_string();
    let safe_filename = filename.replace('"', "\\\"");

    // Open the SSH channel and start streaming immediately — no full buffering.
    let rx = tokimo_package_ssh::files::download_stream(&creds, &query.path).await?;

    // Convert the mpsc receiver into an Axum streaming body.
    let byte_stream = ReceiverStream::new(rx).map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));

    let content_type = mime_for(&query.path);
    // Use inline disposition for previewable types (PDF, images, etc.)
    let disposition = if content_type == "application/octet-stream" {
        format!("attachment; filename=\"{safe_filename}\"")
    } else {
        format!("inline; filename=\"{safe_filename}\"")
    };
    let headers = [
        (axum::http::header::CONTENT_TYPE, content_type.to_string()),
        (axum::http::header::CONTENT_DISPOSITION, disposition),
    ];

    Ok((headers, Body::from_stream(byte_stream)))
}

#[derive(Debug, Deserialize)]
pub struct SshUploadQuery {
    /// Remote directory to upload into.
    pub path: String,
    /// File name to save as on the remote host.
    pub filename: String,
}

/// Multipart file upload: POST /api/ssh-terminals/{id}/upload
///
/// Query params: `path` (remote dir), `filename` (remote file name)
/// Body: multipart/form-data with a single `file` part containing the raw bytes.
pub async fn ssh_terminal_upload(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SshUploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;

    // Validate that the destination path looks sane (no null bytes, etc.)
    if query.path.contains('\0') || query.filename.contains('\0') {
        return Err(AppError::BadRequest("invalid path".into()));
    }
    // Reject path traversal in filename
    if query.filename.contains('/') || query.filename.contains("..") {
        return Err(AppError::BadRequest("filename must not contain '/' or '..'".into()));
    }

    let remote_path = if query.path.ends_with('/') {
        format!("{}{}", query.path, query.filename)
    } else {
        format!("{}/{}", query.path, query.filename)
    };

    // Read the (single) file part
    let mut file_bytes: Option<Vec<u8>> = None;
    if let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("read multipart field: {e}")))?;
        file_bytes = Some(bytes.to_vec());
    }

    let bytes = file_bytes.bad_request("no file in request")?;

    tokimo_package_ssh::files::upload_file(&creds, &remote_path, &bytes).await?;
    Ok(ok_empty())
}

// ── Docker handlers ──────────────────────────────────────────────────────────

pub async fn ssh_docker_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::ps(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_start(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::start(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_stop(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::stop(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_restart(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::restart(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_logs(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerLogsInput>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerLogsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let tail = body.tail.unwrap_or(200);
    let response = tokimo_package_ssh::docker::logs(&creds, &body.container_id, tail).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerImagesResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::images(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::rm(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_pause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::pause(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_unpause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::unpause(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_rmi(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerImageActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::rmi(&creds, &body.image_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerNetworksResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::networks(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_inspect(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(params): Query<DockerInspectQuery>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerInspectResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::inspect(&creds, &params.container_id).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerVolumesResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::volumes(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_volume_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerVolumeActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::volume_rm(&creds, &body.volume_name).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerStatsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::stats(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_network_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerNetworkActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    tokimo_package_ssh::docker::network_rm(&creds, &body.network_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_prune_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::prune_images(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::prune_volumes(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::prune_networks(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_system(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = tokimo_package_ssh::docker::prune_system(&creds).await?;
    Ok(ok(response))
}
