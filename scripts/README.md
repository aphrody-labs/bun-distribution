# Aphrody Scripts Directory

This directory contains automation, builds, audits, releases, and migration tooling for the Aphrody workspace.
Per repository instructions in `AGENTS.md`, first-party scripts reside strictly within the following canonical categories:

## Layout

```
scripts/
├── audit/        # Code health, benchmark, graph parity, and live auditing scripts
├── build/        # Compilation helpers (rust/cargo-serial.sh, rust/vps-cargo.ts)
├── dev/          # Local and cloud developer environment setup (cloud-setup.sh)
├── migration/    # Coordinated state container transfers and environment migrations
├── release/      # Crate, npm package, download and runtime publishing scripts
└── tools/        # Domain-scoped utility tooling (ai/, compat/, infra/, os/, secrets/, ui/, workspace/)
```

## Running Scripts

All TypeScript and JavaScript scripts are executed using [Bun](https://bun.sh):

```bash
bun scripts/<category>/<domain>/<script>.ts [args]
```

### Common Tasks

- **Docs generation & link checks**:
  ```bash
  bun run docs:gen
  bun run docs:check
  bun run docs:check-links
  ```
- **Workspace gate verification**:
  ```bash
  bun run bun:check
  bun run typecheck
  bun run lint
  ```
- **Remote Cargo builds (from WSL)**:
  ```bash
  bun scripts/build/rust/vps-cargo.ts run -- <cargo args>
  ```
