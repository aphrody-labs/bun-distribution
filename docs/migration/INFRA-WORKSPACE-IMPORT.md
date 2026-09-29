# Infra workspace staging

2026-09-29. The current `@aphrody/workspace` package was copied from the
transitional `src/aphrody-infra/packages/aphrody-workspace` checkout at Git
HEAD `903dd9ae3162c2de404e4dc5a659fa5fd0b92f0b`. That source working tree
also had uncommitted package edits, including a new `consolidation.ts`; the
staged copy includes them. Source remains intact for rollback. This is not a
clean-clone or release claim.

Destination: `packages/infra/aphrody-workspace`. The first-party Bun root now
owns `package.json`, `bun.lock` and an isolated `bunfig.toml`. The package test
that previously assumed a sibling `aphrody-ui` checkout now checks the new
monorepo's own manifest. Its TypeScript configuration includes DOM types
required by existing `Response` consumers. No `node_modules`, build output,
secret, game data or nested Git directory was copied.

The package's TypeScript sources and tests were formatted with the root Oxc
formatter after import. The common Bun catalog pins Bun 1.4.2, TypeScript
7.0.2, oxlint 1.85.0 and oxfmt 0.70.0. The three-day minimum package age
policy remains active; no install age exception was added.

Measured: Bun 1.4.2 frozen installation, TypeScript 7 typecheck, 12 package
tests, and the IECODE doctor (11 Rust, 5 Bun) pass from this location. IECODE
now invokes the new package via its thin `scripts/aphrody-ops.ts` binding,
and its 19-root license audit and Python lint pass through it.

The package's Rust bridge now resolves the new monorepo root, whose Infra
binary is staged under `crates/infra/`; see `INFRA-RUST-IMPORT.md`. Commands
requiring Infra configuration are still gated on the configuration import.

After this staging snapshot, the AST inventory was aligned with TypeScript
7.0's API boundary: its compiler is TypeScript 7.0.2, and source imports the
TypeScript 6 compatibility API explicitly from `@typescript/typescript6`
6.0.2. Frozen install, typecheck, oxlint, oxfmt and the AST inventory command
were re-run successfully in this target workspace on 2026-09-29.

Remaining: commit and publish the new monorepo after the complete source map,
consumer cutover, lockfile and clean-clone gates pass; remove the transitional
Infra package only after no callers remain. The surrounding Aphrody source
repositories still live under `src/` during migration. Only `rg` and
`shenron` are intended to stay there at final cutover.
