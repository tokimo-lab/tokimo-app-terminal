use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use std::sync::Arc;

use crate::handlers::ssh_terminal;
use crate::AppState;

pub fn build_ssh_terminal_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/ssh-terminals", get(ssh_terminal::list_ssh_terminals))
        .route(
            "/api/ssh-terminals",
            post(ssh_terminal::create_ssh_terminal),
        )
        .route(
            "/api/ssh-terminals/{id}",
            get(ssh_terminal::get_ssh_terminal),
        )
        .route(
            "/api/ssh-terminals/{id}",
            patch(ssh_terminal::update_ssh_terminal),
        )
        .route(
            "/api/ssh-terminals/{id}",
            delete(ssh_terminal::delete_ssh_terminal),
        )
        .route(
            "/api/ssh-terminals/{id}/stats",
            get(ssh_terminal::ssh_terminal_stats),
        )
        .route(
            "/api/ssh-terminals/{id}/ls",
            get(ssh_terminal::ssh_terminal_ls),
        )
        .route(
            "/api/ssh-terminals/{id}/ps",
            get(ssh_terminal::ssh_terminal_ps),
        )
        .route(
            "/api/ssh-terminals/{id}/kill",
            post(ssh_terminal::ssh_terminal_kill),
        )
        .route(
            "/api/ssh-terminals/{id}/df",
            get(ssh_terminal::ssh_terminal_df),
        )
        .route("/api/ssh-terminals/ws", get(ssh_terminal::ssh_terminal_ws))
}
