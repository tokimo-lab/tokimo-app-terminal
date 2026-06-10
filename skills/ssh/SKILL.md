---
name: ssh
description: "Manage SSH servers and run remote commands."
when-to-use: "When the user wants to list, add, edit, or remove SSH servers, or execute a command on a remote server."
argument-hint: "<server name> [command]"
version: "0.1.0"
context: inline
---

# Terminal SSH

Manage SSH server connections and execute remote commands.

## Quick Reference

| Task | Command |
|------|---------|
| List servers | `tokimo-app-terminal list` |
| Server details | `tokimo-app-terminal show <server>` |
| Add server | `tokimo-app-terminal add --name prod --host 1.2.3.4 --user root` |
| Add with key auth | `tokimo-app-terminal add --name prod --host 1.2.3.4 --user root --auth private_key --key "$(cat ~/.ssh/id_ed25519)"` |
| Edit server | `tokimo-app-terminal edit <server> --notes "new notes"` |
| Remove server | `tokimo-app-terminal rm <server>` |
| Run a command | `tokimo-app-terminal exec <server> <command>` |

## Server addressing

Every command that targets a server takes a name or UUID. Name is preferred.
If two servers share the same name, the command fails and lists their ids.

```bash
tokimo-app-terminal list
# ID                                    NAME              HOST          PORT  USER  AUTH         ON    NOTES
# f87fa5a1-...                          prod              1.2.3.4       22    root  private_key  ✓     Production server
# e57cbad3-...                          staging           10.0.0.1      22    admin private_key  ✓     -
```

If two servers share the same name, any command targeting that name will fail
and list their UUIDs — use the UUID to disambiguate.

## Exec

Runs a command over SSH. stdout/stderr come through directly.

```bash
tokimo-app-terminal exec prod uname -a
tokimo-app-terminal exec prod "df -h /"
tokimo-app-terminal exec prod ls -la
tokimo-app-terminal exec prod docker ps
```
