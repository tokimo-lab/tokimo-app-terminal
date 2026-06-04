use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(schema_name = "terminal", table_name = "ssh_terminal")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub file_system_id: Option<Uuid>,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub host: String,
    pub port: i32,
    #[sea_orm(column_type = "Text")]
    pub username: String,
    #[sea_orm(column_type = "Text")]
    pub auth_method: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub password: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub private_key: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub passphrase: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub startup_command: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub notes: Option<String>,
    pub sort_order: i32,
    pub is_enabled: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
