<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust crate maintenance

The Rust CLI is the standard maintenance surface; the Bun script remains for advanced deep scans and YOLO dispatch:

| Command | Purpose | Typical cost |
| --- | --- | --- |
| `aphrody-infra maintenance scan --json` | Non-mutating Cargo metadata and lockfile presence across catalogued workspaces | No compilation or registry requests |
| `bun scripts/maintain-crates.ts scan --repo aphrody-infra --deep --json` | Unused dependency candidates, cached advisories, compatible update preview | One repository; no compilation |
| `nu scripts/scan-ui-crates.nu --skip-ui` | Cross-repository path/Git dependencies, copied source and exact hashes | Full source walk; no compilation |
| `bun scripts/maintain-crates.ts scan --repo aphrody-infra --registry serde@1.0.0 --json` | Confirm one exact crates.io release and yanked flag | One HTTP request |

`bun run crates:build` creates `target/aphrody-crates`, a standalone Linux Bun
executable. It embeds the Bun runtime and this script, but still calls the
installed Cargo, Git and Nu programs. The binary finds the workspace from its
current directory or accepts `--workspace-root /home/aphro/src`, so it also
works when installed outside the source checkout. The build disables automatic
`.env` and `bunfig.toml` loading. Bun's `llms.txt` index and executable guide
document these runtime and compilation boundaries.
The fast JSON scan includes a SHA-256 of each `Cargo.lock` for change detection.

Use `--online` with a deep scan to refresh the RustSec advisory database and
the Cargo index. Offline deep scans use the cached database; if absent, the
result says `advisory-db-unavailable`. The registry probe reports `unknown`
on a network or API error; it never treats that as an unpublished crate.

For a selected clean repository, `update`, `fix`, and `clean` are separate
operations. `update` previews compatible lockfile changes with Cargo's
`--dry-run`; `--apply` writes the lockfile and checks dependency resolution.
`fix` previews the exact command, then runs `cargo fix` with `--apply`.
`clean` uses `cargo clean --workspace --dry-run` until `--apply` is given and
refuses an external target directory. The script will not run Cargo against
repositories with manifest path references to UI. It does not call
`cargo-machete --fix`: its source scanner can produce false positives for
generated code, renamed crates, and macros.

The lockfile's repeated version count is a triage signal. Check the active
target graph with `cargo tree -d` before changing features or versions.
After applying updates or source fixes, run the owning repository's compile,
lint, and test gates. A published version and a successful resolution do not
establish API or behavior compatibility.

`scan --full` calls the existing Nu scanner with `--skip-ui` and returns its
headline counts in JSON. `dispatch --repo aphrody-infra` previews the native
`aphrody-yolo` commands. With `--apply`, it builds the Rust CLI when needed using
the global Cargo cache, runs YOLO `plan`, `check`, file `detect` and a mission
dry run, writes an MRX map beneath Infra's ignored `target/`, and runs one
sequential YOLO tick. Up to three missions cover Cargo manifests, Rust source
and Bun/Nushell maintenance tooling when those paths exist, followed by YOLO's
auditor lane. The script
requires clean Git state and ignored YOLO coordination paths before dispatch.
Agent stdout and stderr go to ignored files beneath `target/aphrody-crates-mrx/`.
The first native build and any agent work take longer than the fast scan.
Infra's full workflow stages include UI. Each mission names the selected
repository and requests its relevant owner gates. YOLO does not automatically
run `verify`; a successful tick must be checked against the agent evidence.
`--root` is a working directory and prompt scope, not a filesystem sandbox.
When a kernel is running, YOLO's `shell` command reaches Shell's Nushell and
the OS utility services through the authenticated kernel client. OS also owns
SQLite FTS5 path metadata search; YOLO's `fs` command is only a plain-text
path list and does not search file contents. The maintenance scan uses the
host-installed `rg` or Nu tooling when kernel services are unavailable.

The [Turborepo crates](https://github.com/vercel/turborepo/tree/main/crates)
were reviewed as an architecture reference. Its
[Cargo lockfile logic](https://github.com/vercel/turborepo/blob/main/crates/turborepo-lockfiles/src/cargo.rs)
uses dependency closures for precise task cache keys. The relevant Turborepo
crates are internal workspace/path packages rather than usable registry releases;
their agent crate detects an agent but does not dispatch one. Aphrody keeps Cargo
as resolver and its native YOLO runtime as dispatcher, without copying these crates.

References: [Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html),
[Cargo update](https://doc.rust-lang.org/cargo/commands/cargo-update.html),
[Cargo clean](https://doc.rust-lang.org/cargo/commands/cargo-clean.html),
[Cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html),
[crates.io version API](https://github.com/rust-lang/crates.io/blob/main/src/controllers/version/metadata.rs),
[cargo-machete false positives](https://github.com/bnjbvr/cargo-machete#false-positives).
For the compiled CLI, see [Bun `llms.txt`](https://bun.com/llms.txt),
[Bun native APIs](https://bun.com/docs/runtime/bun-apis),
[Bun executables](https://bun.com/docs/bundler/executables),
[Bun child processes](https://bun.com/docs/runtime/child-process) and
[Bun TOML](https://bun.com/docs/runtime/toml).
