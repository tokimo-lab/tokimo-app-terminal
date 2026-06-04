//! Library facade for tests and type generation.

pub(crate) const MANIFEST: &str = include_str!("../tokimo-app.toml");

pub mod bus_clients;
pub mod ctx;
pub mod db;
pub mod error;
pub mod handlers;
pub mod registries;

pub use error::AppError;
