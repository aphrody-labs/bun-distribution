<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Drive vs upstream Spacedrive

`apps/aphrody-drive/` is the preserved Spacedrive daemon workspace from
[spacedriveapp/spacedrive](https://github.com/spacedriveapp/spacedrive).
Integration ownership: [`design/SPACEUI-SPACEDRIVE-MIGRATION.md`](../architecture/design/SPACEUI-SPACEDRIVE-MIGRATION.md).

## Imported revision

`60369e9f00b5abe07f4518626bf36f6a7453476f` ("feat: redundancy awareness & cross-volume file
comparison (#3053)"), identified by blob identity of `core/src/lib.rs` and
`core/src/library/mod.rs`. To re-audit: compare `git ls-tree -r` of that commit with
`git ls-files drive/`, check absent paths with `git check-ignore --no-index`, and diff every
shared `*.rs` / `*.toml` / `build.rs` whose blob hash differs.

## Regression found and restored

| Path | Cause | Action |
| --- | --- | --- |
| `core/src/data/{mod,manager}.rs` | Bare `data` pattern in `drive/.gitignore` swallowed `core/src/data/`; `lib.rs` declares `pub mod data` and `library/mod.rs` uses `data::manager::SourceManager`, so `sd-core` failed with E0583. | Restored verbatim from upstream. |
| `core/src/testing/{mod,integration_utils,runner}.rs` | Never committed (same import); `lib.rs` declares `pub mod testing` (public upstream too, used by integration tests). | Restored verbatim from upstream. |
| `drive/.gitignore` | `data` matched any directory named `data`. | Anchored to `/data` (the root runtime data directory it was meant for). |

No other ignore rule matches an upstream-tracked path after the fix.

## Baseline upstream parity audit (2026-09-28)

The [upstream tree at `6dfeccf`](https://github.com/spacedriveapp/spacedrive/tree/6dfeccf2113039e35f2ce735f945e70dc3e4ea45)
has 3,468 tree entries. This is a source comparison against the current upstream revision,
separate from the imported `60369e9` baseline above. It does not prove that an Aphrody route,
daemon action or installed app behaves identically.
Reproduce file-level Git blob presence and changes with
`bun run drive:upstream:audit`; the script accepts a pinned
`--revision`, `--drive-root`, `--owner`, `--list` and `--json`, and rejects truncated GitHub trees. Use
`--owner os/drive-engine --fail-on-missing` to gate the native core source inventory. Its owner groups
are source placement categories, not evidence of runtime parity.

| Area | Source comparison | Functional disposition |
| --- | --- | --- |
| Core operations and adapters | At the initial audit, all 476 `core/src/ops/**` and 33 `adapters/**` files were present; 475 operations files and all adapters were byte-identical. Search filters now also differ to support exact content kinds and shared-volume comparison in both retained and OS copies. | Preserve VDFS, search, indexing, cloud volumes, sync, redundancy, sidecars and operation names through the OS migration. Runtime parity remains open. |
| Rust crates and docs | All upstream crate and documentation paths are present. Eleven crate files and six core service/configuration files differ. | Review changed semantics and build features rather than equating path presence with parity. |
| UI | The audit found missing Overview, Redundancy, File Kinds, Jobs, Daemon and Spacebot routes. `/file-kinds` and `/redundancy` were still produced by navigation; `/jobs` redirected to Explorer despite an existing screen. The three missing Spacebot pages in upstream's interface are placeholders, not working features. | File Kinds, Jobs and Redundancy routes now use live backend hooks; installed-host behavior is unqualified. Overview remains open; OS/AI ownership needs separate integration evidence. See [route audit](../architecture/design/DRIVE-ROUTE-PARITY.md). |
| CLI | `apps/cli/src/domains/logs/{args.rs,mod.rs}` were absent although `sd-cli` imports and dispatches `LogsCmd`. | Restored the two files from imported revision `60369e9`; their Git blob hashes match upstream. `cargo check -p sd-cli --bin sd-cli` passed. |
| Mobile | 156 `apps/mobile/**` source files are absent from the Aphrody UI tree. | No Android/iOS Files host is qualified; retain this as a real delivery gap under the [M3 host plan](../plans/design/M3-MULTI-HOST-PLAN.md). |
| Server | Four upstream `docs/architecture/ui/drive/apps/server` Docker/TrueNAS deployment files and root `build-server.sh` are absent from the UI tree; `sd-server` source is staged in `aphrody-web/drive-server` with the deployment recipes. | `aphrody-web/crates/aphrody-site` owns the HTTP origin and optional Drive gateway. Qualify Drive HTTP routes, auth, SSE, sidecars and offline UI assets before retiring the old binary. |
| Assets | Of 676 upstream `packages/assets/**` files, 674 paths exist under root `packages/assets/**`; 658 are byte-identical. | Preserve license and check the 16 divergent files by behavior and content. README and old generator are tooling, not runtime assets. |
| Desktop | Upstream `apps/tauri/**` is replaced by `crates/ui/app` and `crates/ui/drive`. | Verify installed Files workflows; matching source paths are not expected. |

The [SpaceUI upstream revision](https://github.com/spacedriveapp/spaceui/tree/a48b170)
matches `packages/aphrody-spaceui/UPSTREAM.txt`. The four Explorer components exported by its
source are present in `@aphrody/m3-explorer`; the larger component inventory in its README is
not backed by that package's exports. The M3 AI cards retain raw event fallback but no longer
specialize 15 browser/command tools, in line with the public webview scope. Their detailed
execution history belongs to AI and OS clients outside this webview. M3 `TabBar` and
`ShinyToggle` now provide arrow, Home and End navigation with roving keyboard focus to
match their ARIA composite roles.

The upstream SpaceUI README describes memory, cron and autonomy components that are absent
from its actual [`packages/ai/src` (not in repo) source](https://github.com/spacedriveapp/spaceui/tree/a48b17047d3ff1d05268acb6f88a79460ad4fa7b/packages/ai/src);
these descriptions are not evidence of a lost implementation. Likewise, Spacedrive's
[`Memories`, `Autonomy` and `Schedule` routes](https://github.com/spacedriveapp/spacedrive/tree/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/packages/interface/src/Spacebot/routes)
are placeholder pages. The separate [Spacebot runtime](https://github.com/spacedriveapp/spacebot)
is a distinct AI integration target, not a reason to restore placeholder webviews.

AI quality gap inherited from upstream: `drive/crates/archive/src/safety.rs` returns an
always-safe result with score zero, while `engine.rs` logs that Prompt Guard 2 loaded.
The source is upstream-identical here. Neither Spacedrive nor Aphrody has demonstrated
active archive screening through this code path; do not advertise prompt-injection
quarantine until a real model, failure path and index-time enforcement are qualified.

## Differences kept on purpose

| Area | Upstream | Aphrody | Rationale |
| --- | --- | --- | --- |
| `apps/tauri`, `apps/mobile`, `xtask` iOS/Android/mobile commands, `mobile` Cargo feature, `profile.mobile-dev` | Present | Desktop bridge is integrated; upstream mobile flows still need reconciliation in the unified Bun Android host. | The old Spacedrive host was replaced by `apps/aphrody-app` and `crates/aphrody-drive`. Mobile remains in scope; preserve its source and qualify feature mapping before retiring it. |
| `packages/assets` (not in repo) | In `drive/` | Moved to repository `packages/assets` (not in repo) (with `LICENSE.spacedrive`) | Consolidated vendor assets (commit `b4d69a4`); tsconfigs point there. |
| `apps/web` (not in repo) Vite files, `packages/ts-client` (not in repo) Jest files, `bun.lockb`, `.nvmrc`, `.eslintignore` | Vite / Jest / old lockfile | Bun build and `bun test`, repository-level `bun.lock` | Bun-native toolchain. |
| `packages/interface/src/Spacebot/routes/{Memories,Autonomy,Schedule}Route.tsx` | Routed | Dropped with their router entries; "coming soon" placeholders redirect to `/explorer` | No placeholder UI. |
| `.github`, `.vscode`, `.zed`, `docs/architecture/ui/drive/apps/server` Docker/TrueNAS scripts, `build-server.sh`, `test_extension.wasm` | Present | Removed | Repository-level CI and infra (`aphrody-infra`) own these; binary artifact not vendored. |
| Root `Cargo.toml` `[patch.crates-io]` | None | `ffmpeg-sys-next`, `whisper-rs-sys` local patches | bindgen 0.72 for libclang 21+ (see `drive/patches/README.md`). |
| `docs/architecture/ui/drive/apps/server` | Base server | Adds `data_dir`, library lookup, `tokio` `fs`, `tokio-util`, `uuid` | Aphrody feature additions. |
| `core/src/library/lock.rs` | `ps` / `tasklist` subprocess | `sysinfo` single-PID refresh | Locale-independent, no subprocess. |
| `core/src/ops/core/status/query.rs` | Hard-coded `running: true` | Real watcher/network state | Replaces upstream TODO. |
| `core/src/service/sync/{backfill,state}.rs`, `infra/sync/checkpoints.rs` | No-op checkpoint `save`/`load` | Durable `BackfillCheckpointStore` in `sync.db` + restart test | Replaces upstream TODO. |
| `core/build.rs` | `cargo:warning` when Swift client absent | `rerun-if-changed` | Swift client not vendored; avoids warning noise. |
| `crates/archive/*`, `crates/os/drive/crates/task-system/src/system.rs` | Unused imports/bindings; `fetch_update` | Removed; `try_update` | Warning-clean under current toolchain. |

## Latest source recovery (2026-10-20)

The upstream repository was cloned to a separate reference checkout and audited at
[`4d41a379`](https://github.com/spacedriveapp/spacedrive/commit/4d41a379f612e23ac43a66ffd67df52ca77f57d4),
the 2026-10-13 main revision. The audit covers 3,107 file blobs. Its 287-file
`packages/interface` tree is restored byte-for-byte at
[`docs/material/m3/reference/drive/packages/interface`](./drive/packages/interface), with the
upstream `LICENSE`, `NOTICE`, and revision metadata. That package declares Apache-2.0; the daemon
workspace retains its own FSL-1.1-ALv2 terms. The reference package is below `docs/` and is not
in either build workspace.

The product already connects its active Files surface across `packages/app-ui`, the reusable
`@aphrody/m3-explorer` package, `@aphrody/drive-client`, `crates/aphrody-drive`, and the
separately supervised `sd-daemon` under `apps/aphrody-drive`. The latest audit confirms the
restored interface source is exact; it does not establish route, operation, daemon startup,
installation, or data-migration parity.

At that revision, the path audit finds 525 identical, 407 changed, and 320 absent files across
the mapped Drive engine and adapters. The four-file delta for the client is one identical, 35
changed, and four absent. Upstream's 155 mobile-host files have no counterpart at the mapped
`apps/aphrody-drive/apps/mobile` path; qualify the existing Bun OS Android product against those
flows before treating that as a user-visible loss. The upstream desktop host is intentionally
replaced by the Bun OS host. These are source-path counts, not feature or behavioral scores.
Reproduce with `bun packages/bun-workspace/src/automation/drive-upstream-audit.ts --revision
4d41a379f612e23ac43a66ffd67df52ca77f57d4 --root . --drive-root apps/aphrody-drive`.
