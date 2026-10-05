# Contributing to Aphrody Drive

This tree contains the Spacedrive V2 daemon, typed client and file explorer adopted by Aphrody OS.
Keep upstream provenance and the FSL-1.1-ALv2 notices intact. See [AGENTS.md](../../reference/drive/AGENTS.md) for
backend and type generation rules, and [the Aphrody migration plan](../../architecture/design/SPACEUI-SPACEDRIVE-MIGRATION.md)
for the current ownership and parity gates.

## Product targets

Drive is Aphrody's Files feature, not a separate product shell. The active UI lives in
`../packages/app-ui`; Tauri (`../crates/aphrody-app`) is the current desktop host. Optional HTTP
delivery reuses that same UI. The React Native, Expo, iOS and Android app and the old
`drive/apps/tauri` host were removed. Do not add another desktop bridge or copy daemon types into
TypeScript by hand.

## Setup and build

Run commands from the repository root unless a command specifies the Drive Cargo manifest.

```sh
bun install --frozen-lockfile
bun run bun:check
cargo metadata --manifest-path drive/Cargo.toml --no-deps --locked --format-version 1
cargo build --manifest-path drive/Cargo.toml -p sd-core --bin sd-daemon --locked
```

On Windows, `pwsh scripts/tauri.ps1 -Action dev|run|bundle` builds the Aphrody UI, prepares the
Drive engine and starts or packages the native app. On Linux, use
`bash scripts/tauri.sh dev|run|bundle`. Optional HTTP delivery reuses `@aphrody/app-ui` and
requires `sd-server` for its `/rpc` and `/events` endpoints.

The daemon's separate Cargo workspace is a dependency and FSL provenance boundary, not a separate
product: `crates/aphrody-drive` is the only native bridge used by Aphrody's Files surface. Library
migrations, index state and user files belong to the daemon; do not delete or relocate them as
part of an interface change.

## Making changes

1. Keep Rust operations and persisted data rules in `drive/core`. Regenerate the Specta client
   after changing public types; avoid handwritten duplicates.
2. Put shared controls and the Files UI in `../packages/m3-*` and `../packages/app-ui`. Keep
   `SdPath`, daemon operations, generated client types and file actions in `drive/core`,
   `drive/packages/ts-client` and `crates/aphrody-drive`. `drive/packages/interface` is an excluded
   FSL reference mirror, not an active application package.
3. Implement desktop capabilities through `crates/aphrody-drive` and its explicit Tauri permissions.
   The Web client receives an HTTP adapter without native filesystem authority.
4. Preserve the behavior of existing libraries and volumes, including historical cloud volumes.
   New cloud connections in the UI are limited to S3-compatible storage.
5. Record any incomplete parity in the migration plan with the runtime observation needed to close it.

Scope formatting and checks to the touched crates and packages. A successful TypeScript check does
not prove daemon responses, file operations or a packaged executable. Check the corresponding Rust
crate, build the Aphrody UI, then launch the actual desktop/Web path for the affected flow.
