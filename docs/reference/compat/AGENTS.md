<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-compat: agent rules

Owns N2B migration, toolchain discovery and offline Bun documentation.
`aphrody-bun` / `@aphrody/bun` now belong to UI.
Follow [workspace rules](../workspace/AGENTS.md) and the user's global policy:
**NHITL**, no approval prompts or interactive questions for authorized work.

## Boundaries

- No AI dependency. Contracts owns report schemas and the subsystem contract;
  resolve sibling paths from manifests, never copy their implementations.
- Use Bun and workspace dependency/lint inheritance. Preserve Windows/Linux support.
- `test/fixture/` is deliberately Node-flavoured input; do not normalize it.
- Read [README](../../products/compat/README.md) and the [docs index](../../products/compat/_source/README.md) for working entry points.

## n2b external contract (frozen)

`n2b` is consumed as a subprocess (CLI-as-API, see
[`crates/compat/n2b/tests/baselines/rpb-dashboard-baseline/INVOCATIONS.md`](../../../crates/compat/n2b/tests/baselines/rpb-dashboard-baseline/INVOCATIONS.md)).
Change one of these surfaces only as a justified breaking change with regenerated baselines;
otherwise add a new rule or flag instead of altering an existing one.

| Surface | Source of truth |
| --- | --- |
| CLI flags and subcommands | `crates/compat/n2b/src/cli/args.rs` |
| Exit codes (`0` clean, `1` findings, `2` error) | `crates/compat/n2b/src/commands/scan.rs`, `crates/compat/n2b/src/main.rs` |
| JSON report v2 (bump to v3 on a breaking change) | `../aphrody-contracts/schema/v2.json` |
| Rule IDs (`cli/*`, `imports/node-prefix`, `shebang/node`, ...) | `crates/compat/n2b-registry/registry/*.toml`, `crates/compat/n2b-core/src/rules/` |
| cdylib ABI v2 (`find_newlines_u16`, `node2bun_abi_version`, `node2bun_scan_json`, `node2bun_scan_with_options_json`, `node2bun_string_free`) | `crates/compat/n2b-native/src/lib.rs` |

- Safety net: `crates/compat/n2b/tests/contract.rs` (`assert_cmd` + `jsonschema` against the
  contracts schema, over `test/fixture/`) and `crates/compat/n2b/src/schema_test.rs` (round-trip
  of the baselines under `tests/`).
- `--report=md` and `--report=markdown` are equivalent; `n2b rules --report json` prints a flat
  JSON array.
- Scanners and rules do not know each other; their only contract is `Finding`
  (`crates/compat/n2b-types`).
- Migration side effects (`--migrate`: `bun install`, rival lockfile removal, `package.json`
  edits) run only from `crates/compat/n2b/src/commands/migrate.rs` and go through `BackupGuard`
  (`crates/compat/n2b/src/subprocess/bun.rs`), which restores the backups on failure or panic.
- The scanner property tests (`crates/aphrody-n2b-core/tests/proptest_*.rs`, proptest default
  case count): fix a panic they uncover in the scanner, never lower the case count.
- Versions: the `aphrody-n2b*` crates and `@aphrody/n2b-*` packages move together;
  `aphrody-n2b-native` is versioned separately (ABI v2 at crate `0.2.0`). Regenerate the baselines after a
  bump, because the version appears in the JSON, JSONL and SARIF output.

## Validation

Documentation: links/anchors and `git diff --check`. Implementation: focused checks,
then these gates with the pinned toolchain and `RUSTC_WRAPPER=`:

```sh
export RUSTC_WRAPPER=
cargo fmt --check
cargo check  --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test   --workspace
cargo deny   check
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test
git diff --check
```

## Automatisation transversale

`bun run docs:bun:update` délègue la synchronisation documentaire Bun à `yolo ops bun-upstream-docs`. Conserver cette entrée locale lors de toute évolution du module central.
