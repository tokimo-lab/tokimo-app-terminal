use std::io::{Read, Write};
use std::sync::Arc;

use axum::{
    Json,
    body::Body,
    extract::{
        Multipart, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, header},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use tokimo_bus_auth::TokimoUser;
use tokimo_package_ssh::SshCredentials;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::{
    AppError,
    ctx::AppCtx,
    db::{
        models::ssh_terminal::{InternalSshCredentialsOutput, SshTerminalOutput},
        repos::ssh_terminal_repo::{CreateSshTerminalData, SshTerminalRepo, UpdateSshTerminalData},
    },
    error::OptionExt,
    registries::{PtyInput, PtySessionEntry, PtySessionRegistry, SshSessionEntry, SshSessionRegistry},
};

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: T,
}

pub fn ok<T>(data: T) -> Json<ApiResponse<T>> {
    Json(ApiResponse { success: true, data })
}
pub fn ok_empty() -> Json<ApiResponse<()>> {
    ok(())
}

#[derive(Deserialize)]
pub struct TerminalWsQuery {
    pub session_id: Option<String>,
}

#[derive(Deserialize)]
struct ResizePayload {
    cols: u16,
    rows: u16,
}

#[allow(clippy::unused_async)]
pub async fn terminal_ws(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Query(query): Query<TerminalWsQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let registry = Arc::clone(&ctx.pty_sessions);
    Ok(ws.on_upgrade(move |socket| handle_local_pty_ws(socket, query.session_id, registry)))
}

async fn handle_local_pty_ws(socket: WebSocket, session_id: Option<String>, registry: PtySessionRegistry) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (client_tx, mut client_rx) = mpsc::channel::<Vec<u8>>(1024);
    let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let input_tx = {
        let mut reg = registry.lock().await;
        if let Some(entry) = reg.get_mut(&session_id) {
            if !entry.history.is_empty() {
                let _ = client_tx.try_send(entry.history.clone());
            }
            entry.clients.push(client_tx);
            entry.input_tx.clone()
        } else {
            let (input_tx, mut input_rx) = mpsc::channel::<PtyInput>(256);
            let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(256);
            reg.insert(
                session_id.clone(),
                PtySessionEntry {
                    input_tx: input_tx.clone(),
                    history: Vec::new(),
                    clients: vec![client_tx],
                },
            );
            drop(reg);

            let pty_system = NativePtySystem::default();
            let pair = match pty_system.openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            }) {
                Ok(pair) => pair,
                Err(error) => {
                    tracing::error!(%error, "terminal: open PTY failed");
                    registry.lock().await.remove(&session_id);
                    return;
                }
            };
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
            let mut cmd = CommandBuilder::new(&shell);
            cmd.env("TERM", "xterm-256color");
            cmd.env("COLORTERM", "truecolor");
            let mut child = match pair.slave.spawn_command(cmd) {
                Ok(child) => child,
                Err(error) => {
                    tracing::error!(%error, "terminal: spawn shell failed");
                    registry.lock().await.remove(&session_id);
                    return;
                }
            };
            drop(pair.slave);
            let reader = match pair.master.try_clone_reader() {
                Ok(reader) => reader,
                Err(error) => {
                    tracing::error!(%error, "terminal: clone PTY reader failed");
                    registry.lock().await.remove(&session_id);
                    return;
                }
            };
            let writer = match pair.master.take_writer() {
                Ok(writer) => writer,
                Err(error) => {
                    tracing::error!(%error, "terminal: take PTY writer failed");
                    registry.lock().await.remove(&session_id);
                    return;
                }
            };
            let master = pair.master;

            let output_tx_reader = output_tx.clone();
            spawn_named_blocking("terminal-pty-reader", move || {
                let mut reader = reader;
                let mut buf = [0_u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if output_tx_reader.blocking_send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                    }
                }
            });

            spawn_named_blocking("terminal-pty-writer", move || {
                let mut writer = writer;
                while let Some(input) = input_rx.blocking_recv() {
                    match input {
                        PtyInput::Data(data) => {
                            if !data.is_empty() && writer.write_all(&data).is_err() {
                                break;
                            }
                            let _ = writer.flush();
                        }
                        PtyInput::Resize(cols, rows) => {
                            let _ = master.resize(PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            });
                        }
                    }
                }
            });

            let registry_out = Arc::clone(&registry);
            let session_id_out = session_id.clone();
            tokio::spawn(async move {
                while let Some(data) = output_rx.recv().await {
                    let mut reg = registry_out.lock().await;
                    if let Some(entry) = reg.get_mut(&session_id_out) {
                        entry.broadcast(data);
                    }
                }
                registry_out.lock().await.remove(&session_id_out);
                let _ = child.kill();
            });
            input_tx
        }
    };

    let _ = ws_sink.send(Message::Text(format!("\x02{session_id}").into())).await;

    let send_task = tokio::spawn(async move {
        while let Some(data) = client_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) if input_tx.send(PtyInput::Data(data.to_vec())).await.is_err() => break,
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) = serde_json::from_str::<ResizePayload>(json_str) {
                            let _ = input_tx.send(PtyInput::Resize(resize.cols, resize.rows)).await;
                        }
                    } else if input_tx.send(PtyInput::Data(text.as_bytes().to_vec())).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! { _ = send_task => {}, _ = recv_task => {} }
}

