use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::{IntoResponse, Json},
};
use futures_util::{SinkExt, StreamExt};
use rust_ssh_terminal::SshCredentials;
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::db::repos::ssh_terminal_repo::SshTerminalRepo;
use crate::error::AppError;
use crate::handlers::user::AuthUser;
use crate::handlers::{ok, ok_empty, ApiResponse};
use crate::AppState;

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
    let id: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid id".into()))?;
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    Ok(to_creds(&terminal))
}

// ── Input DTOs ───────────────────────────────────────────────────────────────

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

#[derive(Debug, Deserialize)]
pub struct SshWsQuery {
    pub id: String,
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
    Query(query): Query<ListByLibraryQuery>,
) -> Result<Json<ApiResponse<Vec<crate::db::models::ssh_terminal::SshTerminalOutput>>>, AppError> {
    let library_id: Uuid = query
        .library_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid library_id".into()))?;
    let terminals = SshTerminalRepo::list_by_library(&state.db, library_id).await?;
    Ok(ok(terminals))
}

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
    let terminal = SshTerminalRepo::get_raw(&state.db, id).await?;
    let creds = to_creds(&terminal);
    let startup_command = terminal.startup_command.clone();
    Ok(ws.on_upgrade(move |socket| handle_ssh_session(socket, creds, startup_command)))
}

async fn handle_ssh_session(
    socket: WebSocket,
    creds: SshCredentials,
    startup_command: Option<String>,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(256);
    let (input_tx, input_rx) = mpsc::channel::<rust_ssh_terminal::ShellInput>(256);

    // Bridge: SSH output → WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(data) = output_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Bridge: WebSocket → SSH input
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) => {
                    if input_tx
                        .send(rust_ssh_terminal::ShellInput::Data(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) = serde_json::from_str::<ResizePayload>(json_str) {
                            let _ = input_tx
                                .send(rust_ssh_terminal::ShellInput::Resize {
                                    cols: resize.cols,
                                    rows: resize.rows,
                                })
                                .await;
                        }
                    } else if input_tx
                        .send(rust_ssh_terminal::ShellInput::Data(text.as_bytes().to_vec()))
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

    // Run the SSH interactive session
    let session_task = tokio::spawn(async move {
        if let Err(e) = rust_ssh_terminal::session::run_interactive_shell(
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

    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
        _ = session_task => {}
    }

    tracing::debug!("SSH WebSocket session ended");
}

// ── System info handlers ─────────────────────────────────────────────────────

pub async fn ssh_terminal_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::system::SshHostStats>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let stats = rust_ssh_terminal::system::get_stats(&creds).await?;
    Ok(ok(stats))
}

pub async fn ssh_terminal_ls(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<LsQuery>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::files::SshLsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::files::list_dir(&creds, &query.path).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::system::SshPsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::system::list_processes(&creds).await?;
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
    rust_ssh_terminal::system::kill_process(&creds, body.pid, signal).await?;
    Ok(ok(()))
}

pub async fn ssh_terminal_df(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::system::SshDfResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::system::get_disk_usage(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_net(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::network::SshNetworkResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::network::get_network_info(&creds).await?;
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
    rust_ssh_terminal::files::mkdir(&creds, &input.path).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::files::rm(&creds, &input.path).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_rename(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshRenameInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::files::rename(&creds, &input.from, &input.to).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_read_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::files::SshFileContentResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::files::read_file(&creds, &input.path).await?;
    Ok(ok(response))
}

pub async fn ssh_terminal_write_file(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(input): Json<SshWriteFileInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::files::write_file(&creds, &input.path, &input.content).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_download(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<SshFileOpInput>,
) -> Result<impl IntoResponse, AppError> {
    let creds = get_creds(&state, &id).await?;
    let bytes = rust_ssh_terminal::files::download_file(&creds, &query.path).await?;
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

// ── Docker handlers ──────────────────────────────────────────────────────────

pub async fn ssh_docker_ps(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerPsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::ps(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_start(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::start(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_stop(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::stop(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_restart(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::restart(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_logs(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerLogsInput>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerLogsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let tail = body.tail.unwrap_or(200);
    let response = rust_ssh_terminal::docker::logs(&creds, &body.container_id, tail).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerImagesResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::images(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::rm(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_pause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::pause(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_unpause(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::unpause(&creds, &body.container_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_rmi(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerImageActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::rmi(&creds, &body.image_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerNetworksResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::networks(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_inspect(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Query(params): Query<DockerInspectQuery>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerInspectResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::inspect(&creds, &params.container_id).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerVolumesResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::volumes(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_volume_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerVolumeActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::volume_rm(&creds, &body.volume_name).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_stats(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerStatsResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::stats(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_network_rm(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<DockerNetworkActionInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    rust_ssh_terminal::docker::network_rm(&creds, &body.network_id).await?;
    Ok(ok_empty())
}

pub async fn ssh_docker_prune_images(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::prune_images(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_volumes(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::prune_volumes(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_networks(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::prune_networks(&creds).await?;
    Ok(ok(response))
}

pub async fn ssh_docker_prune_system(
    State(state): State<Arc<AppState>>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<rust_ssh_terminal::docker::SshDockerPruneResponse>>, AppError> {
    let creds = get_creds(&state, &id).await?;
    let response = rust_ssh_terminal::docker::prune_system(&creds).await?;
    Ok(ok(response))
}
