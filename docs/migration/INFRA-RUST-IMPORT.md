# Infra Rust source staging

2026-09-29. Seven first-party crates were copied without caches or nested Git
metadata into the new Aphrody Cargo workspace:

- Six Infra crates (61 tracked files) from transitional
  `src/aphrody-infra/crates/` at commit
  `903dd9ae3162c2de404e4dc5a659fa5fd0b92f0b` now live under
  `crates/infra/`.
- `aphrody-kernel-client` (3 tracked files), required by `aphrody-yolo`, came
  from `src/aphrody-contracts` at commit
  `4a22afb12b086573e6890e49a3bfbde7a96380ea` and now lives under
  `crates/contracts/`.

The source crate worktrees were clean. The new root manifest preserves their
package versions, centralizes their external dependencies, and rewrites the
one sibling path dependency to the new contracts crate. The imported Rust
sources were formatted to the new workspace policy; path-based tests were
adjusted for the deeper `crates/infra/` layout. The source repositories remain
intact for rollback.

Measured gates: offline locked `cargo check -p aphrody-infra --all-targets`,
locked offline Clippy with `-D warnings`, and `cargo fmt --all --check` pass.
The new Bun Infra bridge resolves this Cargo root and its `infra --help`
command invokes the new `aphrody-infra` binary. Twelve Bun package tests pass.

The Infra catalog staging now covers 72 clean tracked files: 29 `config/`,
3 `inventory/`, 39 `systemd/`, and `rust-toolchain.toml`. The
[`infra-config-import.json`](infra-config-import.json) report records each
source and target SHA-256, explicit remaps and endpoint classes. The importer
refuses dirty source catalogs or target conflicts; a second run found all 72
targets identical. `config/pipeline.json` points temporarily to `../src`, and
`config/google-stack-release.json` points its AI and Web source repositories
to `../src/aphrody-ai` and `../src/aphrody-web`. Runtime endpoint values were
preserved. The scan counted 73 loopback, 61 unverified FQDN, and one compound
host alias occurrence; the latter two classes still need owner review before
production cutover. Nine copied inventory/systemd files still contain
source-checkout references; deployed unit paths require a coordinated
script/release cutover.

The six clean tracked Infra scripts referenced by those units are staged under
categorized `scripts/` paths. Their [import report](infra-scripts-import.json)
records the source HEAD and byte hashes; a second run found all six identical.
The configuration report identifies 18 source-checkout path references by file
and line: ten now point to staged files, while eight refer to the old checkout
root. The copied scripts still use their source-relative defaults and have not
been qualified for execution at the new paths; the deployed units still name
the old paths.

Against the new root, `aphrody-infra validate` passes (23 services, 25 routes),
`service catalog --json` succeeds, and `dev-env --local wsl` completes. The
locked offline Rust library suite passes all 52 tests. Its Git overview test
now creates a temporary repository with one commit, so it verifies branch and
history behavior independently of the target repository's commit state.
Scoped Clippy with `-D warnings` passes after that change.
`pipeline --stage check --json` finds 12 errors across 85 steps: the configured
workspace root misses the sibling IECODE checkout, and NIE does not declare
the four Bun scripts requested by the current pipeline. This remains a staged
import. Keep the transitional source until consumer and release paths, pipeline
checks and clean-clone qualification pass.
