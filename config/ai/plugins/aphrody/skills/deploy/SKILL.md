---
name: deploy
description: "Deploy, restart, provision or clean Aphrody hosts (vps, dbfr, WSL) through aphrody-infra (CLI, catalogs) and the kernel infra tools that wrap it. Triggers: deploy, ship, release, mise en prod, free disk."
---

# deploy — through aphrody-infra only

`../aphrody-infra` owns hosts, services, routes, toolchains and inventories; the kernel tools below
only execute through it and never keep a second host registry.

Host management is available through two synchronized control layers:
1. **The kernel `infra` subsystem** (`crates/aphrody-kernel/src/infra.rs`): In-process SSH, native SFTP, differential sync and remote Git tools directly callable over MCP.
2. **`aphrody-infra` CLI** (`../aphrody-infra`): Declarative catalogs (`config/service-catalog.json`, `config/nginx-routes.json`), host inventories, and release playbooks.

Read `aphrody-infra/README.md` and `aphrody-infra/docs/PLAN.md` before mutations.

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
3. **Workspace relative traversal**: `../aphrody-infra/Cargo.toml` or `aphrody-infra/Cargo.toml`.
4. **User home profile**: `~/src/aphrody-infra/Cargo.toml` or `~/aphrody-infra/Cargo.toml`.
5. **Compiled target binary discovery**: Detects existing `target/debug/aphrody-ssh[.exe]` or `target/release/aphrody-ssh[.exe]`, falling back cleanly to `cargo run --manifest-path ... -p aphrody-ssh --`.

## `aphrody-infra` CLI operations

| Goal | Command (from `aphrody-infra`) |
| --- | --- |
| Observe hosts | `cargo run -- status [--target id]` |
| Catalog consistency | `cargo run -- validate` |
| Toolchain / APT on a host | `cargo run -- dev-env --target vps\|dbfr\|wsl-ubuntu-24.04 [--apply]` (on the host: `nu scripts/setup.nu`) |
| Free disk safely | `cargo run -- reclaim --target vps [--apply]` (allowlist `config/disk-reclaim.json`) |
| Release | `cargo run -- deploy --target id --release <path> --apply` |

Rules: plan (`apply: false` / no `--apply`) first; services and nginx routes are added to
`config/service-catalog.json` / `config/nginx-routes.json`, never hand-written
on a host; data (PostgreSQL, SQLite, assets) is backed up and checksum-verified
before any move; refresh `inventory/` and `docs/PLAN.md` after every mutation.
Host playbook and pitfalls: `yolo` skill §5.
