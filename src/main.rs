//! Tokimo Terminal App — sidecar CLI / server binary.

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
    about = "Terminal — Tokimo local PTY + SSH sidecar",
    long_about = "Tokimo Terminal CLI. With TOKIMO_BUS_SOCKET set, starts the sidecar server; otherwise prints help or runs CLI subcommands.",
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
    /// Print a greeting
    Greet { name: String },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let Cli { auth: _, command } = Cli::parse();

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
        Some(Command::Greet { name }) => {
            cli::run_greet(name);
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
