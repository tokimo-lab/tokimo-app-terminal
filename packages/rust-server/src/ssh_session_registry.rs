//! In-memory SSH session registry for persistent terminal sessions.
//!
//! Each session keeps a scrollback history buffer and a list of connected
//! WebSocket clients. When a client reconnects with the same `session_id`,
//! it receives the full history replay and then live output — making page
//! refreshes seamless without restarting the remote shell.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

/// Maximum bytes retained in the scrollback history buffer per session.
const HISTORY_MAX_BYTES: usize = 512 * 1024; // 512 KB

/// One live SSH shell session shared across (potentially multiple) WebSocket clients.
pub struct SshSessionEntry {
    /// Channel for sending input / resize events to the SSH shell task.
    pub input_tx: mpsc::Sender<rust_ssh_terminal::ShellInput>,
    /// Rolling scrollback buffer (oldest bytes trimmed when it exceeds `HISTORY_MAX_BYTES`).
    pub history: Vec<u8>,
    /// Output channels to currently-connected WebSocket bridges.
    pub clients: Vec<mpsc::Sender<Vec<u8>>>,
}

impl SshSessionEntry {
    /// Append `data` to the history buffer and fan it out to all live clients.
    /// Stale senders (whose receivers have been dropped) are removed automatically.
    pub fn broadcast(&mut self, data: Vec<u8>) {
        self.history.extend_from_slice(&data);
        if self.history.len() > HISTORY_MAX_BYTES {
            let excess = self.history.len() - HISTORY_MAX_BYTES;
            self.history.drain(..excess);
        }
        self.clients.retain(|tx| tx.try_send(data.clone()).is_ok());
    }
}

pub type SshSessionRegistry = Arc<Mutex<HashMap<String, SshSessionEntry>>>;

pub fn new_registry() -> SshSessionRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}
