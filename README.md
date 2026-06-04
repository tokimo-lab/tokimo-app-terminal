# Tokimo Terminal

Tokimo Terminal is a standard Tokimo sidecar app for local PTY sessions and SSH connection management.

## Layout

- `src/` — Axum sidecar server, Sea-ORM entity/repo, local PTY and SSH handlers.
- `migrations/` — app-owned PostgreSQL schema migration (`terminal`).
- `ui/` — isolated React/Vite UI bundle loaded by the Tokimo shell.

## Routes

The host proxies `/api/apps/terminal/*` to this sidecar, which mounts bare routes such as `/local-ws`, `/connections`, and `/connections/{id}/docker/ps`.
