<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun layer of aphrody-compat

> Path reconciliation (2026-10-07): `crates/compat/n2b-native` (not in repo) → `crates/interop/ffi/src/n2b_native.rs`. Original dated observations below retain their historical scope.

This page maps every part of `aphrody-compat` that runs on Bun, provides Bun, or documents Bun,
and states the rules they follow.

## Map

| Layer | Where | Role |
| --- | --- | --- |
| Runtime | system `bun`, pinned by root `package.json` `packageManager` (and `mise.toml`) | The only JS runtime and package manager. The upstream source is the optional `third_party/bun` submodule, recorded in `third_party/runtime-sources.toml`. |
| Workspace | root `package.json` `workspaces`, `bun.lock`, `turbo.json` | One install and lockfile for `packages/*`. Shared versions live in the root `workspaces.catalog`. |
| Native FFI | `../crates/ui/bun` (cdylib `bun_rs`) and UI `@aphrody/bun` | Rust hot paths loaded through `bun:ffi`: M3 color and schemes, Sass (grass), spec validation, M3 CSS, icons, 3D rendering. The UI repository owns and consumes this library. |
| Runtime access | `crates/compat/toolchains` | Resolve installed Bun, repository version pins and launch environment without a shell. Compat owns this crate and OS consumes it; the Bun source submodule supplies documentation, not a linked runtime library. See [BUN-RUST-INTEGRATION.md](./BUN-RUST-INTEGRATION.md). |
| Node to Bun | `crates/aphrody-n2b*`, `@aphrody/n2b-*` | Scanner, rule registry, codemods and reports. The core TypeScript package wraps the CLI; the build plugin prefers the fork's native scanner and falls back to the CLI. Knowledge base in [n2b/README.md](../../products/compat/n2b/README.md). |
| N2B native scan | `crates/interop/ffi/src/n2b_native.rs` | ABI v2 keeps the read-only `node2bun_scan_json` and adds `node2bun_scan_with_options_json` for `mode`, `ignore` and `dry_run`; callers release reports with `node2bun_string_free`. Fix and aggressive modes can write project files. The Aphrody Bun fork's `bun:aphrody` module binds the library through `bun:ffi`. |
| Documentation | `crates/compat/bun-docs` (`bun_docs` kernel subsystem, registered by `../aphrody-os`) | Offline `bun_docs_search`, `bun_docs_read`, `bun_docs_list` and `bun_node_equivalent` over `third_party/bun/docs` (or `APHRODY_BUN_DOCS`) and the n2b registry. |

The repository-wide ownership and target integration plan are in [Infra's Bun platform map](../infra/APHRODY-BUN-PLATFORM.md).
The exact crate, package, schema and CLI inventory is in [N2B's Bun surface](./n2b/BUN-SURFACE.md).

## Rules for the manifests in `packages/*`

1. Only the root declares `packageManager`.
2. `engines.bun` equals the root minimum derived from `packageManager`.
3. No `engines.node`.
4. A dependency listed in the root catalog uses `catalog:`. Add a new shared dependency to the
   catalog first.
5. Scripts use `bun`, `bunx`, `cargo` or direct binaries. They never use `npm`, `npx`, `pnpm`,
   `yarn` or `node`.
6. A package with a `tsconfig.json` exposes `typecheck` and extends `tsconfig.base.json`. A
   package referenced through TypeScript project references (`n2b-types`, `n2b-client`, `n2b-shims`)
   also exposes `build` (`tsc -b`), so turbo emits its declarations before dependents typecheck.
7. A `test` script that needs a native artifact builds it first:
   `@aphrody/n2b-core` builds the debug `n2b` binary. Test builds do not pass
   `--locked` (see the CI note in the root README).

## Gates

```sh
bun install --frozen-lockfile
bun run typecheck      # turbo, every @aphrody/* package
bun run lint           # oxlint (.oxlintrc.json)
bun run test           # turbo; builds the native artifacts it needs
```

## Upgrading Bun

1. Update the `third_party/bun` submodule and the version in `third_party/runtime-sources.toml`.
2. Set the root `packageManager`, the `mise.toml` pin and the `@types/bun` catalog entry.
3. Refresh the vendored docs used by n2b: `bun run docs:bun:update -- --ref <branch-or-tag>`.
4. Run `bun install`, then the gates above and the Rust gates in the root README.

The `bun_docs` tools read the docs straight from the submodule (or `APHRODY_BUN_DOCS`). There is
no index to rebuild.
