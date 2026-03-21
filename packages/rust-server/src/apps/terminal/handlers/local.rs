use std::io::{Read, Write};
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::HeaderMap,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::db::repos::user::user_repo::UserRepo;
use crate::error::AppError;
use crate::handlers::user::extract_session_auth;
use crate::AppState;

#[derive(Deserialize)]
struct ResizePayload {
    cols: u16,
    rows: u16,
}

/// WebSocket upgrade handler — authenticates as admin, then hands off to PTY session.
pub async fn terminal_ws(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let auth = extract_session_auth(&state.db, &headers).await?;
    let user = UserRepo::get_by_id(&state.db, &auth.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("用户不存在".into()))?;
    if user.role != "superadmin" && user.role != "admin" {
        return Err(AppError::Forbidden("需要管理员权限".into()));
    }

    Ok(ws.on_upgrade(move |socket| handle_terminal_session(socket)))
}

async fn handle_terminal_session(socket: WebSocket) {
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
            return;
        }
    };

    let mut cmd = CommandBuilder::new("bash");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("failed to spawn shell: {e}");
            return;
        }
    };
    // Slave fd is no longer needed after spawn.
    drop(pair.slave);

    let reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("failed to clone PTY reader: {e}");
            return;
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("failed to take PTY writer: {e}");
            return;
        }
    };

    // Keep master handle alive for resize operations.
    let master = pair.master;

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Channel: PTY stdout → WebSocket sender
    let (pty_out_tx, mut pty_out_rx) = mpsc::channel::<Vec<u8>>(256);

    // Channel: WebSocket input → PTY writer (blocking)
    let (pty_in_tx, pty_in_rx) = std::sync::mpsc::channel::<Vec<u8>>();

    // Channel: resize commands → blocking task holding the master
    let (resize_tx, resize_rx) = std::sync::mpsc::channel::<(u16, u16)>();

    // ── Task 1: read PTY output → mpsc channel ──────────────────────────
    let read_handle = tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if pty_out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // ── Task 2: write to PTY stdin + handle resize ──────────────────────
    let write_handle = tokio::task::spawn_blocking(move || {
        let mut writer = writer;
        loop {
            match pty_in_rx.recv() {
                Ok(data) => {
                    if writer.write_all(&data).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Err(_) => break,
            }

            // Drain any pending resize commands.
            while let Ok((cols, rows)) = resize_rx.try_recv() {
                let _ = master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
    });

    // ── Task 3: forward PTY output channel → WebSocket ──────────────────
    let send_handle = tokio::spawn(async move {
        while let Some(data) = pty_out_rx.recv().await {
            if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // ── Task 4: receive WebSocket messages → PTY input / resize ─────────
    let recv_handle = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) => {
                    if pty_in_tx.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                Message::Text(text) => {
                    let text_str: &str = &text;
                    // Control message: \x01 prefix + JSON payload
                    if let Some(json_str) = text_str.strip_prefix('\x01') {
                        if let Ok(resize) =
                            serde_json::from_str::<ResizePayload>(json_str)
                        {
                            let _ = resize_tx.send((resize.cols, resize.rows));
                            // Send a dummy byte to wake the write task so it processes the resize.
                            let _ = pty_in_tx.send(Vec::new());
                        }
                    } else {
                        // Regular text input
                        if pty_in_tx.send(text.as_bytes().to_vec()).is_err() {
                            break;
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for any task to finish — then tear down everything.
    tokio::select! {
        _ = read_handle => {}
        _ = write_handle => {}
        _ = send_handle => {}
        _ = recv_handle => {}
    }

    let _ = child.kill();
    tracing::info!("terminal session ended");
}
