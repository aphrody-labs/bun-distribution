# Drive xtask

`xtask` automates the Drive engine's Cargo workspace, kept separate for its FSL dependency and
provenance boundary; Drive itself is the integrated Files feature of Aphrody. The optional HTTP
adapter in `drive/apps/web` serves the same `@aphrody/app-ui` as Tauri. React Native, iOS and
Android commands were removed.

From `drive/`:

```sh
cargo xtask setup
cargo xtask test-core
cargo xtask bump <version>
cargo xtask update-contributors
```

`setup` downloads native desktop dependencies, writes `.cargo/config.toml`, and builds the release
daemon for the historical Drive Tauri host. For the Aphrody desktop, the supported build and
packaging entry points are `bun run desktop:<check|build|run|dev|bundle>` at the
repository root. They build `sd-daemon` from this workspace and stage it as an Aphrody Tauri
sidecar. See `docs/design/SPACEUI-SPACEDRIVE-MIGRATION.md` for ownership and migration gates.
