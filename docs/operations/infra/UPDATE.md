<!-- SPDX-License-Identifier: Apache-2.0 -->
# Update pipeline (`aphrody-update`)

Owner: Infra (`packages/infra/update`, package `@aphrody/update`, also reachable as `aphrody-ops update` and
`aphrody-ops deps-sync`). One entry point for toolchains, dependencies, the Cargo lock, user systemd units and the
dev-env checks. Bun, uv and the Tauri family follow the latest published release; see the policy below.

| Module | Command | What it does |
| --- | --- | --- |
| gate | `bun run update` | pins agree everywhere, user units linked, `/etc/wsl.conf` matches `config/wsl/wsl.conf` (exit 1 on drift) |
| pins | `aphrody-update pins [check\|apply <tool> <version>]` | every hardcoded version of bun, uv, rust, nushell, oxlint, oxfmt, typescript (manifest: `config/update/pins.json`, one regex capture per target, 30+ `engines` ranges included) |
| tools | `bun run update:tools` (`--apply`) | installed vs pinned vs latest (GitHub, PyPI, npm, crates.io); `--apply` installs the exact version (`uv self update <v>`, bun installer, `rustup toolchain install`, `cargo binstall nu@<v>`) and re-pins |
| cargo | `bun run update:cargo` (`--apply`) | `cargo update --dry-run`, or the lock refresh inside manifest ranges through `cargo-serial.sh`; snapshot in `target/update/` |
| deps | `bun run update:deps`, `aphrody-update deps <sub>` | `plan`, `apply` (Tauri family + `bun update -r`), `facts`, `fix`, `baseline`, `changelog`, `memory`, `inventory`, `run` |
| systemd | `bun run update:systemd`, `aphrody-update systemd install\|restart` | link `config/systemd/user/*` into `~/.config/systemd/user` (differing copies are kept as `*.pre-update-<ts>`), `daemon-reload`, `try-restart` units that run bun or aphrody binaries |
| sources | `bun run sources` (status), `sources:verify`, `sources:sync`, `bun run update:sources` (drift), `aphrody-update sources <sub>` | the one owner of `~/source` checkouts, upstream pins, forks and git state, see below |
| tauri | `aphrody-ops tauri-sync [--check\|--apply]` (also run by `deps plan\|apply`) | the one owner of the Tauri crates, npm packages, mirrors (`packages/ui/scaffold/src/pins.ts`) and `$schema` URLs; honours `minimumReleaseAge`; its Cargo gate goes through `cargo-serial.sh` |
| all | `bun run update:run` | tools, cargo, deps, systemd restart, then the gate |

Everything except `check`, `pins` and `systemd check` is report-only until `--apply`.

## Dependency steps

- `facts [--all]`: GitHub release notes plus Context7 docs for the libraries in `config/deps/watch.json` that changed
  -> `docs/research/workspace/deps/<date>.md`.
- `fix [--apply-fixes]`: runs the consumer gates (tsc, `cargo check`), subtracts `config/deps/baseline.json`, matches
  `config/deps/fix-rules.json`, writes `.coord/shared/deps-fix-<date>.md`. Only `kind: script` rules edit files.
- `inventory`: whole-repo scan (about 45 s, six-hour cache in `target/deps-inventory/cache`) of `Cargo.lock` vs the
  crates.io sparse index, git remotes via `git ls-remote` (any host), `bun.lock` vs npm, Python pins vs PyPI, and one
  OSV.dev batch for advisories -> `docs/reference/workspace/DEPS-INVENTORY.md`.
- `changelog`: `CHANGELOG.md` from conventional commits (`config/changelog.json`) and the journal.
- `memory`: managed block in each `~/.aphrody/workspaces/*/BOOT.md` and `memory/deps-state.md`.

Registries: crates.io, npm, GitHub (token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`), PyPI, Context7
(`https://context7.com/api/v1`, optional `CONTEXT7_API_KEY`), OSV.dev. No Go, Maven or other registry exists in the
repository; add a collector in `src/deps/inventory.ts` when one appears.

## Automation

- `config/systemd/user/aphrody-update.timer` (Mondays 06:00, `Persistent=true`): runs `tools`, `deps facts`, `check`
  and never applies. `aphrody-rust-update.timer` keeps the floating `stable`/`nightly` toolchains and Cargo tools fresh;
  it does not touch the pinned `rust-toolchain.toml` channel, which moves only through `tools --apply`.
- `.github/workflows/update.yml`: weekly report-only run on GitHub Actions.
- `.github/shenron/workflows/update-deps.yml` is a separate Shenron subtree PR workflow (not under `.github/workflows`).

## Rules

- Cargo is never bulk-updated to remove duplicate versions (repo rule). `cargo` refreshes the lock within the manifest
  ranges; majors need the manifest edited and the consumers fixed. The Tauri family is rewritten by `deps apply`.
- uv and bun: the release tag can precede the installer, so `tools --apply` pins what is actually installed.
- `portable-pty` stays on 0.8 (0.9.0 breaks headless Windows clients, see the desktop PTY note).
- Verification stays with the lead through `scripts/build/rust/cargo-serial.sh`; workers never run Cargo.
- `docs/ecosystem/CLI.md` is generated from code; do not edit it by hand.

## Sources, upstreams, forks and git

Manifest: `config/upstream-sources.json` (21 entries: `git` or `crate`, `pinned` or tracked, local patches with a marker
file). The native `aphrody git source` command reads the same manifest, read only. `config/update/forks.json` lists
the forks the repository depends on.

| Command | What it does |
| --- | --- |
| `sources status\|verify\|sync [--apply] [--only <id>]` | restore and inspect checkouts (clone or extract, apply missing patches; never touches an existing checkout's history) |
| `sources drift` | every pin against its remote head, newest tag or crates.io version, plus the Cargo git remotes of `Cargo.lock` (any host through `git ls-remote`) |
| `sources forks` | each fork against its parent (GitHub compare API, or head comparison for detached forks); recorded `upstreamCommit` in `config/bun-fork.json` vs the parent head |
| `sources repo` | local repository: branch, ahead/behind, changed paths, stashes, remotes (also printed by `check`) |
| `sources bump [--only <id>] [--apply]` | move a pinned source to the newest head or version. A scratch clone first proves the patches still apply; a failure writes `.coord/shared/sources-bump-<id>.md` and changes nothing. `--apply` rewrites the manifest, keeps the old checkout as `<id>.pre-bump-<ts>`, restores the new one, and rolls everything back if the result is not `ok`. Then check the Cargo consumers it prints. |
| `sources prune [--apply]` | remove the `*.pre-bump-*` checkouts |

`update run` reports `sources drift` and `forks` (or restores missing checkouts with `--apply`). Bun fork procedure:
[BUN-FORK-OPERATIONS.md](./BUN-FORK-OPERATIONS.md).
