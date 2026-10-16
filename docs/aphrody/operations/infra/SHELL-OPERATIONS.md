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
- Tauri/CEF and terminal UI consume the same kernel subsystem; they do not
  create a second shell authority.
- `cmd.exe`, PowerShell and `pwsh.exe` remain compatibility tools only for
  host-specific setup scripts. They are not application runtimes.
- `uv`, Bun and Cargo are invoked as commands through this surface when an
  operation needs them; their dependency ownership remains in their canonical
  repository.

The machine-readable contract is [`tools/config/shell-runtime.json`](../../../../tools/aphrody/config/shell-runtime.json).

## Verification

```text
scripts/build/rust/cargo-serial.sh test -p aphrody-shell --locked
scripts/build/rust/cargo-serial.sh run -p aphrody-kernel -- serve
aphrody-infra validate --json
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- doctor --json
```

The last command is the infra CLI from this repository. Remote service actions
still require the explicit infra adapter and are never silently executed by a
desktop shell.
