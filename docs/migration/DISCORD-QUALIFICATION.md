<!-- SPDX-License-Identifier: Apache-2.0 -->

# Discord qualification from the Aphrody root

Run `bun run discord:verify` at the repository root.

The verification audits the autonomous Discord contracts and packages:
1. **Root catalog validation**: asserts that canonical Discord packages (`discordx`, `@discordx/di`, `@discordx/pagination`, `@discordx/importer`, `@discordx/utilities`, `discord.js`, `discord-api-types`) are locked in `workspaces.catalog`.
2. **`@aphrody/messaging`**: runs typecheck, unit tests, and build under TypeScript 7.0.2 / Bun.
3. **Consumer bots qualification (`--full`)**: runs typecheck against consumer apps (`@shenron/bot`).

## Autonomy and Upstream Elimination — 2026-10-01

- The legacy nested checkout `upstream/discord` (3.9 GB, 2,232 files) was removed.
- All consumer applications (`apps/shenron/bot`, `apps/rg/bot`, `apps/rg/achillea-bot`) now resolve unified `catalog:` versions from npm via the root `package.json`.
- Missing type definitions in the former `@aphrody/discordx` fork were eliminated by migrating to standard `discordx@11.13.3`.
- `packages/discord/aphrody-messaging` remains the active, Aphrody-owned Discord channel adapter.
