use sea_orm::DatabaseConnection;
use std::sync::{Arc, OnceLock};
use tokimo_bus_client::BusClient;

use crate::registries::{PtySessionRegistry, SshSessionRegistry};

pub struct AppCtx {
    pub db: DatabaseConnection,
    #[allow(dead_code)]
    pub client: Arc<OnceLock<Arc<BusClient>>>,
    pub pty_sessions: PtySessionRegistry,
    pub ssh_sessions: SshSessionRegistry,
}
