<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron and Discord layout in Aphrody

- `packages/shenron/{api,auth,config,db,images,pipeline,ui}` and
  `apps/shenron/{bot,site}` are Bun root workspace members. Package names and
  `@shenron/*` workspace dependencies are preserved. Source catalog versions
  are pinned within Shenron manifests, avoiding cross-domain catalog skew.
- `packages/discord/aphrody-messaging` is the Aphrody-owned Discord package.
  The complete Discord.js/Discordx fork stays in its own pinned workspace at
  `upstream/discord`, outside the root Bun workspace.
- The Shenron source checkout and the earlier `_preview` package copy remain
  intact. Source SHA-256 values, target hashes, and remapped paths are recorded
  in `shenron-workspace-import.json`. Run `bun run shenron:verify` after edits.

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