fn spawn_named_blocking(name: &'static str, f: impl FnOnce() + Send + 'static) {
    if let Err(error) = std::thread::Builder::new().name(name.to_string()).spawn(f) {
        tracing::error!(%error, thread = name, "terminal: failed to spawn blocking thread");
    }
}

fn parse_uuid(id: &str) -> Result<Uuid, AppError> {
    id.parse().map_err(|_| AppError::bad_request("invalid id"))
}

fn to_creds(m: &crate::db::entities::ssh_terminal::Model) -> SshCredentials {
    SshCredentials::from(m)
}

async fn get_creds(ctx: &AppCtx, id: &str) -> Result<SshCredentials, AppError> {
    let terminal = SshTerminalRepo::get_raw(&ctx.db, parse_uuid(id)?).await?;
    Ok(to_creds(&terminal))
}

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
    pub session_id: Option<String>,
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
    "/".to_string()
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

pub async fn list_ssh_terminal(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
) -> Result<Json<ApiResponse<Vec<SshTerminalOutput>>>, AppError> {
    Ok(ok(SshTerminalRepo::list_all(&ctx.db).await?))
}

pub async fn get_ssh_terminal(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SshTerminalOutput>>, AppError> {
    Ok(ok(SshTerminalRepo::get_by_id(&ctx.db, parse_uuid(&id)?).await?))
}

pub async fn create_ssh_terminal(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Json(input): Json<CreateSshTerminalInput>,
) -> Result<Json<ApiResponse<SshTerminalOutput>>, AppError> {
    let terminal = SshTerminalRepo::create(
        &ctx.db,
        CreateSshTerminalData {
            name: input.name,
            host: input.host,
            port: input.port.unwrap_or(22),
            username: input.username,
            auth_method: input.auth_method.unwrap_or_else(|| "password".to_string()),
            password: input.password,
            private_key: input.private_key,
            passphrase: input.passphrase,
            startup_command: input.startup_command,
            notes: input.notes,
            sort_order: input.sort_order.unwrap_or(0),
        },
    )
    .await?;
    Ok(ok(terminal))
}

pub async fn update_ssh_terminal(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateSshTerminalInput>,
) -> Result<Json<ApiResponse<SshTerminalOutput>>, AppError> {
    let terminal = SshTerminalRepo::update(
        &ctx.db,
        parse_uuid(&id)?,
        UpdateSshTerminalData {
            name: input.name,
            host: input.host,
            port: input.port,
            username: input.username,
            auth_method: input.auth_method,
            password: input.password.map(Some),
            private_key: input.private_key.map(Some),
            passphrase: input.passphrase.map(Some),
            startup_command: input.startup_command.map(Some),
            notes: input.notes.map(Some),
            sort_order: input.sort_order,
            is_enabled: input.is_enabled,
        },
    )
    .await?;
    Ok(ok(terminal))
}

pub async fn delete_ssh_terminal(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    SshTerminalRepo::delete(&ctx.db, parse_uuid(&id)?).await?;
    Ok(ok_empty())
}

pub async fn internal_ssh_creds(
    State(ctx): State<Arc<AppCtx>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<InternalSshCredentialsOutput>>, AppError> {
    // tokimo-bus-auth currently only exposes user-header auth. This internal endpoint
    // therefore uses a broker-stamped shared header when configured by the caller.
    let expected = std::env::var("TOKIMO_INTERNAL_TOKEN").ok();
    let authorized = match expected.as_deref() {
        Some(token) => headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v == format!("Bearer {token}")),
        None => headers
            .get("x-tokimo-internal")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v == "broker"),
    };
    if !authorized {
        return Err(AppError::unauthorized("broker auth required"));
    }
    let model = SshTerminalRepo::get_raw(&ctx.db, parse_uuid(&id)?).await?;
    Ok(ok(InternalSshCredentialsOutput::from(model)))
}

pub async fn ssh_terminal_ws(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Query(query): Query<SshWsQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let terminal = SshTerminalRepo::get_raw(&ctx.db, parse_uuid(&query.id)?).await?;
    let creds = to_creds(&terminal);
    let startup_command = terminal.startup_command.clone();
    let registry = Arc::clone(&ctx.ssh_sessions);
    Ok(ws.on_upgrade(move |socket| handle_ssh_ws(socket, query.session_id, creds, startup_command, registry)))
}

