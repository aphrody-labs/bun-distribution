<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust crate maintenance

## Current interfaces

The Rust Infra CLI exposes bounded Cargo maintenance for repositories in its
repository catalogue:

```bash
aphrody-infra maintenance --help
aphrody-infra maintenance scan --json
aphrody-infra maintenance scan --repo <catalogued-repo> --json
aphrody-infra maintenance update --repo <catalogued-repo> --json
aphrody-infra maintenance update --repo <catalogued-repo> --apply --json
```

`update`, `fix` and `clean` require a selected catalogued repository; mutations
also require `--apply`. Run the checkout CLI through
`scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- maintenance ...`
to use the shared Cargo lock. Check `--help` and the target owner's current
gates before applying a change.

For the cross-repository dependency/source inventory, the current Nushell entry
point is `nu scripts/tools/workspace/scan-ui-crates.nu --skip-ui`. It avoids reading the
separately owned `aphrody-ui` checkout. Review its report as candidates; a
repeated lockfile version or identical source file alone does not prove a safe
consolidation.

## Retired Bun CLI and aliases

`scripts/tools/workspace/maintain-crates.ts` is not currently runnable from this monorepo
layout: its workspace resolver requires sibling directories named
`aphrody-infra/` and `aphrody-shell/`, which are absent here. The former
`bun run crates:build`, `bun run crates:scan`, `bun run crates:update`,
`bun run crates:fix`, `bun run crates:clean` and `bun run crates:dispatch`
aliases are not declared in the current root `package.json`. Do not use the
old standalone build, dispatch or sibling-repository examples below this
heading as current instructions; use the Rust CLI or Nushell entry point above.

The old scanner implementation remains in the repository for migration
reference. Its registry checks, YOLO dispatch, external Cargo tools and
ignored `target/aphrody-crates-mrx/` (not in repo) reports have not been requalified against
the current workspace layout.

References: [Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html),
[Cargo update](https://doc.rust-lang.org/cargo/commands/cargo-update.html),
[Cargo clean](https://doc.rust-lang.org/cargo/commands/cargo-clean.html),
[Cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html),
[crates.io version API](https://github.com/rust-lang/crates.io/blob/main/src/controllers/version/metadata.rs),
[cargo-machete false positives](https://github.com/bnjbvr/cargo-machete#false-positives).
