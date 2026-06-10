pub mod exec;
pub mod servers;

use anyhow::Context;
use tokimo_bus_auth::db::verify_token;
use tokimo_bus_cli::{Credentials, TokimoAuthArgs};
use uuid::Uuid;

use crate::db::{self, repos::ssh_terminal_repo::SshTerminalRepo};

/// Resolve credentials, connect to DB, and verify the token.
/// Returns `(db, user_id)`.
pub async fn init_db(auth: &TokimoAuthArgs) -> anyhow::Result<(sea_orm::DatabaseConnection, Uuid)> {
    let credentials = Credentials::resolve(auth).context("resolve Tokimo credentials failed")?;
    let db = db::init_pool().await.context("connect database failed")?;
    let verified = verify_token(&db, &credentials.token)
        .await
        .context("verify Tokimo token failed")?;
    Ok((db, verified.user_id))
}

/// Resolve a server `name-or-id` argument to a concrete SSH terminal record.
///
/// 1. If `arg` is a UUID equal to some terminal id → use it.
/// 2. Else match by exact `name`: exactly one → use it; more than one →
///    bail listing each candidate's id + host; zero → bail with guidance.
pub async fn resolve_server(
    db: &sea_orm::DatabaseConnection,
    arg: &str,
) -> anyhow::Result<crate::db::entities::ssh_terminal::Model> {
    // Try UUID first
    if let Ok(id) = Uuid::parse_str(arg)
        && let Ok(terminal) = SshTerminalRepo::get_raw(db, id).await {
            return Ok(terminal);
        }

    // Match by name
    let all = SshTerminalRepo::list_all(db).await?;
    let matches: Vec<_> = all.iter().filter(|t| t.name == arg).collect();
    match matches.as_slice() {
        [one] => {
            // Re-fetch raw model to get secrets
            let id = Uuid::parse_str(&one.id).expect("id from DB is valid UUID");
            Ok(SshTerminalRepo::get_raw(db, id).await?)
        }
        [] => anyhow::bail!(
            "No server named or matching id '{arg}'.\nRun 'tokimo-app-terminal list' to see available servers."
        ),
        many => {
            use std::fmt::Write as _;
            let mut msg = format!(
                "Found {} servers named '{arg}'. Please specify by id instead:",
                many.len()
            );
            for t in many {
                let _ = write!(msg, "\n  {}  ({}@{})", t.id, t.username, t.host);
            }
            anyhow::bail!("{msg}")
        }
    }
}