async fn handle_ssh_ws(
    socket: WebSocket,
    session_id: Option<String>,
    creds: SshCredentials,
    startup_command: Option<String>,
    registry: SshSessionRegistry,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (client_tx, mut client_rx) = mpsc::channel::<bytes::Bytes>(1024);
    let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let input_tx = {
        let mut reg = registry.lock().await;
        if let Some(entry) = reg.get_mut(&session_id) {
            if !entry.history.is_empty() {
                let _ = client_tx.try_send(bytes::Bytes::from(entry.history.clone()));
            }
            let _ = client_tx.try_send(bytes::Bytes::from_static(tokimo_package_ssh::session::SSH_READY_MARKER));
            entry.clients.push(client_tx);
            entry.input_tx.clone()
        } else {
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
            drop(reg);

            let registry_out = Arc::clone(&registry);
            let session_id_out = session_id.clone();
            tokio::spawn(async move {
                while let Some(data) = output_rx.recv().await {
                    let mut reg = registry_out.lock().await;
                    if let Some(entry) = reg.get_mut(&session_id_out) {
                        entry.broadcast(data);
                    }
                }
                registry_out.lock().await.remove(&session_id_out);
            });

            tokio::spawn(async move {
                if let Err(error) = tokimo_package_ssh::session::run_interactive_shell(
                    &creds,
                    startup_command.as_deref(),
                    output_tx,
                    input_rx,
                )
                .await
                {
                    tracing::error!(%error, "terminal: SSH session error");
                }
            });
            input_tx
        }
    };

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data)
                    if input_tx
                        .send(tokimo_package_ssh::ShellInput::Data(data.to_vec()))
                        .await
                        .is_err() =>
                {
                    break;
                }
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) = serde_json::from_str::<ResizePayload>(json_str) {
                            let _ = input_tx
                                .send(tokimo_package_ssh::ShellInput::Resize {
                                    cols: resize.cols.into(),
                                    rows: resize.rows.into(),
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

    let send_task = tokio::spawn(async move {
        while let Some(data) = client_rx.recv().await {
            if ws_sink.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.send(Message::Close(None)).await;
        let _ = ws_sink.close().await;
    });

    tokio::select! { _ = recv_task => {}, _ = send_task => {} }
}

pub async fn ssh_terminal_stats(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshHostStats>>, AppError> {
    Ok(ok(
        tokimo_package_ssh::system::get_stats(&get_creds(&ctx, &id).await?).await?
    ))
}
pub async fn ssh_terminal_ls(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Query(query): Query<LsQuery>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::files::SshLsResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::files::list_dir(
        &get_creds(&ctx, &id).await?,
        &query.path,
    )
    .await?))
}
pub async fn ssh_terminal_ps(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshPsResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::system::list_processes(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_terminal_kill(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(body): Json<KillProcessInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::system::kill_process(
        &get_creds(&ctx, &id).await?,
        body.pid,
        body.signal.as_deref().unwrap_or("TERM"),
    )
    .await?;
    Ok(ok_empty())
}
pub async fn ssh_terminal_df(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::system::SshDfResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::system::get_disk_usage(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_terminal_net(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::network::SshNetworkResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::network::get_network_info(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_terminal_mkdir(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::files::mkdir(&get_creds(&ctx, &id).await?, &input.path).await?;
    Ok(ok_empty())
}
pub async fn ssh_terminal_rm(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::files::rm(&get_creds(&ctx, &id).await?, &input.path).await?;
    Ok(ok_empty())
}
pub async fn ssh_terminal_rename(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshRenameInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::files::rename(&get_creds(&ctx, &id).await?, &input.from, &input.to).await?;
    Ok(ok_empty())
}
pub async fn ssh_terminal_mv(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshMvInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::files::mv_to_dir(&get_creds(&ctx, &id).await?, &input.from, &input.to_dir).await?;
    Ok(ok_empty())
}
pub async fn ssh_terminal_read_file(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshFileOpInput>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::files::SshFileContentResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::files::read_file(
        &get_creds(&ctx, &id).await?,
        &input.path,
    )
    .await?))
}
pub async fn ssh_terminal_write_file(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(input): Json<SshWriteFileInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    tokimo_package_ssh::files::write_file(&get_creds(&ctx, &id).await?, &input.path, &input.content).await?;
    Ok(ok_empty())
}

pub async fn ssh_terminal_download(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Query(query): Query<SshFileOpInput>,
) -> Result<impl IntoResponse, AppError> {
    let rx = tokimo_package_ssh::files::download_stream(&get_creds(&ctx, &id).await?, &query.path).await?;
    let byte_stream = ReceiverStream::new(rx).map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));
    let filename = query.path.rsplit('/').next().unwrap_or("download").replace('"', "\\\"");
    let content_type = mime_for(&query.path);
    let disposition = if content_type == "application/octet-stream" {
        format!("attachment; filename=\"{filename}\"")
    } else {
        format!("inline; filename=\"{filename}\"")
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Body::from_stream(byte_stream),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SshUploadQuery {
    pub path: String,
    pub filename: String,
}

pub async fn ssh_terminal_upload(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Query(query): Query<SshUploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<()>>, AppError> {
    if query.path.contains('\0')
        || query.filename.contains('\0')
        || query.filename.contains('/')
        || query.filename.contains("..")
    {
        return Err(AppError::bad_request("invalid upload path"));
    }
    let remote_path = if query.path.ends_with('/') {
        format!("{}{}", query.path, query.filename)
    } else {
        format!("{}/{}", query.path, query.filename)
    };
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(format!("multipart error: {e}")))?
        .bad_request("no file in request")?;
    let bytes = field
        .bytes()
        .await
        .map_err(|e| AppError::bad_request(format!("read multipart field: {e}")))?;
    tokimo_package_ssh::files::upload_file(&get_creds(&ctx, &id).await?, &remote_path, &bytes).await?;
    Ok(ok_empty())
}

fn mime_for(path: &str) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

macro_rules! docker_action {
    ($name:ident, $func:path, $input:ty, $field:ident) => {
        pub async fn $name(
            State(ctx): State<Arc<AppCtx>>,
            TokimoUser { user_id: _ }: TokimoUser,
            Path(id): Path<String>,
            Json(body): Json<$input>,
        ) -> Result<Json<ApiResponse<()>>, AppError> {
            $func(&get_creds(&ctx, &id).await?, &body.$field).await?;
            Ok(ok_empty())
        }
    };
}

pub async fn ssh_docker_ps(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPsResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::ps(&get_creds(&ctx, &id).await?).await?))
}
docker_action!(
    ssh_docker_start,
    tokimo_package_ssh::docker::start,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_stop,
    tokimo_package_ssh::docker::stop,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_restart,
    tokimo_package_ssh::docker::restart,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_rm,
    tokimo_package_ssh::docker::rm,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_pause,
    tokimo_package_ssh::docker::pause,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_unpause,
    tokimo_package_ssh::docker::unpause,
    DockerActionInput,
    container_id
);
docker_action!(
    ssh_docker_rmi,
    tokimo_package_ssh::docker::rmi,
    DockerImageActionInput,
    image_id
);
docker_action!(
    ssh_docker_network_rm,
    tokimo_package_ssh::docker::network_rm,
    DockerNetworkActionInput,
    network_id
);
docker_action!(
    ssh_docker_volume_rm,
    tokimo_package_ssh::docker::volume_rm,
    DockerVolumeActionInput,
    volume_name
);

pub async fn ssh_docker_logs(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Json(body): Json<DockerLogsInput>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerLogsResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::logs(
        &get_creds(&ctx, &id).await?,
        &body.container_id,
        body.tail.unwrap_or(200),
    )
    .await?))
}
pub async fn ssh_docker_images(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerImagesResponse>>, AppError> {
    Ok(ok(
        tokimo_package_ssh::docker::images(&get_creds(&ctx, &id).await?).await?
    ))
}
pub async fn ssh_docker_networks(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerNetworksResponse>>, AppError> {
    Ok(ok(
        tokimo_package_ssh::docker::networks(&get_creds(&ctx, &id).await?).await?
    ))
}
pub async fn ssh_docker_inspect(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
    Query(params): Query<DockerInspectQuery>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerInspectResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::inspect(
        &get_creds(&ctx, &id).await?,
        &params.container_id,
    )
    .await?))
}
pub async fn ssh_docker_volumes(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerVolumesResponse>>, AppError> {
    Ok(ok(
        tokimo_package_ssh::docker::volumes(&get_creds(&ctx, &id).await?).await?
    ))
}
pub async fn ssh_docker_stats(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerStatsResponse>>, AppError> {
    Ok(ok(
        tokimo_package_ssh::docker::stats(&get_creds(&ctx, &id).await?).await?
    ))
}
pub async fn ssh_docker_prune_images(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::prune_images(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_docker_prune_volumes(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::prune_volumes(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_docker_prune_networks(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::prune_networks(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
pub async fn ssh_docker_prune_system(
    State(ctx): State<Arc<AppCtx>>,
    TokimoUser { user_id: _ }: TokimoUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<tokimo_package_ssh::docker::SshDockerPruneResponse>>, AppError> {
    Ok(ok(tokimo_package_ssh::docker::prune_system(
        &get_creds(&ctx, &id).await?,
    )
    .await?))
}
