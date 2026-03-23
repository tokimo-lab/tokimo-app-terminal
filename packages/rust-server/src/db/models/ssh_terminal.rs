use serde::Serialize;
use ts_rs::TS;

use crate::db::entities::ssh_terminals;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshTerminalOutput {
    pub id: String,
    pub library_id: String,
    /// Linked SFTP file system ID (for FileManager)
    pub file_system_id: Option<String>,
    pub name: String,
    pub host: String,
    #[ts(type = "number")]
    pub port: i32,
    pub username: String,
    pub auth_method: String,
    /// Password is masked — never sent to frontend
    pub has_password: bool,
    /// Whether a private key is set
    pub has_private_key: bool,
    pub startup_command: Option<String>,
    pub notes: Option<String>,
    #[ts(type = "number")]
    pub sort_order: i32,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ssh_terminals::Model> for SshTerminalOutput {
    fn from(m: ssh_terminals::Model) -> Self {
        Self {
            id: m.id.to_string(),
            library_id: m.library_id.to_string(),
            file_system_id: m.file_system_id.map(|id| id.to_string()),
            name: m.name,
            host: m.host,
            port: m.port,
            username: m.username,
            auth_method: m.auth_method,
            has_password: m.password.is_some(),
            has_private_key: m.private_key.is_some(),
            startup_command: m.startup_command,
            notes: m.notes,
            sort_order: m.sort_order,
            is_enabled: m.is_enabled,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}
