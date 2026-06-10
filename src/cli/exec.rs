//! Remote command execution via SSH.
//!
//! Resolves a server by name/id, fetches raw credentials from the database,
//! and executes the command via `tokimo-package-ssh`.

use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_package_ssh::SshCredentials;

use super::{init_db, resolve_server};

pub async fn run_exec(auth: TokimoAuthArgs, server: String, command: String) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let terminal = resolve_server(&db, &server).await?;
    let creds = SshCredentials::from(&terminal);

    let stdout = tokimo_package_ssh::client::exec(&creds, &command).await?;
    print!("{stdout}");
    Ok(())
}
