use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    db::{entities::ssh_terminal, models::ssh_terminal::SshTerminalOutput},
    error::{AppError, OptionExt},
};

#[derive(Debug)]
pub struct CreateSshTerminalData {
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub startup_command: Option<String>,
    pub notes: Option<String>,
    pub sort_order: i32,
}

#[allow(clippy::option_option)]
#[derive(Debug)]
pub struct UpdateSshTerminalData {
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub auth_method: Option<String>,
    pub password: Option<Option<String>>,
    pub private_key: Option<Option<String>>,
    pub passphrase: Option<Option<String>>,
    pub startup_command: Option<Option<String>>,
    pub notes: Option<Option<String>>,
    pub sort_order: Option<i32>,
    pub is_enabled: Option<bool>,
}

pub struct SshTerminalRepo;

impl SshTerminalRepo {
    pub async fn list_all<C: ConnectionTrait>(db: &C) -> Result<Vec<SshTerminalOutput>, AppError> {
        let models = ssh_terminal::Entity::find()
            .order_by_asc(ssh_terminal::Column::SortOrder)
            .order_by_asc(ssh_terminal::Column::CreatedAt)
            .all(db)
            .await?;
        Ok(models.into_iter().map(SshTerminalOutput::from).collect())
    }

    pub async fn get_by_id<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<SshTerminalOutput, AppError> {
        let model = Self::get_raw(db, id).await?;
        Ok(SshTerminalOutput::from(model))
    }

    pub async fn get_raw<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<ssh_terminal::Model, AppError> {
        ssh_terminal::Entity::find_by_id(id)
            .one(db)
            .await?
            .not_found("SSH terminal not found")
    }

    pub async fn create<C: ConnectionTrait>(
        db: &C,
        input: CreateSshTerminalData,
    ) -> Result<SshTerminalOutput, AppError> {
        let now = Utc::now().fixed_offset();
        let model = ssh_terminal::ActiveModel {
            id: Set(Uuid::new_v4()),
            file_system_id: Set(None),
            name: Set(input.name),
            host: Set(input.host),
            port: Set(input.port),
            username: Set(input.username),
            auth_method: Set(input.auth_method),
            password: Set(input.password),
            private_key: Set(input.private_key),
            passphrase: Set(input.passphrase),
            startup_command: Set(input.startup_command),
            notes: Set(input.notes),
            sort_order: Set(input.sort_order),
            is_enabled: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        };
        Ok(SshTerminalOutput::from(model.insert(db).await?))
    }

    pub async fn update<C: ConnectionTrait>(
        db: &C,
        id: Uuid,
        input: UpdateSshTerminalData,
    ) -> Result<SshTerminalOutput, AppError> {
        let existing = Self::get_raw(db, id).await?;
        let mut am: ssh_terminal::ActiveModel = existing.into();
        am.updated_at = Set(Utc::now().fixed_offset());
        if let Some(v) = input.name {
            am.name = Set(v);
        }
        if let Some(v) = input.host {
            am.host = Set(v);
        }
        if let Some(v) = input.port {
            am.port = Set(v);
        }
        if let Some(v) = input.username {
            am.username = Set(v);
        }
        if let Some(v) = input.auth_method {
            am.auth_method = Set(v);
        }
        if let Some(v) = input.password {
            am.password = Set(v);
        }
        if let Some(v) = input.private_key {
            am.private_key = Set(v);
        }
        if let Some(v) = input.passphrase {
            am.passphrase = Set(v);
        }
        if let Some(v) = input.startup_command {
            am.startup_command = Set(v);
        }
        if let Some(v) = input.notes {
            am.notes = Set(v);
        }
        if let Some(v) = input.sort_order {
            am.sort_order = Set(v);
        }
        if let Some(v) = input.is_enabled {
            am.is_enabled = Set(v);
        }
        Ok(SshTerminalOutput::from(am.update(db).await?))
    }

    pub async fn delete<C: ConnectionTrait>(db: &C, id: Uuid) -> Result<(), AppError> {
        let result = ssh_terminal::Entity::delete_many()
            .filter(ssh_terminal::Column::Id.eq(id))
            .exec(db)
            .await?;
        if result.rows_affected == 0 {
            return Err(AppError::NotFound("SSH terminal not found".into()));
        }
        Ok(())
    }
}
