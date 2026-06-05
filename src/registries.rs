use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use tokio::sync::{Mutex, mpsc};

const MAX_HISTORY_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub enum PtyInput {
    Data(Vec<u8>),
    Resize(u16, u16),
}

pub struct PtySessionEntry {
    pub input_tx: mpsc::Sender<PtyInput>,
    pub history: Vec<u8>,
    pub clients: Vec<mpsc::Sender<Vec<u8>>>,
}

impl PtySessionEntry {
    #[allow(clippy::needless_pass_by_value)]
    pub fn broadcast(&mut self, data: Vec<u8>) {
        self.history.extend_from_slice(&data);
        if self.history.len() > MAX_HISTORY_BYTES {
            let drop_len = self.history.len() - MAX_HISTORY_BYTES;
            self.history.drain(..drop_len);
        }
        self.clients.retain(|tx| tx.try_send(data.clone()).is_ok());
    }
}

pub type PtySessionRegistry = Arc<Mutex<HashMap<String, PtySessionEntry>>>;

pub struct SshSessionEntry {
    pub input_tx: mpsc::Sender<tokimo_package_ssh::ShellInput>,
    pub history: Vec<u8>,
    pub clients: Vec<mpsc::Sender<Bytes>>,
}

impl SshSessionEntry {
    #[allow(clippy::needless_pass_by_value)]
    pub fn broadcast(&mut self, data: Bytes) {
        self.history.extend_from_slice(&data);
        if self.history.len() > MAX_HISTORY_BYTES {
            let drop_len = self.history.len() - MAX_HISTORY_BYTES;
            self.history.drain(..drop_len);
        }
        self.clients.retain(|tx| tx.try_send(data.clone()).is_ok());
    }
}

pub type SshSessionRegistry = Arc<Mutex<HashMap<String, SshSessionEntry>>>;
