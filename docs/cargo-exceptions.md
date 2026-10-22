# Cargo exceptions

`docs/cargo-exceptions.json` is the ledger of tracked nested Cargo `[workspace]`
manifests and `Cargo.lock` files outside the root, `vendor/` and `toolchains/`.
`bun src/cli.ts workspace check` fails when a nested Bun lockfile exists, when
a nested workspace or Cargo lock is not listed, or when a ledger entry no
longer matches a tracked file.

Classes: `fixture` and `fuzz` (must build separately), `example` (standalone
samples and templates), `vendored` (locks inside vendored third-party copies)
and `migrate` (product members that must join the root workspace and lock; the
exception is temporary). Each entry carries a one-line reason. Remove an entry
in the same commit that removes the file.

`bun src/cli.ts workspace inventory --out docs/generated/component-inventory.json`
regenerates the component inventory with stable key order and no revision or
timestamp.
