# IECODE workspace integration — 2026-10-01

`packages/infra/workspace` remains the sole cross-monorepo operations owner.
IECODE's thin binding resolves this checkout through `APHRODY_ROOT` or the sibling
layout, without the former standalone Infra package fallback.

The pipeline catalog now derives repository identity and gates from the selected
root manifest. Aphrody retains its structure/just foundation and generated
configuration unchanged (15 stages, 223 commands). IECODE uses its declared
root gates and member scripts (5 stages, 9 commands). Missing package gates remain
reported. Pipeline generation does not execute or qualify these commands.

`aphrody-ops iecode-sync` binds the retained central `scripts/nie/sync-main.ts`.
The transport accepts IECODE environment names and preserves explicit NIE aliases.
Its default checkout is the active sibling IECODE; the local duplicate transport
and its duplicate tests have been removed from IECODE. `--help` returns before
creating logs or accessing a remote host; mutations still require `--apply`.

Measured checks: central package TypeScript gate, scoped Oxc formatting/lint,
IECODE frozen install, Bun policy (3 manifests/0 violations), layout, active Cargo
inventory (203 members), script relocation inventory (127 paths), library and
binding typechecks, static script syntax, docs, licenses and whitespace pass.
Resolved IECODE lockfile entries are unchanged. Runtime suites and host operations
were not executed. IECODE's `PLAN.md` records the detailed per-language counts.

The local Aphrody checkout has no Git remote. Its source must be configured for
IECODE contracts CI via `APHRODY_REPOSITORY`, with private repository read access
when needed. Concurrent A2A, SSH and Shenron edits are outside this integration.
