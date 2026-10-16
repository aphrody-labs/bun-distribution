<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri 3 upstream line

Machine-readable source: [`config/tauri-upstream.json`](https://github.com/aphrody-labs/aphrody/blob/main/config/tauri-upstream.json).
Sync command: `bun run tauri:sync` (module `packages/infra/workspace/src/tauri-sync.ts` (not in repo)).

## Which upstream ref is current

`tauri-apps/tauri` branch `v3` is the Tauri 3 line (`crates/shell/tauri` 3.0.0-alpha.3,
tag `tauri-v3.0.0-alpha.3`). Branch `dev` is the 2.x line (`crates/shell/tauri` 2.12.1)
and moves faster; it must not be used for Tauri 3. Stable releases on GitHub are
still `tauri-v2.12.1`. Only released alphas are pinned; nothing is taken from a
git branch, except the local patches listed below.

## Runtime choice

Tauri 3 has no implicit runtime. Every binary calls
`Builder::default().runtime(...)` exactly once.

- Default: `tauri-runtime-wry` (system webview, lowest memory). Used by
  `aphrody-app` and `aphrody-model-view`.
- CEF: `tauri-runtime-cef` is kept only for Koharu (`koharu`, `koharu-app`).
  It is a deliberate exception, not the default.

`tauri::AppHandle` defaults to the type-erased `tauri::DynRuntime`; code that
used `tauri::Wry` as a type now uses `tauri::DynRuntime`.

## Centralized versions

Root `Cargo.toml` `[workspace.dependencies]` is the only place with a Tauri
version; members use `workspace = true` and add only features
(`dynamic-acl`/`specta` for Koharu, `tray-icon`/`image-ico` for `aphrody-app`).
Root `package.json` `workspaces.catalog` holds `@aphrody/api` and
`@aphrody/plugin-opener`; packages use `catalog:`.

| Set                                                                 | Version                           |
| ------------------------------------------------------------------- | --------------------------------- |
| `tauri`, `tauri-runtime-wry`                                        | 3.0.0-alpha.3                     |
| `tauri-build`, `tauri-plugin`, all `tauri-plugin-*`                 | 3.0.0-alpha.2                     |
| `tauri-runtime-cef`                                                 | 3.0.0-alpha.4                     |
| `tauri-specta` (git tag `v2.0.0-rc.25-koharu.1`)                    | 2.0.0-rc.25                       |
| `@aphrody/api` / `@aphrody/plugin-opener` / `@tauri-apps/cli` | 3.0.0-alpha.2 / alpha.1 / alpha.3 |

`plugin-opener` JS stays at alpha.1 while alpha.2 is younger than the repository
`minimumReleaseAge` (3 days, `bunfig.toml`); the sync script reports it as
`too-fresh` and applies it once eligible.

## Running the sync

```sh
bun run tauri:sync              # report: current vs latest, refs, patches
bun run tauri:sync:check        # exit 1 when behind or a patch is broken (CI)
bun run tauri:sync -- --apply   # bump root Cargo.toml + catalog, run the gate
bun run tauri:sync -- --offline # local patch verification only
```

`--apply` edits only the root `Cargo.toml`, root `package.json` and
`config/tauri-upstream.json` (CLI version), then runs `cargo check` on the
Tauri crates and `bun install` / `bun install --frozen-lockfile`. On any
failure it restores those files and both lockfiles. Cargo rewrites tracked
generated schemas (`generated` entries of `config/tauri-apps.json`); review or restore them after a run.
Files listed under `mirrors` in the config (the `TAURI_3` constants of
`packages/scaffold/src/pins.ts`, the single scaffolder) are kept equal to the central versions: drift is reported
(exit 1) and `--apply` rewrites them. The same holds for the `$schema` tag of
every first-party `tauri*.conf.json` listed in `config/tauri-apps.json`. The cargo
gate packages and generated paths are derived from that registry too. It never
commits or pushes.

## Tauri app registry

`config/tauri-apps.json` is the single list of Tauri projects: apps
(`aphrody-app`, `aphrody-model-view`, `koharu`), plugins and libraries, JS
packages, the generators (`scaffold`, `web-to-tauri`, `m3-next-migrate`), the
`aphrody-tauri-wrap` runtime and the upstream-owned fixtures under
`upstream/`. `bun run tauri:apps` scans the whole tree (git-ignored and
workspace-excluded paths included; only `target`, `node_modules`, `.git`, `.turbo`
and `.coord` are skipped) and prints each project with its owner, kind, Cargo
workspace state and git state.

`bun run tauri:apps:check` exits 1 on: an unregistered Tauri project or config
file, a registered path that vanished, a workspace-membership mismatch, a
first-party crate that pins its own `tauri*` version instead of
`workspace = true`, a first-party npm package that pins `@tauri-apps/*` instead of
`catalog:`, a `$schema` tag different from the pinned Tauri version, and a config
that still points at the legacy sibling checkouts (`../aphrody-ui`, ...).
`bun run tauri:apps:fix` rewrites drifted `$schema` tags. Register a new Tauri
project in the registry in the same change that adds it.

## Carried patches

| Id                                   | What                                                                                                                                                                                                                                                                                    | Exit condition                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `tauri-plugin-dialog-manager-import` | `.cache/upstream/tauri-plugin-dialog` is crates.io 3.0.0-alpha.2 plus `use ...Manager` (`patches/tauri-plugin-dialog-3.0.0-alpha.2.patch`), wired by `[patch.crates-io]`. alpha.3 of `tauri` moved `run_on_main_thread` to `Manager`; the published dialog plugin does not compile against it. | A published dialog release imports `Manager`; the script detects it. |
| `tauri-specta-tauri3`                | `koharu-rs/tauri-specta` tag `v2.0.0-rc.25-koharu.1`: one commit allowing `tauri >= 3.0.0-alpha.0`.                                                                                                                                                                                     | Upstream `specta-rs/tauri-specta` accepts Tauri 3.                   |

Retired (verified 2026-10-01): `aphrody-code/tauri` rev `89499afc` (only change:
`no_redirection_bitmap`, already in Tauri 3 `tauri-runtime-wry`) and
`aphrody-code/plugins-workspace` rev `5baf71a4` (identical to upstream `v2`,
no local change).

## Tauri 3 changes applied to `aphrody-app`

- `tauri::Wry` becomes `tauri::DynRuntime`; the runtime is set with
  `.runtime(tauri_runtime_wry::Wry::default())`.
- `tauri-plugin-autostart`: `ManagerExt::autolaunch` is now `autostart`.
- `tauri-plugin-fs`: `fs:allow-read-text-file` was removed; use
  `fs:allow-read-file`.
- `tauri.conf.json`: `macOSPrivateApi` must match the `macos-private-api`
  feature enabled by the workspace dependency.
