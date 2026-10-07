# Upstream provenance

This workspace vendors source snapshots so development can change packages
across upstream boundaries. It does not replace either upstream project as
the canonical source.

| Source                                                          | Imported revision                                               | Scope                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [discordjs/discord.js](https://github.com/discordjs/discord.js) | `8a22bc3eedccf5331dcddac6fb01d2339b0f75a8` (`main`, 2026-09-28) | 22 packages, 3 apps, package-local docs, scripts, licenses, and notices   |
| [discordx-ts/discordx](https://github.com/discordx-ts/discordx) | `017c6e8c34908e6ca359bed9986fff43c0ce41cc` (`main`, 2026-07-29) | 12 packages and the DiscordX documentation site                           |
| [buape/carbon](https://github.com/buape/carbon)                 | npm `@buape/carbon@0.16.0` (MIT)                                | external dependency used by `apps/carbon-example` (not in repo); source is not vendored |

## Discord.js packages

The upstream `packages/` tree is retained, including package-level license
files and its release, API extraction, documentation-generation, and test
support packages:

`@discordjs/actions`, `@discordjs/api-extractor`,
`@discordjs/api-extractor-model`, `@discordjs/api-extractor-utils`,
`@discordjs/brokers`, `@discordjs/builders`, `@discordjs/collection`,
`@discordjs/core`, `@discordjs/docgen`, `@discordjs/formatters`,
`@discordjs/next`, `@discordjs/proxy`, `@discordjs/rest`, `@discordjs/rpc`,
`@discordjs/scripts`, `@discordjs/structures`, `@discordjs/ui`,
`@discordjs/util`, `@discordjs/voice`, `@discordjs/ws`,
`create-discord-bot`, and `discord.js`.

The three upstream apps are kept in `apps/guide` (not in repo), `iecode/apps/rg/website`, and
`docs/products/discord/apps/proxy-container` (not in repo) (external DiscordX application layout). DiscordX's existing Docusaurus app remains in `docs/`;
it covers the DiscordX framework and is not a duplicate of the Discord.js API
reference or guide.

## Integration policy

- Package source and per-package Apache or MIT notices stay with their
  respective upstream packages. The root `LICENSE.txt` remains the DiscordX
  license; Discord.js package licenses retain their original copyright lines.
- Root dependency management uses Bun workspaces and `bun.lock`. TypeScript,
  Oxlint, Oxfmt, and Bun types are pinned through the root catalog.
- Root Turbo tasks are shared. Upstream package scripts and local compiler or
  bundler configurations stay package-owned where their behavior differs.
- Upstream deployment and publishing workflows are not enabled by importing
  their CI files. The existing Aphrody/DiscordX repository workflows remain
  the only repository workflows until reviewed as a separate change.
- Upstream `.env*` files are intentionally excluded. No credentials or
  environment overrides are part of this source snapshot.

To refresh either upstream, fetch its named remote and review a diff against
the recorded source revision before updating the snapshot. Do not use a
blind directory copy: root package management, workflows, docs navigation and
license files require a three-way merge.
