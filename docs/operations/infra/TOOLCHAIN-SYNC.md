<!-- SPDX-License-Identifier: Apache-2.0 -->
# Toolchain sync (WSL, Windows, vps, dbfr)

Owner: Infra. Plan and manifest: [`config/infra/toolchain.json`](../../../config/infra/toolchain.json).
Apply: `scripts/tools/toolchain-sync.sh` (Linux hosts, run on the host over SSH with
`ssh <host> 'bash -s' < scripts/tools/toolchain-sync.sh`; the manifest is copied to
`~/.cache/aphrody-toolchain.json` first) and `scripts/tools/toolchain-sync.ps1` (Windows, pwsh 7,
non-elevated). Both are idempotent and never run a Cargo build, edit shell profiles or touch
services, nginx, units, databases, models or persistent stores.

## Canonical sources

- Rust: rustup (1.98.1 plus the iecode nightly pin), tools by `cargo-binstall` with compile disabled.
- JS/TS: Bun 1.4.2, globals by `bun add -g` (tsc 7.0.2, tsgo, oxlint, oxfmt, bun/node types and the
  `bunx`/`npx`/`nx` tools found in aphrody, yolo and aphrody-py scripts).
- Python: uv, Python 3.12 (repository pin). Linux system tools (rsync, zstd, pigz, mosh, ripgrep,
  eza, node) come from apt on Ubuntu 26.04; ovhcloud, rclone, yq, carapace, gh and pwsh are
  release binaries under `~/.local/bin` (pwsh under `~/.local/share/powershell`).
- Windows: winget user scope (jq, yq, carapace, zstd, WezTerm nightly, gh, uv, bun, rclone) and
  binstall for the Rust set. PATH comes from `aphrody-claude/user/shell/profile.ps1`.
- Aphrody binaries: prebuilt Linux `aphrody`, `aphrody-infra` (embeds the `aphrody-ovh` crate) and
  `aphrody-kernel` are streamed from the WSL release install (zstd over SSH) to `~/.local/bin` on
  vps and dbfr. `aphrody-ops` and `aphrody-workspace` are Bun scripts in
  `packages/infra/workspace` and need a source checkout (factory workspace bootstrap).

## Open items

- Windows has no prebuilt Aphrody binary; integrator build on the factory:
  `scripts/build/rust/cargo-serial.sh build --release --target x86_64-pc-windows-msvc -p aphrody-infra -p aphrody-kernel`.
- Windows lacks rsync, pigz, zellij and `sftp.exe` (elevated step: `winget install Microsoft.OpenSSH.Preview`).
- dbfr root is 88% full (12 GiB free): no extra Rust targets installed there.
- OVH credentials: configure only through existing env/files; none were copied.

## Bun version policy and hygiene

Pin: Bun 1.4.2 (`packageManager`). A user timer (`aphrody-bun-hygiene`, Windows task
`AphrodyBunHygiene`) runs `scripts/tools/bun-hygiene.sh` / `.ps1` daily: it upgrades Bun to the
newest stable release at least three days old (same window as `bunfig.toml`
`minimumReleaseAge`), then reports global packages, `bun outdated`, untrusted lifecycle scripts and
cache size (prunes entries unused for 30 days above 5 GB), and runs
`bun install --frozen-lockfile --dry-run` on a temporary copy of the manifests where a checkout
exists. It never rewrites a lockfile or a shared tree and never restarts a service. Repository pins
stay owned by `aphrody-update pins` and `aphrody-update bun`; bump the pin there, then re-run the
sync scripts. Logs: `~/.local/state/aphrody/log/bun-hygiene.log` (Windows
`%LOCALAPPDATA%\aphrody\log`).
