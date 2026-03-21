use axum::{routing::get, Router};
use std::sync::Arc;

use crate::handlers::terminal;
use crate::AppState;

pub fn build_terminal_routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/terminal/ws", get(terminal::terminal_ws))
}
