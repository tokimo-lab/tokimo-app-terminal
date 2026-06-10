//! Server management CLI commands — direct database access.
//!
//! Lists, shows, creates, updates, and deletes SSH terminal connections
//! stored in the `terminal.ssh_terminal` PostgreSQL table.

use anyhow::Context;
use tokimo_bus_cli::TokimoAuthArgs;

use crate::db::repos::ssh_terminal_repo::{CreateSshTerminalData, SshTerminalRepo, UpdateSshTerminalData};

use super::{init_db, resolve_server};

// ── list ─────────────────────────────────────────────────────────────────────

pub async fn run_list(auth: TokimoAuthArgs) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let servers = SshTerminalRepo::list_all(&db).await?;
    if servers.is_empty() {
        println!("No SSH servers configured.");
        return Ok(());
    }
    println!(
        "{:<38}  {:<16}  {:<20}  {:<6}  {:<12}  {:<12}  {:<6}  {}",
        "ID", "NAME", "HOST", "PORT", "USER", "AUTH", "ON", "NOTES"
    );
    for s in &servers {
        println!(
            "{:<38}  {:<16}  {:<20}  {:<6}  {:<12}  {:<12}  {:<6}  {}",
            s.id,
            truncate(&s.name, 16),
            truncate(&s.host, 20),
            s.port,
            truncate(&s.username, 12),
            s.auth_method,
            if s.is_enabled { "✓" } else { "✗" },
            truncate(s.notes.as_deref().unwrap_or("-"), 30)
        );
    }
    Ok(())
}

// ── show ─────────────────────────────────────────────────────────────────────

pub async fn run_show(auth: TokimoAuthArgs, server: String) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let s = resolve_server(&db, &server).await?;
    let output = crate::db::models::ssh_terminal::SshTerminalOutput::from(s);
    println!("name:       {}", output.name);
    println!("host:       {}", output.host);
    println!("port:       {}", output.port);
    println!("username:   {}", output.username);
    println!("auth:       {}", output.auth_method);
    println!("has_key:    {}", if output.has_private_key { "yes" } else { "no" });
    println!("startup:    {}", output.startup_command.as_deref().unwrap_or("-"));
    println!("notes:      {}", output.notes.as_deref().unwrap_or("-"));
    println!("enabled:    {}", if output.is_enabled { "yes" } else { "no" });
    println!("created:    {}", output.created_at);
    println!("updated:    {}", output.updated_at);
    Ok(())
}

// ── add ──────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn run_add(
    auth: TokimoAuthArgs,
    name: String,
    host: String,
    user: String,
    port: i32,
    auth_method: String,
    password: Option<String>,
    key: Option<String>,
    passphrase: Option<String>,
    startup: Option<String>,
    notes: Option<String>,
) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let created = SshTerminalRepo::create(
        &db,
        CreateSshTerminalData {
            name,
            host,
            port,
            username: user,
            auth_method,
            password,
            private_key: key,
            passphrase,
            startup_command: startup,
            notes,
            sort_order: 0,
        },
    )
    .await
    .context("create server failed")?;
    println!("Created server '{}' (id: {})", created.name, created.id);
    Ok(())
}

// ── rm ───────────────────────────────────────────────────────────────────────

pub async fn run_rm(auth: TokimoAuthArgs, server: String) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let terminal = resolve_server(&db, &server).await?;
    let name = terminal.name.clone();
    let id = terminal.id;
    SshTerminalRepo::delete(&db, id).await.context("delete server failed")?;
    println!("Deleted server '{name}' (id: {id})");
    Ok(())
}

// ── edit ─────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn run_edit(
    auth: TokimoAuthArgs,
    server: String,
    name: Option<String>,
    host: Option<String>,
    user: Option<String>,
    port: Option<i32>,
    auth_method: Option<String>,
    password: Option<String>,
    key: Option<String>,
    passphrase: Option<String>,
    startup: Option<String>,
    notes: Option<String>,
) -> anyhow::Result<()> {
    let (db, _user_id) = init_db(&auth).await?;
    let terminal = resolve_server(&db, &server).await?;
    let id = terminal.id;
    let old_name = terminal.name.clone();

    SshTerminalRepo::update(
        &db,
        id,
        UpdateSshTerminalData {
            name,
            host,
            port,
            username: user,
            auth_method,
            password: password.map(Some),
            private_key: key.map(Some),
            passphrase: passphrase.map(Some),
            startup_command: startup.map(Some),
            notes: notes.map(Some),
            sort_order: None,
            is_enabled: None,
        },
    )
    .await
    .context("update server failed")?;
    println!("Updated server '{old_name}' (id: {id})");
    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max - 1])
    }
}
