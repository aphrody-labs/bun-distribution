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

## State on 2026-10-22

The ledger lists 22 nested workspaces (5 `migrate`, 6 `example`, 3 `fixture`, 8 `fuzz`) and
21 nested lockfiles (8 `migrate`, 4 `example`, 6 `vendored`, 2 `fixture`, 1 `fuzz`);
`workspace check` reports 0 violations and 13 pending migration paths. Fifteen further
standalone workspaces (fuzz, fixture, example, bevy test and mobile) were added to the root `exclude` list in `9250e43294`
so that Cargo does not walk them; those that are nested workspaces stay in the ledger. The two nested `[workspace]`
manifests under `vendor/` and `toolchains/` are outside the ledger by design (24 nested
workspace manifests are tracked in all). Bun has one tracked lockfile, the root `bun.lock`.

`crates/sqlite_tasks` is excluded but not ledgered: it has no nested workspace or lock,
only an unresolved SQLx 0.7 dependency (see [CRATE-MIGRATION](CRATE-MIGRATION.md#consolidation-state-2026-10-22)).

The measured totals and the open decisions live in [MONOREPO](MONOREPO.md).
