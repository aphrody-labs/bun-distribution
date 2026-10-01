<!-- SPDX-License-Identifier: Apache-2.0 -->
# IECODE packages consumed by Aphrody

Status: adopted 2026-10-01; installation isolation verified on a clean source snapshot.

IECODE owns `@rosegriffon/inagle`, `@rosegriffon/inagle-cross` and
`@rosegriffon/azalee`. Aphrody retains no source copy or compatibility shim.
The existing import names and APIs remain unchanged.

## Pinned sibling source, separate installation graphs

[`config/sibling-checkouts.json`](../../../config/sibling-checkouts.json) pins
IECODE's repository, sibling path and full Git revision. Clone that revision
before running `bun run install:workspace` from Aphrody. The preparation command
rejects a different revision or dirty source and creates private local archives
under the ignored `.cache/iecode-packages` directory. Nothing is published to a
registry. Archives include their source revision in the filename, preventing
Bun from retaining stale metadata at a reused archive path.

Consumers use the root catalog; root overrides route transitive IECODE imports
to the same archives. `bun pm pack` translates IECODE's `catalog:` and
`workspace:` dependencies into its own version requirements. Thus Inagle uses
Zod 3 while RG can use Zod 4. Preparation validates file allowlists, private-file
exclusions and package/CLI entrypoints and records source provenance and SHA-256.

The three packages are not Aphrody workspace members. Installing Aphrody cannot
rewrite IECODE's `node_modules`. The earlier sibling-membership approach shared
that mutable directory and resolved IECODE catalogs through the consumer root;
it is superseded by this archive boundary.

## Updating and distributing

Update the pinned source revision and the three revision-qualified catalog and
override paths together, prepare archives, regenerate `bun.lock` through Bun,
and run RG tests/builds. CI and release assembly must prepare the same pinned
source before `bun install --frozen-lockfile`; generated archives are release
inputs, not tracked source. Production assembly integration remains a required
gate; a successful installation alone does not establish deployment readiness.

The migration inventory is
[ievr-to-iecode-2026-10-01.json](../../migration/ievr-to-iecode-2026-10-01.json).

## Dependent workspace artifacts

After preparing the pinned IECODE archives and installing the frozen lockfile,
prepare the compiled exports required by RG:

```bash
bun packages/infra/workspace/src/ops.ts rg prepare --dry-run
bun packages/infra/workspace/src/ops.ts rg prepare
```

The shared operations owner follows active `workspace:` dependency edges and
builds libraries that expose `dist/` or `build/` entries, in dependency order.
It rejects artifact cycles and owners without a build script, and stops on the
first failed build. Explicit file archives retain their producer ownership.
Currently, RG requires Discord Kit and Patreon artifacts. Source-only packages
and application builds are handled by their normal gates.

RG typechecking, tests, the complete pipeline and VPS release assembly use this
same preparation step. A failed preparation blocks its dependent checks;
previously generated output cannot turn that failure into a passing gate.

## Canonical Zukan catalog

The private Inagle archive ships its single canonical official English Zukan corpus
through `@rosegriffon/inagle/zukan/catalog`. RG imports that export rather than
reaching into an IECODE documentation directory or retaining a source copy.
The corpus includes masked profiles with optional nicknames and stats; consumers
must handle those absent fields. Package preparation preserves the catalog in
the source allowlist, so CI and immutable releases use the same pinned input.
