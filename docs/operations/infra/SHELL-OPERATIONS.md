# Aphrody shell operations

`aphrody-shell` (crate and category repository of the same name) is the
canonical shell surface for Aphrody OS, Aphrody AI and infrastructure
operations. It embeds Nushell, the native PTY/WebSocket backend and the
Ratatui terminal surface. `aphrody-kernel` (`aphrody-os`) owns the registered
shell subsystem; applications and agents are clients.

## Routing

- Windows, WSL, Linux and VPS select `aphrody-kernel` as the launcher.
- Nushell is the default command language and `aphrody-terminal-backend` owns
  PTY/stream transport.
- Tauri/Wry and terminal UI consume the same kernel subsystem; they do not
  create a second shell authority.
- `cmd.exe`, PowerShell and `pwsh.exe` remain compatibility tools only for
  host-specific setup scripts. They are not application runtimes.
- `uv`, Bun and Cargo are invoked as commands through this surface when an
  operation needs them; their dependency ownership remains in their canonical
  repository.

The machine-readable contract is [`config/shell-runtime.json`](../config/shell-runtime.json).

## Verification

```text
cargo test --manifest-path ../aphrody-shell/Cargo.toml -p aphrody-shell --locked
cargo run --manifest-path ../aphrody-os/Cargo.toml -p aphrody-kernel -- serve
bun run infra:check
cargo run -p aphrody-infra -- doctor --json
```

The last command is the infra CLI from this repository. Remote service actions
still require the explicit infra adapter and are never silently executed by a
desktop shell.
