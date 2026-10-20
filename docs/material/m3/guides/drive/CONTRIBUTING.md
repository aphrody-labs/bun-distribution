# Contributing to Aphrody Drive

This tree contains the Spacedrive V2 daemon, typed client and file explorer adopted by Aphrody OS.
Keep upstream provenance and the FSL-1.1-ALv2 notices intact. See [AGENTS.md](../../reference/drive/AGENTS.md) for
backend and type generation rules, and [the Aphrody migration plan](../../architecture/design/SPACEUI-SPACEDRIVE-MIGRATION.md)
for the current ownership and parity gates.

## Product targets

Drive is Aphrody's Files feature, not a separate product shell. The active UI lives in
`packages/app-ui`; the shared M3 controls are in `packages/m3-explorer`, and the active contract
client is `packages/drive-client`. The desktop Drive bridge is `crates/aphrody-drive`, which
supervises the `sd-daemon` from `apps/aphrody-drive/core`. Upstream's mobile host is preserved in
the recovered source history; its Files workflows still need integration and qualification in
the unified Bun Android product. Do not add another desktop bridge or copy daemon types into
TypeScript by hand.

## Setup and build

Run commands from the repository root unless a command specifies the Drive Cargo manifest.

```sh
bun install --frozen-lockfile
bun run bun:check
bun scripts/aphrody/build/rust/cargo-serial.ts metadata --manifest-path apps/aphrody-drive/core/Cargo.toml --no-deps --locked --format-version 1
bun scripts/aphrody/build/rust/cargo-serial.ts build --manifest-path apps/aphrody-drive/core/Cargo.toml -p sd-core --bin sd-daemon --locked
```

`packages/app-ui` and `apps/aphrody-drive/core` are separately owned build inputs. The current
checkout does not yet have a verified unified desktop command that builds the daemon, stages its
target-suffixed Tauri sidecar, and packages the same Files UI on Windows and Linux. Keep daemon
installation and launch qualification open until that end-to-end path is wired and run. WebOS
uses the shared App UI through its own host adapter.

The daemon's separate Cargo workspace is a dependency and FSL provenance boundary, not a separate
product: `crates/aphrody-drive` is the only native bridge used by Aphrody's Files surface. Library
migrations, index state and user files belong to the daemon; do not delete or relocate them as
part of an interface change.

## Making changes

1. Keep Rust operations and persisted data rules in `apps/aphrody-drive/core`. Regenerate the Specta client
   after changing public types; avoid handwritten duplicates.
2. Put shared controls and the Files UI in `packages/m3-*` and `packages/app-ui`. Keep
   `SdPath`, daemon operations, generated client types and file actions in `apps/aphrody-drive/core`,
   `packages/drive-client` and `crates/aphrody-drive`. The recovered upstream interface source is
   in `docs/material/m3/reference/drive/packages/interface`, below the docs tree and outside the
   active build graph.
3. Implement desktop capabilities through `crates/aphrody-drive` and its explicit Tauri permissions.
   The Web client receives an HTTP adapter without native filesystem authority.
4. Preserve the behavior of existing libraries and volumes, including historical cloud volumes.
   New cloud connections in the UI are limited to S3-compatible storage.
5. Record any incomplete parity in the migration plan with the runtime observation needed to close it.

Scope formatting and checks to the touched crates and packages. A successful TypeScript check does
not prove daemon responses, file operations or a packaged executable. Check the corresponding Rust
crate, build the Aphrody UI, then launch the actual desktop/Web path for the affected flow.
