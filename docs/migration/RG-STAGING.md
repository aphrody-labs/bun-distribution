<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rose Griffon source staging

RG source remains authoritative at `/home/aphro/src/rg`. The staged copy in this
repository is source preservation, not a runnable or deployable RG workspace.
The source revision and the SHA-256 of every tracked file are recorded in
[`rg-staging.json`](rg-staging.json). The audit verified 4,241 tracked files.

## Destination map

| RG source | Aphrody staging |
| --- | --- |
| `apps/*` | `apps/rg/*` |
| `packages/*` | `packages/rg/*` |
| `scripts/*` | `scripts/rg/*` |
| `docs/*` | `docs/rg/*` |
| root files | `docs/rg/root/*` (also `config/rg/*` for tracked non-private files) |
| `plugins/*`, `.claude-plugin/*` | same paths |
| `.github/*`, `.ops/*`, `.codex/*` | corresponding `rg` subdirectory |

The ten local `.env` files and the RG root `.npmrc` are copied beside their
RG app or package under `apps/rg` and `packages/rg`, with mode `0600`. They are
ignored by Git. Copies of the two root `.env` files and `.npmrc` also exist in
`docs/rg/root` because that directory preserves the requested root snapshot;
they are ignored by Git and must never be staged. The source contains no local
SQLite, PostgreSQL dump, or other database file to import. The tracked assets
and website data are included in the app and package copies.

The source-ignored `AGENTS.md` and `CLAUDE.md` under `apps/website` are copied
under `apps/rg/website` and ignored by Aphrody Git. The 178 ignored generated
Patreon API documentation pages are not part of the tracked source snapshot;
regenerate them from the package when that workspace is qualified.

## Integration gates

- The initial Aphrody root Bun workspace glob matched 21 RG packages and seven
  RG apps. The root workspace has since been narrowed to explicit Aphrody
  domains; a frozen Bun install dry run passes with RG excluded. RG manifests
  still contain 146 `catalog:` package names absent from the Aphrody root
  catalog, while 11 shared catalog entries have different version ranges.
  Keep RG out of normal root installs until this is reconciled.
- Six nested Patreon workspaces are outside the Aphrody root workspace glob.
- A local link audit found 18 unresolved relative links across six copied RG
  Markdown files. Remap them when promoting the docs from source preservation
  to canonical Aphrody documentation.
- RG scripts, TypeScript configuration, lint commands, and release assembly
  still use the original monorepo-relative paths. The copies have not been
  retargeted or run from Aphrody.
- The source RG test run had 1,212 passes and 11 failures; its root typecheck
  failed in `packages/ui/test/presentation-literals.test.ts`. Re-run gates
  after the dependency and path cutover; do not infer runtime parity from the
  file copy.
- Preserve the source checkout and deployed RG release until a clean clone,
  install, tests, build, release packaging, and rollback pass from Aphrody.

The copied `.github/rg/workflows` files are provenance only. GitHub Actions
does not load workflows from that nested path. Production topology remains
owned by `aphrody-infra`.
