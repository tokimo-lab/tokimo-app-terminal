use serde::Serialize;
use tokimo_package_ssh::SshCredentials;
use ts_rs::TS;

use crate::db::entities::ssh_terminal;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshTerminalOutput {
    pub id: String,
    pub file_system_id: Option<String>,
    pub name: String,
    pub host: String,
    #[ts(type = "number")]
    pub port: i32,
    pub username: String,
    pub auth_method: String,
    pub has_password: bool,
    pub has_private_key: bool,
    pub startup_command: Option<String>,
    pub notes: Option<String>,
    #[ts(type = "number")]
    pub sort_order: i32,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ssh_terminal::Model> for SshTerminalOutput {
    fn from(m: ssh_terminal::Model) -> Self {
        Self {
            id: m.id.to_string(),
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalSshCredentialsOutput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub startup_command: Option<String>,
}

impl From<ssh_terminal::Model> for InternalSshCredentialsOutput {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn from(m: ssh_terminal::Model) -> Self {
        Self {
            host: m.host,
            port: m.port as u16,
            username: m.username,
            auth_method: m.auth_method,
            password: m.password,
            private_key: m.private_key,
            passphrase: m.passphrase,
            startup_command: m.startup_command,
        }
    }
}

impl From<&ssh_terminal::Model> for SshCredentials {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn from(m: &ssh_terminal::Model) -> Self {
        Self {
            host: m.host.clone(),
            port: m.port as u16,
            username: m.username.clone(),
            auth_method: m.auth_method.clone(),
            password: m.password.clone(),
            private_key: m.private_key.clone(),
            passphrase: m.passphrase.clone(),
        }
    }
}
