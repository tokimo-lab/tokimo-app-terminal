use std::io::{Read, Write};
use std::sync::Arc;

use crate::common::thread_util::named_spawn_blocking;
use axum::{
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use tokimo_package_sandbox::{Event, Sandbox, ShellOpts};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::AppState;
use crate::apps::ai::sandbox::{SandboxRuntime, is_ch_backend};
use crate::common::pty_session_registry::{PtyInput, PtySessionEntry};
use crate::error::AppError;
use crate::handlers::user::AuthUser;

#[derive(Deserialize)]
struct ResizePayload {
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
pub struct TerminalWsQuery {
    pub session_id: Option<String>,
}

/// WebSocket upgrade handler — authenticates as admin, then hands off to PTY session.
pub async fn terminal_ws(
    State(state): State<Arc<AppState>>,
    AuthUser(_auth): AuthUser,
    Query(query): Query<TerminalWsQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let sandbox_backend = match state.sandbox_runtime.ensure_booted().await {
        Ok(sandbox) if is_ch_backend(sandbox.active_backend()) => Some((sandbox, Arc::clone(&state.sandbox_runtime))),
        Ok(_) => None,
        Err(err) => {
            tracing::error!(error = %err, "terminal_ws: microVM sandbox unavailable; falling back to host PTY");
            None
        }
    };

    let registry = state.pty_sessions.clone();
    let session_id = query.session_id;
    Ok(ws.on_upgrade(move |socket| handle_terminal_session(socket, session_id, registry, sandbox_backend)))
}

async fn start_microvm_pty_session(
    session_id: String,
    registry: crate::common::pty_session_registry::PtySessionRegistry,
    sandbox: Arc<Sandbox>,
    sandbox_runtime: Arc<SandboxRuntime>,
    mut input_rx: mpsc::Receiver<PtyInput>,
    mut output_rx: mpsc::Receiver<Vec<u8>>,
    output_tx: mpsc::Sender<Vec<u8>>,
) -> bool {
    let argv = vec!["/bin/sh".to_string(), "-l".to_string()];
    let sandbox_for_spawn = sandbox.clone();
    let spawn_result = tokio::task::spawn_blocking(move || {
        sandbox_for_spawn.spawn_shell(ShellOpts {
            pty: Some((24, 80)),
            argv: Some(argv),
            env: vec![
                ("TERM".into(), "xterm-256color".into()),
                ("COLORTERM".into(), "truecolor".into()),
            ],
            cwd: Some("/mnt".into()),
        })
    })
    .await;

    let job_id = match spawn_result {
        Ok(Ok(id)) => id,
        Ok(Err(e)) => {
            tracing::error!(error = %e, "terminal_ws: failed to spawn microVM PTY");
            registry.lock().await.remove(&session_id);
            return false;
        }
        Err(e) => {
            tracing::error!(error = %e, "terminal_ws: microVM PTY spawn task failed");
            registry.lock().await.remove(&session_id);
            return false;
        }
    };

    let mut event_rx = sandbox_runtime.subscribe_job(job_id.clone());
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let should_break = match event {
                Event::Stdout { data, .. } | Event::Stderr { data, .. } => output_tx.send(data).await.is_err(),
                Event::Exit { .. } => true,
                _ => false,
            };
            if should_break {
                break;
            }
        }
    });

    let sandbox_for_writer = sandbox.clone();
    let writer_job_id = job_id.clone();
    tokio::spawn(async move {
        while let Some(input) = input_rx.recv().await {
            let sandbox = sandbox_for_writer.clone();
            let job_id = writer_job_id.clone();
            let res = tokio::task::spawn_blocking(move || match input {
                PtyInput::Data(data) => {
                    if data.is_empty() {
                        Ok(())
                    } else {
                        sandbox.write_stdin(&job_id, &data)
                    }
                }
                PtyInput::Resize(cols, rows) => sandbox.resize_shell(&job_id, rows, cols),
            })
            .await;
            match res {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    tracing::debug!(error = %e, "terminal_ws: microVM writer op failed");
                    break;
                }
                Err(e) => {
                    tracing::debug!(error = %e, "terminal_ws: microVM writer task failed");
                    break;
                }
            }
        }
    });

    let registry_d = registry.clone();
    let session_id_d = session_id.clone();
    let sandbox_for_cleanup = sandbox.clone();
    let runtime_for_cleanup = sandbox_runtime.clone();
    tokio::spawn(async move {
        while let Some(data) = output_rx.recv().await {
            let mut reg = registry_d.lock().await;
            if let Some(entry) = reg.get_mut(&session_id_d) {
                entry.broadcast(data);
            }
        }
        registry_d.lock().await.remove(&session_id_d);
        let close_id = job_id.clone();
        let _ = tokio::task::spawn_blocking(move || sandbox_for_cleanup.close_shell(&close_id)).await;
        runtime_for_cleanup.unsubscribe_job(&job_id);
        tracing::debug!("microVM PTY session {session_id_d} ended; removed from registry");
    });

    true
}

