use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    Internal(String),
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Unauthorized(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(msg) => write!(f, "not found: {msg}"),
            Self::BadRequest(msg) => write!(f, "bad request: {msg}"),
            Self::Unauthorized(msg) => write!(f, "unauthorized: {msg}"),
            Self::Internal(msg) => write!(f, "internal: {msg}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<sea_orm::DbErr> for AppError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::Internal(format!("db: {error}"))
    }
}

impl From<tokimo_package_ssh::SshError> for AppError {
    fn from(error: tokimo_package_ssh::SshError) -> Self {
        match error {
            tokimo_package_ssh::SshError::NotFound(msg) => Self::NotFound(msg),
            tokimo_package_ssh::SshError::BadInput(msg) => Self::BadRequest(msg),
            other => Self::Internal(other.to_string()),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = serde_json::json!({ "success": false, "error": self.to_string() });
        (status, Json(body)).into_response()
    }
}

pub trait OptionExt<T> {
    fn not_found(self, msg: &str) -> Result<T, AppError>;
    fn bad_request(self, msg: &str) -> Result<T, AppError>;
}

impl<T> OptionExt<T> for Option<T> {
    fn not_found(self, msg: &str) -> Result<T, AppError> {
        self.ok_or_else(|| AppError::NotFound(msg.to_string()))
    }
    fn bad_request(self, msg: &str) -> Result<T, AppError> {
        self.ok_or_else(|| AppError::BadRequest(msg.to_string()))
    }
}
