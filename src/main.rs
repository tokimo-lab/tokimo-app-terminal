//! Tokimo Terminal App — sidecar CLI / server binary.

#![allow(clippy::print_stdout, clippy::print_stderr)]

const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod bus_clients;
mod cli;
mod ctx;
mod db;
mod error;
mod handlers;
mod registries;

use std::sync::{Arc, OnceLock};

use clap::{Parser, Subcommand};
use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

pub use error::AppError;

#[derive(Parser, Debug)]
#[command(
    name = "tokimo-app-terminal",
    about = "Terminal — Tokimo SSH server management & remote execution CLI",
    long_about = "Tokimo Terminal CLI — manage SSH servers and execute remote commands.\n\nDirectly connects to the database (via DATABASE_URL), does not require the main server to be running.",
    term_width = 100
)]
struct Cli {
    #[command(flatten)]
    auth: TokimoAuthArgs,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// List all SSH servers
    List,

    /// Show server details
    Show {
        /// Server name or UUID
        server: String,
    },

    /// Add an SSH server
    Add {
        #[arg(long)]
        name: String,
        #[arg(long)]
        host: String,
        #[arg(long, short = 'u')]
        user: String,
        #[arg(long, short, default_value = "22")]
        port: i32,
        #[arg(long, default_value = "password")]
        auth: String,
        #[arg(long)]
        password: Option<String>,
        #[arg(long)]
        key: Option<String>,
        #[arg(long)]
        passphrase: Option<String>,
        #[arg(long)]
        startup: Option<String>,
        #[arg(long)]
        notes: Option<String>,
    },

    /// Remove an SSH server
    Rm {
        /// Server name or UUID
        server: String,
    },

    /// Update an SSH server
    Edit {
        /// Server name or UUID
        server: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        host: Option<String>,
        #[arg(long, short = 'u')]
        user: Option<String>,
        #[arg(long, short)]
        port: Option<i32>,
        #[arg(long)]
        auth: Option<String>,
        #[arg(long)]
        password: Option<String>,
        #[arg(long)]
        key: Option<String>,
        #[arg(long)]
        passphrase: Option<String>,
        #[arg(long)]
        startup: Option<String>,
        #[arg(long)]
        notes: Option<String>,
    },

    /// Execute a command on a remote server
    ///
    /// Examples:
    ///   tokimo-app-terminal exec my-server "df -h"
    ///   tokimo-app-terminal exec my-server ls -la
    #[command(trailing_var_arg = true)]
    Exec {
        /// Server name or UUID
        server: String,
        /// Command to execute (supports multiple args without quoting)
        #[arg(required = true, num_args = 1..)]
        command: Vec<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let Cli { auth, command } = Cli::parse();

    match command {
        None if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info,tokimo_bus_client=info,tokimo_app_terminal=debug".into()),
                )
                .init();
            if let Err(error) = run_server().await {
                error!(%error, "terminal: fatal");
                std::process::exit(1);
            }
        }
        None => {
            use clap::CommandFactory;
            let mut cmd = Cli::command();
            tokimo_bus_cli::print_help_unified(&mut cmd);
            std::process::exit(0);
        }
        Some(cmd) => {
            let result = match cmd {
                Command::List => cli::servers::run_list(auth).await,
                Command::Show { server } => cli::servers::run_show(auth, server).await,
                Command::Add {
                    name,
                    host,
                    user,
                    port,
                    auth: auth_method,
                    password,
                    key,
                    passphrase,
                    startup,
                    notes,
                } => {
                    cli::servers::run_add(
                        auth,
                        name,
                        host,
                        user,
                        port,
                        auth_method,
                        password,
                        key,
                        passphrase,
                        startup,
                        notes,
                    )
                    .await
                }
                Command::Rm { server } => cli::servers::run_rm(auth, server).await,
                Command::Edit {
                    server,
                    name,
                    host,
                    user,
                    port,
                    auth: auth_method,
                    password,
                    key,
                    passphrase,
                    startup,
                    notes,
                } => {
                    cli::servers::run_edit(
                        auth,
                        server,
                        name,
                        host,
                        user,
                        port,
                        auth_method,
                        password,
                        key,
                        passphrase,
                        startup,
                        notes,
                    )
                    .await
                }
                Command::Exec { server, command } => {
                    let cmd = command.join(" ");
                    cli::exec::run_exec(auth, server, cmd).await
                }
            };
            if let Err(error) = result {
                eprintln!("Error: {error:#}");
                std::process::exit(1);
            }
        }
    }

    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    let cfg = ClientConfig::from_env().map_err(|e| anyhow::anyhow!("ClientConfig: {e}"))?;
    info!(endpoint = ?cfg.endpoint, "terminal: connecting to broker");

    let db = db::init_pool().await?;
    info!("terminal: db connected");

    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());
    let context = Arc::new(ctx::AppCtx {
        db,
        client: Arc::clone(&client_slot),
        pty_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        ssh_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
    });

    let app_socket =
        app_server::spawn("terminal", Arc::clone(&context)).map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    let client = BusClient::builder(cfg)
        .service("terminal", env!("CARGO_PKG_VERSION"))
        .data_plane(app_socket)
        .build()
        .await
        .map_err(|e| anyhow::anyhow!("bus build: {e}"))?;
    client_slot
        .set(Arc::clone(&client))
        .map_err(|_| anyhow::anyhow!("client_slot already set"))?;

    info!("terminal: registered with broker");

    let shutdown = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.run_until_shutdown().await })
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("terminal: SIGINT received");
            client.shutdown();
        }
        _ = shutdown => info!("terminal: broker sent Shutdown"),
    }

    Ok(())
}
