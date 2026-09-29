<!-- SPDX-License-Identifier: Apache-2.0 -->
# Imported documentation link re-audit

Audit date: 2026-09-29.

## Scope and method

This audit covers the local Markdown-link findings recorded by
[`document-import.json`](document-import.json), whose source inventory is
[`source-map.json`](source-map.json). It does not change the generated import
index, source map, migration plan, manifests, or any non-documentation file.

The import report is the authoritative measurement for this import run:

| Measure | Value |
| --- | ---: |
| Indexed documents | 6,538 |
| Relative Markdown links rewritten during import | 2,267 |
| Unresolved local Markdown links | 1,297 |
| Persisted detailed finding sample | 200 |

The report stores a count and the first 200 unresolved occurrences, rather
than the complete finding set. The re-audit therefore checks every available
candidate against the current source map and only changes a destination when
the resulting local target exists and identifies the same package or file.

## Finding classes

The recorded sample is dominated by links to surfaces outside the documentation
import boundary. Its extension mix includes Rust (`.rs`), Python (`.py`), JSON,
TOML, TypeScript, images and extensionless directories. These are source,
asset, configuration, generated-output or external-worktree references; they
cannot safely be redirected to a documentation file.

The sample also contains historical upstream documentation whose sibling files
were deliberately not imported, including Node changelog versions and external
SDK examples. Rewriting them to a similarly named document would change their
meaning and is not a valid repair.

No broad rewrite is justified until the migration imports the referenced code,
assets and configuration under stable target paths, or the documentation owner
defines an explicit canonical substitute.

## Corrected local destination

One destination is certain and is corrected in this checkout:

| Imported document | Previous link | Correct local destination | Evidence |
| --- | --- | --- | --- |
| `docs/reference/workspace/NIE-CAPABILITY-MAP.md` | `../../iecode/packages/nie/package.json` | `../../../packages/iecode/nie/package.json` | `packages/iecode/nie/package.json` exists and declares `@aphrody/nie`. |

This is an imported-document override. A future docs-import run must preserve
the correction or formalize the target-path rewrite in the importer before
regenerating the document.

After the source inventory was refreshed, `docs-import` ran again at
`2026-09-29T03:51:10Z`: 6,538 documents indexed, 202 exact aliases, 2,267
links mapped, zero failures, and one preserved conflict. At that point the
importer only mapped Markdown targets.

The 2026-09-29 importer update accepts local file targets under the root Cargo,
Bun and scripts directories when source and target hashes match, recorded import
hashes match, or a Bun package manifest has the same package name on both sides.
It checks the source inventory hash and target existence before remapping. The
guarded rerun at `2026-09-29T04:59:27Z` mapped 2,272 links and recorded 1,292
unresolved links, zero failures and zero conflicts. A subsequent inventory refresh
and rerun produced the same counts. The corrected `@aphrody/nie` manifest link
is now counted as mapped.

## Follow-up boundary

The remaining 1,292 recorded findings require destination import, source
classification or an explicit owner-approved canonical target. Resolve them
with the owner that imports each target surface, then rerun the importer and record its new complete count in
`document-import.json`.
