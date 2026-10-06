<!-- SPDX-License-Identifier: Apache-2.0 -->
# Cloud-ready setup, end to end

One procedure for GitHub, Claude Code cloud sessions, the two VPS (`vps`, `dbfr`) and WSL, with no human in the
loop. Applies to `aphrody-labs/{aphrody,vu,shenron,bun}`; Yolo ships from the aphrody monorepo.

## Per-repository hooks (committed, secret-free)

| Repository | `.claude/settings.json` SessionStart | Files |
| --- | --- | --- |
| aphrody | `session-start.sh` (pinned Bun, `bun install`, `cloud-setup.sh`), `cloud-ssh.sh`, `session-start.ts` | `.claude/hooks/`, `scripts/dev/` |
| vu | `cloud-setup.sh`, `cloud-ssh.sh`, `session-start.ts` | `scripts/dev/` |
| shenron | `cloud-setup.sh`, `cloud-ssh.sh`, `session-start.ts` | `scripts/dev/` |
| bun fork | `cloud-ssh.sh`, `session-start.ts` (builds go to the VPS factory) | `scripts/dev/` |

All hooks are idempotent, tolerant (exit 0) and do nothing outside a cloud session except `session-start.ts`, which
only prints the Git state, host reachability and the open work (`agy.md`).

## Cloud environment (claude.ai, environment settings)

Attach the four repositories (see [CONTEXT-HANDOFF.md](CONTEXT-HANDOFF.md)), then set these variables. They are
secrets: never commit them, never print them.

| Variable | Meaning |
| --- | --- |
| `APHRODY_SSH_KEY_B64` | base64 of a dedicated private key authorised on both VPS (and WSL if reachable) |
| `APHRODY_VPS_HOST`, `APHRODY_DBFR_HOST` | addresses of the two VPS |
| `APHRODY_SSH_USER` | login, default `ubuntu` |
| `APHRODY_WSL_HOST`, `APHRODY_WSL_PORT`, `APHRODY_WSL_USER` | optional: WSL reachable through a reverse tunnel or the private network ([PRIVATE-TUNNEL.md](../infra/PRIVATE-TUNNEL.md)) |
| `APHRODY_DOWNLOAD_BASE` | optional: `https://downloads.aphrody.com`, installs the released `aphrody` and `yolo` |
| `GH_TOKEN` | GitHub token for `gh` and HTTPS pushes (`cloud-ssh.sh` sets the identity and the credential helper) |

`SHENRON_SSH_KEY_B64`, `SHENRON_VPS_HOST`, `SHENRON_DBFR_HOST` and `SHENRON_SSH_USER` remain accepted.
`cloud-ssh.sh` writes the `vps`, `dbfr` and `wsl` aliases in `~/.ssh/config` so `aphrody infra ssh exec --host <alias>`
and `ssh <alias>` work as on the owner machine.

## Work split

- Cloud (4 CPU, 15 GB): Bun, docs, scoped `-p <crate>` Cargo gates through `scripts/build/rust/cargo-serial.sh`.
- Heavy builds (full workspace, V8, Tauri, WebKit, the Bun fork, `vu` runtime artifacts): the VPS factory,
  `bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` from WSL or `aphrody infra ssh exec --host vps` from the cloud.
- WSL: no heavy Cargo (crashes WSL); `vps-cargo.ts`, `bootstrap.sh`, tmux tunnels `vps-tunnel`/`vps-cargo`.
- Hosts change only through Infra's catalog: plan before apply. Publication and `omar`/WireGuard apply still need the
  owner's written order ([agy.md](../../../agy.md)).

## Verify

`bun scripts/dev/cloud-doctor.ts` prints one line per check (Bun pin, Rust, uv, `aphrody`, `yolo`, SSH aliases, remote
reachability, push remote) and exits non-zero on a missing required item. Sessions sync through
[CLOUD-SYNC.md](CLOUD-SYNC.md).
