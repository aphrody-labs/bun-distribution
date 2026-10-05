<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Compat

Node-to-Bun migration (`n2b`), offline Bun documentation and shared Bun/uv/Nushell
toolchain discovery. The `aphrody-bun` Rust crate and `@aphrody/bun` package belong
to `aphrody-ui`.

## Layout

| Path | Role |
| --- | --- |
| `crates/aphrody-n2b*` | Analyzer, rule registry, transformations, reports and CLI |
| `crates/compat/toolchains` | Runtime discovery, repository pins and launch environment |
| `crates/compat/bun-docs` | Offline documentation kernel subsystem |
| `packages/n2b*` | Bun CLI facade, report types, shims and plugin |
| `test/fixture/`, `tests/` | Deliberate Node input and frozen CLI/report baselines |
| `docs/n2b/` (not in repo) | Knowledge base, imported references and historical research |

Contracts owns the subsystem types and `schema/v2.json`. The N2B CLI release
closure has no sibling dependency; the documentation subsystem uses Contracts.
No AI dependency. Exact membership and dependencies come from Cargo.toml.

## Start and references

Use the pinned Rust/Bun toolchains and `RUSTC_WRAPPER=`. `aphrody n2b --help`
shows the CLI; [AGENTS.md](../../reference/compat/AGENTS.md) owns the frozen contract, NHITL and gates.

- [Documentation index](./_source/README.md), [Bun rules](../../reference/compat/BUN.md)
- [Publication scope](../../plans/compat/PLAN.md), [publish ladder](../../reference/ai/cargo/PUBLISH-LADDER.md)
- [CLI consumer contract](../../../crates/compat/n2b/tests/baselines/rpb-dashboard-baseline/INVOCATIONS.md)
- [Maintenance scripts](../../reference/compat/scripts/n2b/PLUGIN-SCRIPTS.md)

Apache-2.0. Keep N2B crate/package versions synchronized; native ABI versioning
remains independent. Prepared publication is not a published release.

## Automatisation transversale

`bun run docs:bun:update` délègue la synchronisation documentaire Bun à `aphrody-ops bun-upstream-docs`.
