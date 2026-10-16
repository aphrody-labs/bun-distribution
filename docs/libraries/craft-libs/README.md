# Craft App Libraries

The six Craft libraries are maintained as flat, history-preserving Git owners
in the Bun OS root Cargo workspace. This repository retains their source
provenance, shared documentation, attribution and license notices.

| Library          | Canonical owner                                                                        |
| ---------------- | -------------------------------------------------------------------------------------- |
| `craft-atomic`   | [Atomic file writes](https://source.aphrody.app/aphrody-dev/bun-crate-craft-atomic)    |
| `craft-cms`      | [ICC color management](https://source.aphrody.app/aphrody-dev/bun-crate-craft-cms)     |
| `craft-print`    | [System PDF printing](https://source.aphrody.app/aphrody-dev/bun-crate-craft-print)    |
| `craft-quit`     | [Native application quit](https://source.aphrody.app/aphrody-dev/bun-crate-craft-quit) |
| `craft-settings` | [Settings storage](https://source.aphrody.app/aphrody-dev/bun-crate-craft-settings)    |
| `craft-ui`       | [Shared egui controls](https://source.aphrody.app/aphrody-dev/bun-crate-craft-ui)      |

Bun OS owns each `crates/<package-name>` manifest, version, dependency table,
toolchain, build output and qualification command. Use its root workspace
aliases and preserve the consumer's features. Older Git-pinned consumers still
require their own transition; this source retirement does not qualify them.

The nested Cargo workspace, lockfile and standalone workflows are retired.
Use the Bun OS root commands for Cargo metadata and qualification. Shared
[settings](docs/settings-storage.md), [UI audit](docs/ui-components-audit.md),
[theme](docs/theme-infrastructure.md) and [docking](docs/ui-docking.md)
documentation remains available here and in the corresponding crate owners.

## License and credits

Craft code is dual-licensed under [MIT](LICENSE-MIT) or
[Apache-2.0](LICENSE-APACHE), at your option. Copyright (c) 2026 ArtCraft Team
and the craft-libs contributors. Preserve [NOTICE](NOTICE) and
[ATTRIBUTION.md](ATTRIBUTION.md), including the Fogra reference-data terms and
the individual licenses of bundled assets. Repository history remains intact.
