---
name: deploy
description: "Deploy, restart, provision or clean Aphrody hosts (vps, dbfr, WSL) through aphrody-infra (CLI, catalogs) and the kernel infra tools that wrap it. Triggers: deploy, ship, release, mise en prod, free disk."
---

# deploy — through aphrody-infra only

`crates/infra` owns hosts, services, routes, toolchains and inventories; the kernel tools below
only execute through it and never keep a second host registry.

Host management is owned by the `aphrody-infra` control plane in this monorepo:
`crates/infra/infra` is the package directory, and `config/` plus `inventory/`
at the repository root hold its catalogs and target observations. The kernel
`infra` subsystem (`crates/os/kernel/src/infra.rs`) is an MCP adapter over that
owner; it does not maintain a second host registry. Confirm callable MCP tools
in the generated [MCP catalog](../../../../docs/ecosystem/MCP-TOOLS.md)
and verify their live availability in the connected MCP server before use.

Read the [Infra product README](../../../../docs/products/infra/README.md),
[Infra plan](../../../../docs/plans/infra/PLAN.md), and the relevant runbook before
mutations. `aphrody-infra status` reports the target and host summary;
`aphrody-infra service status` reports catalog workload units. They are
different views. Confirm the CLI source or installed `--help` before acting.
If a local Cargo invocation is needed, only the integrating agent runs it,
through `scripts/build/rust/cargo-serial.sh`.

## Kernel `infra` subsystem tools

| Tool | Parameters | Description |
|---|---|---|
| `infra_exec` | `host: "vps" \| "dbfr"`, `command: string` | Execute an arbitrary remote command over in-process SSH. Returns exit status, stdout and stderr. |
| `infra_sftp_list` | `host: "vps" \| "dbfr"`, `path?: string` | List remote directory entries and file metadata (size, permissions, `is_dir`) via native SFTP (default `/var/www`). |
| `infra_sftp_read` | `host: "vps" \| "dbfr"`, `path: string` | Read remote file content directly via native SFTP. |
| `infra_sync` | `host: "vps" \| "dbfr"`, `source: string`, `destination: string`, `apply?: boolean` | Differential sync (`fast-rsync`/`rclone`) between local and remote directories. Dry-run by default (`apply: false`). |
| `infra_git_status` | `host: "vps" \| "dbfr"`, `repo_path: string` | Inspect working tree dirty files and recent commits on a remote production Git repository. |

### Dynamic invoker resolution (zero hardcoded paths)

The kernel resolves the infrastructure runner dynamically through a five-stage fallback:
1. **System PATH**: `aphrody-ssh --version`.
2. **Environment overrides**: `APHRODY_INFRA_PATH` (exact `Cargo.toml`) or `APHRODY_INFRA_DIR`.
3. **Workspace relative traversal**: `crates/infra/infra/Cargo.toml`.
4. **User home profile**: `~/aphrody/crates/infra/infra/Cargo.toml`.
5. **Compiled target binary discovery**: Detects existing `target/debug/aphrody-ssh[.exe]` or `target/release/aphrody-ssh[.exe]`, falling back cleanly to `cargo run --manifest-path ... -p aphrody-ssh --`.

## `aphrody-infra` CLI operations

| Goal | Command (from monorepo root) |
| --- | --- |
| Observe hosts | `aphrody-infra status [--target id]`; catalog units: `aphrody-infra service status [--target id]` |
| Catalog consistency | `aphrody-infra validate` |
| Toolchain / APT on a host | `aphrody-infra dev-env --target vps|dbfr|wsl-ubuntu-24.04 [--apply]` (host setup details: [Infra README](../../../../docs/products/infra/README.md)) |
| Free disk safely | `aphrody-infra reclaim --target vps [--apply]` (allowlist `config/disk-reclaim.json`) |
| Release | `aphrody-infra deploy --target id --release <path> --apply` (select `--stack` when needed; see `--help`) |

When building/running a workspace CLI from source, use
`scripts/build/rust/cargo-serial.sh run --bin aphrody-infra -- <args>`.
Workers must leave Cargo gates to the integrating agent; never start parallel
Cargo processes.

The workspace facade is invoked directly as
`bun packages/infra/workspace/src/ops.ts <rg|shenron> ...`; it is not a Bun package
script named `ops`, so `bun run --filter @aphrody/workspace ops ...` is not a
valid invocation in this checkout. Shenron deploy requires a release path:
`bun packages/infra/workspace/src/ops.ts shenron deploy --target vps
--release <path> [--apply]`. RG deploy accepts `--target` and delegates to the
Rust Infra adapter. Confirm exact flags with the package source and CLI help
before running a deployment.

Plan with no `--apply` first. Services and Nginx routes are declared in the
repository-root `config/service-catalog.json` and `config/nginx-routes.json`,
never hand-written on a host. Back up and checksum-verify PostgreSQL, SQLite,
assets and other protected data before any move. Refresh the relevant
`inventory/` evidence and `docs/plans/infra/PLAN.md` after mutations. Historical
deployment reports do not prove current host health. Follow the current
immutable-release runbook linked from the [Infra README](../../../../docs/products/infra/README.md).
