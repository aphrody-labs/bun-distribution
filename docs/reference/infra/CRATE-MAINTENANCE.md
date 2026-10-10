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

The former Bun scanner `scripts/tools/workspace/maintain-crates.ts` (not in repo) was removed
on 2026-10-05: its workspace resolver required sibling `aphrody-infra/` and `aphrody-shell/`
checkouts that this monorepo layout does not have, and `aphrody-infra maintenance` covers its
scan, update, fix and clean modes. The former `bun run crates:build`, `bun run crates:scan`,
`bun run crates:update`, `bun run crates:fix`, `bun run crates:clean` and
`bun run crates:dispatch` aliases are not declared in the root `package.json`; use the Rust CLI
or the Nushell entry point above. The old implementation remains in the git history.

References: [Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html),
[Cargo update](https://doc.rust-lang.org/cargo/commands/cargo-update.html),
[Cargo clean](https://doc.rust-lang.org/cargo/commands/cargo-clean.html),
[Cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html),
[crates.io version API](https://github.com/rust-lang/crates.io/blob/main/src/controllers/version/metadata.rs),
[cargo-machete false positives](https://github.com/bnjbvr/cargo-machete#false-positives).