async fn handle_terminal_session(
    socket: WebSocket,
    session_id: Option<String>,
    registry: crate::common::pty_session_registry::PtySessionRegistry,
    sandbox_backend: Option<(Arc<Sandbox>, Arc<SandboxRuntime>)>,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Per-client output channel (large enough for history replay).
    let (client_tx, mut client_rx) = mpsc::channel::<Vec<u8>>(1024);

    let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    // ── Attach to existing session or create a new one ──────────────────
    let input_tx = {
        let mut reg = registry.lock().await;

        if let Some(entry) = reg.get_mut(&session_id) {
            // Replay scrollback so the reconnecting client sees previous output.
            if !entry.history.is_empty() {
                let _ = client_tx.try_send(entry.history.clone());
            }
            entry.clients.push(client_tx);
            entry.input_tx.clone()
        } else {
            // New session: spawn a local PTY shell.
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
            drop(reg); // release lock before spawning

            if let Some((sandbox, sandbox_runtime)) = sandbox_backend.clone() {
                if !start_microvm_pty_session(
                    session_id.clone(),
                    registry.clone(),
                    sandbox,
                    sandbox_runtime,
                    input_rx,
                    output_rx,
                    output_tx.clone(),
                )
                .await
                {
                    return;
                }

                input_tx
            } else {
                // Spawn PTY
                let pty_system = NativePtySystem::default();
                let pair = match pty_system.openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                }) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("failed to open PTY: {e}");
                        registry.lock().await.remove(&session_id);
                        return;
                    }
                };

                let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
                let mut cmd = CommandBuilder::new(&shell);
                cmd.env("TERM", "xterm-256color");
                cmd.env("COLORTERM", "truecolor");

                let mut child = match pair.slave.spawn_command(cmd) {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!("failed to spawn shell: {e}");
                        registry.lock().await.remove(&session_id);
                        return;
                    }
                };
                drop(pair.slave);

                let reader = match pair.master.try_clone_reader() {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::error!("failed to clone PTY reader: {e}");
                        registry.lock().await.remove(&session_id);
                        return;
                    }
                };

                let writer = match pair.master.take_writer() {
                    Ok(w) => w,
                    Err(e) => {
                        tracing::error!("failed to take PTY writer: {e}");
                        registry.lock().await.remove(&session_id);
                        return;
                    }
                };

                let master = pair.master;

                // Task: read PTY output → output channel
                let output_tx_c = output_tx.clone();
                named_spawn_blocking("pty-reader", move || {
                    let mut reader = reader;
                    let mut buf = [0u8; 4096];
                    loop {
                        match reader.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if output_tx_c.blocking_send(buf[..n].to_vec()).is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });

                // Task: write to PTY stdin + handle resize
                named_spawn_blocking("pty-writer", move || {
                    let mut writer = writer;
                    while let Some(input) = input_rx.blocking_recv() {
                        match input {
                            PtyInput::Data(data) => {
                                if !data.is_empty() {
                                    if writer.write_all(&data).is_err() {
                                        break;
                                    }
                                    let _ = writer.flush();
                                }
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

                // Task: distribute PTY output → history buffer + all clients
                let registry_d = registry.clone();
                let session_id_d = session_id.clone();
                tokio::spawn(async move {
                    while let Some(data) = output_rx.recv().await {
                        let mut reg = registry_d.lock().await;
                        if let Some(entry) = reg.get_mut(&session_id_d) {
                            entry.broadcast(data);
                        }
                    }
                    // Shell exited — clean up and remove from registry.
                    registry_d.lock().await.remove(&session_id_d);
                    let _ = child.kill();
                    tracing::debug!("PTY session {session_id_d} ended; removed from registry");
                });

                input_tx
            }
        }
    };

    // Send session_id back to the client so it can reconnect.
    let _ = ws_sink.send(Message::Text(format!("\x02{session_id}").into())).await;

    // ── Bridge: client output channel → WebSocket ───────────────────────
    let send_task = tokio::spawn(async move {
        while let Some(data) = client_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // ── Bridge: WebSocket → PTY input ───────────────────────────────────
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) if input_tx.send(PtyInput::Data(data.to_vec())).await.is_err() => {
                    break;
                }
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

    // When either direction ends, the WS bridge is done (PTY keeps running).
    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }

    tracing::debug!("WebSocket client detached from PTY session {session_id}");
}
