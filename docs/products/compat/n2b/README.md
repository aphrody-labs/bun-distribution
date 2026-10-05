<!-- SPDX-License-Identifier: Apache-2.0 -->
# docs/n2b — Bun + Node knowledge base for n2b

Upstream documentation extracted to drive n2b coverage. **Source of truth for the rules**: what
Bun supports, what Node exposes, what n2b must detect and rewrite.

## Content

| Folder | Source | Pinned version |
|---|---|---|
| `docs/<category>/upstream-bun/` (canonical) | `oven-sh/bun` · `docs/` | HEAD `a2671046` (2026-09-29), see `docs/migration/UPSTREAM-BUN-DOCS-COMMIT.md` |
| `docs/<category>/compat/n2b/bun/` (residual) | `oven-sh/bun` · `docs/` | main `d316760e` (2026-09-06): only the 26 files that differ from the canonical copy remain |
| `docs/<category>/compat/n2b/node/` | `nodejs/node` · `doc/api/` | LTS v24.15.1 (`9fe7634c`) |
| `docs/<category>/compat/n2b/plugin/n2b/` | n2b plugin documentation (changelog, structure, research, WASM reports) | — |

On 2026-10-02 the 309 files of the older n2b Bun mirror that were identical to
`docs/<category>/upstream-bun/` after CRLF to LF normalisation were removed; the
removed-to-canonical aliases and both SHA-256 values are recorded in
`docs/migration/n2b-dedup-2026-10-02.json`. Read the Bun docs from `upstream-bun`
(also served offline by the `bun_docs_*` MCP tools of `crates/compat/bun-docs`).

Only markdown is kept here; binary assets (images, icons, logos) are stripped.

## Regenerate

### Bun docs

`yolo ops bun-upstream-docs [--root <repo>] [--ref <branch-or-tag>]`
(`packages/infra/workspace/src/bun-upstream-docs.ts`) still writes the legacy
`docs/n2b/bun/` (not in repo) path; it must be pointed at `docs/<category>/upstream-bun/`
before it is used again (owner: Infra).

### `node/` — manual

```bash
git -C upstream/node pull   # or re-clone with --depth 1

rm -rf docs/n2b/node && mkdir -p docs/n2b/node
cp -r upstream/node/doc/api/. docs/n2b/node/
cp upstream/node/doc/changelogs/CHANGELOG_V24.md docs/n2b/node/
```

## Active Aphrody Bun/UV contract

The Aphrody repositories use n2b as the Bun compatibility gate for first-party surfaces and
imported third-party packages. `vendor/`, `node_modules/`, `target/` and archived trees stay
read-only and are never migrated automatically.

From the `aphrody-ai` checkout (it owns `packages/google` and the `runtime:check` script):

```bash
aphrody n2b rules
aphrody n2b packages/google
bun run runtime:check
```

`runtime:check` is the shared execution gate: it checks Bun, the tests and the bundle of
`@aphrody/google`, then `uv --version`, the lockfiles of the maintained Python workspaces and the
import of the `aphrody` facade. It makes no live Google call and reads no secret.

Rules enforced on critical Bun packages:

- `bun install` and `bun.lock` as the single manager and lockfile;
- `bun test` as the runner;
- `bun build` as bundler and CLI compiler;
- `Bun.file`, `Bun.env`, `Bun.which` and `Bun.spawn` before their Node equivalents;
- `engines.bun >= 1.4.2`, `type: module`, `moduleResolution: bundler`;
- `oxlint`/`oxfmt` for lint and format, without reformatting third-party imports;
- n2b audit before any migration, `--fix` only on first-party files, never `--migrate` on an
  imported tree.

The n2b scan of `packages/google/google` reports no error; the only remaining warning is
`Bun.spawn`, already used natively by its CLI launcher. Known issue: `aphrody n2b audit` panics
with `Cannot start a runtime from within a runtime` because `aphrody-ai`
(`crates/infra/aphrody-command/src/commands.rs`, `N2bCommand`) calls the synchronous `aphrody_n2b::run_from`
from its async executor; it needs a `spawn_blocking` wrapper there. Rule and package scans are
unaffected. Drop this note once that fix lands.

## Key files for n2b coverage

| File | Use |
|---|---|
| `docs/reference/upstream-bun/runtime/nodejs-compat.mdx` | Node→Bun compatibility matrix: which Node modules work, partially or not at all |
| `docs/apis/upstream-bun/runtime/bun-apis.mdx` | Native `Bun.*` API surface: rewrite targets |
| `docs/reference/upstream-bun/runtime/*.mdx` | Per-API detail (ffi, sqlite, shell, sql, redis, s3, glob, …) |
| `docs/plans/upstream-bun/project/roadmap.mdx` | Bun roadmap, to anticipate future rules |
| `docs/reference/compat/n2b/node/*.md` | Full Node API surface (one file per module): what n2b must detect |
| `docs/reference/compat/n2b/node/CHANGELOG_V24.md` | Node v24 LTS changes |

## Integration with the rule registry

The five registry entry schemas (`crates/compat/n2b-registry/src/schema.rs`: `ApiEntry`,
`PackageEntry`, `ModuleEntry`, `CliEntry`, `GlobalEntry`) all carry an optional `docs: String`
field, a free-form citation (for example
`docs = "absent from docs/bun/runtime/nodejs-compat.mdx (…)"`). The test
`crates/compat/n2b-registry/src/registry.rs::tests::docs_field_citations_resolve` extracts every
`docs/(bun|node)/*.md(x)` substring from those fields and fails unless the cited file exists
under `docs/<category>/upstream-bun/` (Bun) or `docs/<category>/compat/n2b/node/` (Node).
