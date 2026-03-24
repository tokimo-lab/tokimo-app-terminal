use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};
use uuid::Uuid;

use crate::db::entities::ssh_terminals;
use crate::db::models::ssh_terminal::SshTerminalOutput;
use crate::error::AppError;

pub struct SshTerminalRepo;

impl SshTerminalRepo {
    /// List all SSH terminals in an app, ordered by sort_order.
    pub async fn list_by_app(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<SshTerminalOutput>, AppError> {
        let models = ssh_terminals::Entity::find()
            .filter(ssh_terminals::Column::AppId.eq(app_id))
            .order_by_asc(ssh_terminals::Column::SortOrder)
            .order_by_asc(ssh_terminals::Column::CreatedAt)
            .all(db)
            .await?;
        Ok(models.into_iter().map(SshTerminalOutput::from).collect())
    }

    /// Get a single SSH terminal by ID.
    pub async fn get_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<SshTerminalOutput, AppError> {
        let model = ssh_terminals::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("SSH terminal not found".into()))?;
        Ok(SshTerminalOutput::from(model))
    }

    /// Get the raw model (with credentials) for internal use (e.g. SSH connection).
    pub async fn get_raw(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<ssh_terminals::Model, AppError> {
        ssh_terminals::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("SSH terminal not found".into()))
    }

    /// Create a new SSH terminal.
    pub async fn create(
        db: &DatabaseConnection,
        app_id: Uuid,
        name: &str,
        host: &str,
        port: i32,
        username: &str,
        auth_method: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        passphrase: Option<&str>,
        startup_command: Option<&str>,
        notes: Option<&str>,
        sort_order: i32,
    ) -> Result<SshTerminalOutput, AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let model = ssh_terminals::ActiveModel {
            id: Set(Uuid::new_v4()),
            app_id: Set(app_id),
            file_system_id: Set(None),
            name: Set(name.to_string()),
            host: Set(host.to_string()),
            port: Set(port),
            username: Set(username.to_string()),
            auth_method: Set(auth_method.to_string()),
            password: Set(password.map(|s| s.to_string())),
            private_key: Set(private_key.map(|s| s.to_string())),
            passphrase: Set(passphrase.map(|s| s.to_string())),
            startup_command: Set(startup_command.map(|s| s.to_string())),
            notes: Set(notes.map(|s| s.to_string())),
            sort_order: Set(sort_order),
            is_enabled: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        };
        let result = model.insert(db).await?;
        Ok(SshTerminalOutput::from(result))
    }

    /// Update an SSH terminal.
    pub async fn update(
        db: &DatabaseConnection,
        id: Uuid,
        name: Option<&str>,
        host: Option<&str>,
        port: Option<i32>,
        username: Option<&str>,
        auth_method: Option<&str>,
        password: Option<Option<&str>>,
        private_key: Option<Option<&str>>,
        passphrase: Option<Option<&str>>,
        startup_command: Option<Option<&str>>,
        notes: Option<Option<&str>>,
        sort_order: Option<i32>,
        is_enabled: Option<bool>,
    ) -> Result<SshTerminalOutput, AppError> {
        let existing = ssh_terminals::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("SSH terminal not found".into()))?;

        let now = chrono::Utc::now().fixed_offset();
        let mut am: ssh_terminals::ActiveModel = existing.into();
        am.updated_at = Set(now);

        if let Some(v) = name {
            am.name = Set(v.to_string());
        }
        if let Some(v) = host {
            am.host = Set(v.to_string());
        }
        if let Some(v) = port {
            am.port = Set(v);
        }
        if let Some(v) = username {
            am.username = Set(v.to_string());
        }
        if let Some(v) = auth_method {
            am.auth_method = Set(v.to_string());
        }
        if let Some(v) = password {
            am.password = Set(v.map(|s| s.to_string()));
        }
        if let Some(v) = private_key {
            am.private_key = Set(v.map(|s| s.to_string()));
        }
        if let Some(v) = passphrase {
            am.passphrase = Set(v.map(|s| s.to_string()));
        }
        if let Some(v) = startup_command {
            am.startup_command = Set(v.map(|s| s.to_string()));
        }
        if let Some(v) = notes {
            am.notes = Set(v.map(|s| s.to_string()));
        }
        if let Some(v) = sort_order {
            am.sort_order = Set(v);
        }
        if let Some(v) = is_enabled {
            am.is_enabled = Set(v);
        }

        let result = am.update(db).await?;
        Ok(SshTerminalOutput::from(result))
    }

    /// Delete an SSH terminal.
    pub async fn delete(db: &DatabaseConnection, id: Uuid) -> Result<(), AppError> {
        let result = ssh_terminals::Entity::delete_by_id(id).exec(db).await?;
        if result.rows_affected == 0 {
            return Err(AppError::NotFound("SSH terminal not found".into()));
        }
        Ok(())
    }
}
