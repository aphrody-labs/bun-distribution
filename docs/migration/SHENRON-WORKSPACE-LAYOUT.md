<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron and Discord layout in Aphrody

- `packages/shenron/{api,auth,config,db,images,pipeline,ui}` and
  `apps/shenron/{bot,site}` are Bun root workspace members. Package names and
  `@shenron/*` workspace dependencies are preserved. Compatible TypeScript,
  Bun types, React, Zod, and Oxlint dependencies use Aphrody's root catalog.
- `packages/discord/aphrody-messaging` is the Aphrody-owned Discord package.
  The Discord framework dependencies (`discordx`, `@discordx/*`, `discord.js`) are
  managed autonomously via the root Bun catalog, with no upstream fork checkout.
- `@aphrody/workspace` exposes Shenron through
  `packages/infra/aphrody-workspace/src/shenron.ts`: workspace status and
  declared-script execution, shared script audit, source-map migrations, and
  Aphrody Infra service/environment/deploy commands. Its migration steps reuse
  the existing `consolidation` engine and filter docs/scripts imports to
  Shenron after generating the shared inventory.
- The current source inventory was regenerated and 483 Shenron scripts were
  imported with verified hashes under `scripts/tools/shenron`; the generated
  command index is `docs/migration/IMPORTED-SCRIPTS-INDEX.md`. The original
  checkout remains untouched. Runtime and host duties continue through the
  declared Shenron manifests and `aphrody-infra`.
- The Shenron source checkout and the earlier `_preview` package copy remain
  intact. Source SHA-256 values, target hashes, and remapped paths are recorded
  in `shenron-workspace-import.json`. Run `bun run shenron:verify` after edits.
- The remaining tracked Shenron files follow the RG source-staging layout:
  `scripts/shenron`, `docs/shenron`, `data/shenron`, `bin/shenron`,
  `services/shenron`, `.claude/shenron`, `.github/shenron`, and
  `config/shenron/deploy`. Shenron root files are preserved under
  `docs/shenron/root`; root toolchain/config files also have a copy under
  `config/shenron`, matching the RG snapshot convention. Source hashes, file
  modes, exclusions, and destinations are listed in
  `shenron-non-workspace-import.json`.
- This is source preservation for the non-workspace files: copied scripts keep
  their source-relative assumptions, `.github/shenron/workflows` is not
  activated as Aphrody CI, and deploy files are not installed. No `.env`, local
  database, cache, generated output, or ignored source file was imported. The
  tracked proxy environment file was excluded.
- The complete phased convergence plan, including remaining UI/runtime/dependency
  work and clean-clone/deploy closure, is in
  [`APHRODY-ROADMAP.md`](../plans/shenron/APHRODY-ROADMAP.md).

On 2026-09-29, root `bun install --frozen-lockfile`, nine Shenron typechecks,
399 bot tests, and complete `config`, `api`, `auth`, `db`, `images`, and `ui`
package tests passed. `bun run discord:verify` passed after the fork move.
The site Turbopack compilation reached page-data collection; the local build
then stopped because `DATABASE_URL` was absent. Full site tests include live
database cases and stale source assertions; pipeline tests include BXC and
native RAG cases. Those suites are not release-green in this checkout.

No VPS unit, deployed release path, database, or original Shenron source was
changed by this workspace migration. Runtime cutover still needs its own
release and rollback verification in Aphrody Infra.
