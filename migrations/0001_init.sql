CREATE SCHEMA IF NOT EXISTS terminal;

CREATE TABLE IF NOT EXISTS terminal.ssh_terminal (
    id UUID PRIMARY KEY,
    file_system_id UUID NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_method TEXT NOT NULL DEFAULT 'password',
    password TEXT NULL,
    private_key TEXT NULL,
    passphrase TEXT NULL,
    startup_command TEXT NULL,
    notes TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terminal_ssh_terminal_file_system_id
    ON terminal.ssh_terminal(file_system_id);

CREATE INDEX IF NOT EXISTS idx_terminal_ssh_terminal_sort
    ON terminal.ssh_terminal(sort_order, created_at);
