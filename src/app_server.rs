use std::sync::Arc;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::{assets, ctx::AppCtx, handlers};

pub fn spawn(service: &str, ctx: Arc<AppCtx>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "terminal: app server listening");

    let router = build_router(ctx);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "terminal: app server stopped");
        }
    });

    Ok(socket)
}

fn build_router(ctx: Arc<AppCtx>) -> Router {
    Router::new()
        .route("/local-ws", get(handlers::terminal_ws))
        .route("/internal/ssh-creds/{id}", get(handlers::internal_ssh_creds))
        .route(
            "/connections",
            get(handlers::list_ssh_terminal).post(handlers::create_ssh_terminal),
        )
        .route("/connections/ws", get(handlers::ssh_terminal_ws))
        .route(
            "/connections/{id}",
            get(handlers::get_ssh_terminal)
                .patch(handlers::update_ssh_terminal)
                .delete(handlers::delete_ssh_terminal),
        )
        .route("/connections/{id}/stats", get(handlers::ssh_terminal_stats))
        .route("/connections/{id}/ls", get(handlers::ssh_terminal_ls))
        .route("/connections/{id}/ps", get(handlers::ssh_terminal_ps))
        .route("/connections/{id}/kill", post(handlers::ssh_terminal_kill))
        .route("/connections/{id}/df", get(handlers::ssh_terminal_df))
        .route("/connections/{id}/net", get(handlers::ssh_terminal_net))
        .route("/connections/{id}/mkdir", post(handlers::ssh_terminal_mkdir))
        .route("/connections/{id}/rm", post(handlers::ssh_terminal_rm))
        .route("/connections/{id}/rename", post(handlers::ssh_terminal_rename))
        .route("/connections/{id}/mv", post(handlers::ssh_terminal_mv))
        .route("/connections/{id}/read-file", post(handlers::ssh_terminal_read_file))
        .route("/connections/{id}/write-file", post(handlers::ssh_terminal_write_file))
        .route("/connections/{id}/download", get(handlers::ssh_terminal_download))
        .route(
            "/connections/{id}/upload",
            post(handlers::ssh_terminal_upload).layer(DefaultBodyLimit::disable()),
        )
        .route("/connections/{id}/docker/ps", get(handlers::ssh_docker_ps))
        .route("/connections/{id}/docker/start", post(handlers::ssh_docker_start))
        .route("/connections/{id}/docker/stop", post(handlers::ssh_docker_stop))
        .route("/connections/{id}/docker/restart", post(handlers::ssh_docker_restart))
        .route("/connections/{id}/docker/logs", post(handlers::ssh_docker_logs))
        .route("/connections/{id}/docker/images", get(handlers::ssh_docker_images))
        .route("/connections/{id}/docker/rm", post(handlers::ssh_docker_rm))
        .route("/connections/{id}/docker/pause", post(handlers::ssh_docker_pause))
        .route("/connections/{id}/docker/unpause", post(handlers::ssh_docker_unpause))
        .route("/connections/{id}/docker/rmi", post(handlers::ssh_docker_rmi))
        .route("/connections/{id}/docker/networks", get(handlers::ssh_docker_networks))
        .route("/connections/{id}/docker/inspect", get(handlers::ssh_docker_inspect))
        .route("/connections/{id}/docker/volumes", get(handlers::ssh_docker_volumes))
        .route(
            "/connections/{id}/docker/volume-rm",
            post(handlers::ssh_docker_volume_rm),
        )
        .route("/connections/{id}/docker/stats", get(handlers::ssh_docker_stats))
        .route(
            "/connections/{id}/docker/network-rm",
            post(handlers::ssh_docker_network_rm),
        )
        .route(
            "/connections/{id}/docker/prune-images",
            post(handlers::ssh_docker_prune_images),
        )
        .route(
            "/connections/{id}/docker/prune-volumes",
            post(handlers::ssh_docker_prune_volumes),
        )
        .route(
            "/connections/{id}/docker/prune-networks",
            post(handlers::ssh_docker_prune_networks),
        )
        .route(
            "/connections/{id}/docker/prune-system",
            post(handlers::ssh_docker_prune_system),
        )
        .route("/assets/{*path}", get(assets::serve))
        .with_state(ctx)
}
