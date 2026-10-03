# NIE Wonderbot and Discord module: architecture audit

## Scope and evidence

The requested local path `~/src/nie` is not a populated Git checkout: it contains no source files outside its `.git` directory, and Git reports that `.git` is not a repository. I did not modify it. This report therefore separates the current NIE upstream tree from the last published Wonderbot package; the latter is historical evidence, not proof of a current maintained Discord service.

| Evidence | Provenance |
|---|---|
| Current NIE source snapshot | [`aphrody-code/nie`](https://github.com/aphrody-labs/iecode), `main` at `34c55fa1da54f715bb78ac336167fe18b13f9cca`, commit dated 2026-09-26 (`docs: point site integration to workspace architecture`); cloned to a temporary directory for read-only inspection. |
| Published Wonderbot artifact | npm package [`@aphrody/wonderbot@0.2.2`](https://www.npmjs.com/package/@aphrody/wonderbot), published 2026-09-10, Apache-2.0; tarball inspected without installing or executing it. |
| Adjacent published media packages | `@aphrody/ietv@0.2.2` (2026-09-10) and `@aphrody/ietv-client@1.1.2` (2026-09-10), both Apache-2.0 according to registry metadata. |

The source paths below refer either to paths in the current NIE Git snapshot or paths inside the published Wonderbot tarball, explicitly identified as such. NPM metadata provides package versions, but the Wonderbot manifest does **not** provide a Git repository URL or source commit, so the npm artifact cannot be tied to a particular source revision from its own metadata.

## Current NIE architecture and status

Current `main` has no Wunderbot package or Discord bot runtime. The authoritative workspace inventory is [`packages/README.md` (not in repo)](https://github.com/aphrody-labs/iecode/blob/34c55fa1da54f715bb78ac336167fe18b13f9cca/packages/README.md): it describes seven TypeScript workspace libraries and explicitly says historical Discord, Wonderbot, cron, MCP, auth, assets, and copied RG infrastructure services are outside the workspace. `PLAN.md` and repository `AGENTS.md` identify the current product architecture as Rust engine/tooling plus the `apps/nie-web` (not in repo) Vite frontend; infrastructure and systemd ownership are in the separate `aphrody-infra` repository.

The closest current successor for IETV/Inazuma episode presentation is [`packages/nie-media` (not in repo)](https://github.com/aphrody-labs/iecode/tree/34c55fa1da54f715bb78ac336167fe18b13f9cca/packages/nie-media), package `nie-media@1.0.0`, private, with pure exports `./navigation` and `./player`. Its manifest describes episode navigation and embed-player URLs, “no scraper, no I/O.” The current package inventory likewise says the old media logic was retained in pure form without a scraper, bot, or resident service. [`docs/BXC-NATIVE.md` (not in repo)](https://github.com/aphrody-labs/iecode/blob/34c55fa1da54f715bb78ac336167fe18b13f9cca/docs/BXC-NATIVE.md) describes the removal of the former IETV, Zukan, Wonderbot, and iecrawl services. The changelog records the consolidation of these components into NIE and subsequent workspace stabilization.

**Conclusion:** there is no current Discord module in NIE `main` to integrate or inventory as live code. The detailed Discord architecture below is the published `@aphrody/wonderbot@0.2.2` artifact and its README, not the current repository implementation.

## Published Wonderbot package

### Package shape and entry points

The npm manifest (`@aphrody/wonderbot@0.2.2:package.json`) is ESM TypeScript and publishes source entrypoints directly. `main`/`types` point at `src/index.ts`; exports expose the root, config, catalogue, announcements, episode navigation, scheduler, and UI. The root export re-exports the bot, catalogue, config, command logic, forum, announcements, gap repair, scheduler, and UI modules (`src/index.ts`). There is no `bin` field or standalone process entrypoint in this manifest. `src/index.ts` is a library facade; callers construct and start `Wonderbot` from `src/bot.ts`.

The README describes `bxc wonderbot doctor|refresh|register|start`, but the npm artifact has no corresponding CLI executable or deployment scripts. Those commands depended on an external BXC integration not included in this package. Treat the documented CLI and systemd deployment as historical/incomplete packaging, not as runnable package functionality.

### Runtime architecture and entry flow

The design isolates Discord.js in `src/bot.ts`; the rest of the catalogue, config, command response construction, scheduler, persistence adapters, and UI are mostly injected/pure modules. `bot.ts` constructs a Discord.js `Client`, registers interaction handlers, logs in, waits for readiness, registers application commands, and optionally starts refresh scheduling. Its configured gateway intents are `Guilds` and `GuildVoiceStates`; it does not request `GuildMembers` or `MessageContent`. Shutdown stops the scheduler, ends voice sessions, closes progression storage, and destroys the client (`src/bot.ts`).

The published README documents one slash-command root, `/episodes`, with search, episode, season, catalogue summary, and privileged refresh operations. The command module is `src/commands/ietv.ts`; it builds response/embed data without importing Discord.js. The bot adapter turns interactions into these command calls. Role authorization for refresh uses guild administrator permission or configured staff role IDs.

Catalogue reads use a local SQLite cache; ordinary slash commands query that cache and do not invoke remote scraping. A refresh invokes the IETV scraper integration and updates source data while retaining usable cached data for failed/unreadable sources (`src/catalogue.ts`). The scheduler runs at a six-hour default interval and refreshes on startup only when the catalogue is empty or stale. `src/annonces.ts` tracks already-announced episode identifiers and silently seeds its journal on first run. `src/forum.ts` maintains one forum thread per season and remembers thread IDs in cache metadata. `src/lacunes.ts` records missing in-season episode numbers and bounds retry attempts/delay; defaults documented are two attempts and fifteen minutes, with only one repair active at a time. `src/planificateur.ts` owns periodic scheduling.

Voice playback is an optional subsystem (`src/vocal.ts`, `src/passerelle-vocale.ts`). It uses the optional Discord voice integration, starts a local `ffmpeg` child process, and streams direct media URLs supplied through configuration. The module does not contain a hard-coded media source catalogue. The manifest marks `@discordjs/voice`, `libsodium-wrappers`, and `@napi-rs/canvas` optional peers; the README does not establish that every optional feature is covered by the same startup path.

### Configuration names

Only names are listed; no values were read or copied. `src/config.ts` accepts these aliases/settings:

- Bot token: `WONDERBOT_DISCORD_TOKEN`, `DISCORD_BOT_TOKEN`, `DISCORD_TOKEN`.
- Application ID: `WONDERBOT_APPLICATION_ID`, `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_ID`.
- Guild scope: `WONDERBOT_GUILD_ID`, `DISCORD_GUILD_ID`, and `WONDERBOT_COMMAND_SCOPE`.
- Discord destinations/roles: `WONDERBOT_ANNOUNCE_CHANNEL_ID`, `WONDERBOT_FORUM_CHANNEL_ID`, `WONDERBOT_ANNOUNCE_ROLE_ID`, `WONDERBOT_STAFF_ROLE_IDS`.
- Refresh/repair policy: `WONDERBOT_REFRESH_INTERVAL_MS`, `WONDERBOT_REFRESH_ON_START`, `WONDERBOT_AUTOFIX_ATTEMPTS`, `WONDERBOT_AUTOFIX_DELAY_MS`, `WONDERBOT_ANNOUNCE_LIMIT`.
- Cache path: `IETV_CACHE_PATH`, with legacy fallback `WONDERBOT_CACHE_PATH`; default documented as `~/.cache/ietv/episodes.db`.
- Optional audio source mapping file: `WONDERBOT_SOURCES_AUDIO`.
- `HOME` is used as a system environment fallback when constructing the default cache path.

The README says bot token and application ID are required; a missing/invalid required value makes startup fail with a named configuration error. No `.env` file was imported or examined.

### Storage and external integrations

- **Episode catalogue:** SQLite cache owned by the IETV library; default path is under `~/.cache/ietv/episodes.db`, configurable as above. Wonderbot cache metadata stores refresh time, announcement journal (`wonderbot:annonces-vues`), season forum thread IDs (`wonderbot:forum-fils`), and repair state (`wonderbot:lacunes`).
- **Per-user progress:** `src/progression.ts` opens a separate `wonderbot.db` beside the catalogue database using Bun's `bun:sqlite`; it creates `vus` and `ma_liste` tables, enables WAL and `synchronous=NORMAL`, and records per-member watched episodes/watch-list state. This storage is local and is not Discord-hosted.
- **Discord platform:** Discord.js gateway client and slash-command registration; optional `@discordjs/voice` for voice channels. Required Discord permissions described by the README are view channel, send messages, and embed links for announcements; forum features need corresponding forum/channel permissions. The bot uses interaction payload roles rather than fetching guild members.
- **Episode source:** `@aphrody/ietv` scraper plus `@aphrody/ietv-client` cache/model client. These are separate npm artifacts; current NIE instead retains pure media navigation/player URL helpers in `packages/nie-media` (not in repo) and does not include the scraper service.
- **Audio:** `ffmpeg` must be executable on the host when voice playback is used. Direct media sources are supplied through the JSON file named by `WONDERBOT_SOURCES_AUDIO`.
- **Network/HTTP:** Discord gateway and Discord REST for interactions/command registration; scraper behavior belongs to the IETV dependency. The bot itself is not an HTTP server and has no separate cron process.

### Dependency provenance and version caveats

The exact published dependency specifications in `@aphrody/wonderbot@0.2.2:package.json` are:

| Dependency | Published specification | Provenance / confidence |
|---|---|---|
| `@aphrody/ietv-client` | `workspace:*` | Internal workspace dependency at source-build time; not a valid standalone npm version range. The separately published package observed was `1.1.2`, but the Wonderbot tarball does not resolve its `workspace:*` declaration to that version. |
| `@aphrody/ietv` | `workspace:*` | Internal workspace dependency at source-build time; not a valid standalone npm version range. The separately published package observed was `0.2.2`, but that is not encoded as Wonderbot's resolved dependency. |
| `discord.js` | `catalog:` | Workspace catalog placeholder, not a semver version. The tarball does not reveal the resolved Discord.js version; do not infer one from current npm state. |
| `@napi-rs/canvas`, `@discordjs/voice`, `libsodium-wrappers` | `catalog:` | Optional peers and also dev dependencies with unresolved catalog placeholders. |
| `typescript`, `@types/bun` | `catalog:` | Development dependencies with unresolved catalog placeholders. |

Consequently the published artifact's dependency graph is not reproducible from its manifest alone and may not install correctly outside its original Bun workspace/catalog context. No exact Discord.js, TypeScript, Bun, or optional peer version can be attributed to this package from the artifact. The current NIE package manager catalog is unrelated to resolving the historical tarball.

### Startup and deployment claims

At library level the runtime sequence is `lireConfig` → construct `Wonderbot` → `demarrer()` → Discord login/readiness → command registration → optional initial catalogue refresh and periodic scheduler. `arreter()` cleans up scheduler, voice, SQLite progress DB, and Discord client. The package itself does not expose a CLI `bin` entry or a process main that invokes this sequence.

The README documents a systemd unit named `bxc-wonderbot.service`, installed from `scripts/deploy/bxc-wonderbot.service` (not in repo), with write access constrained to the cache path and clean-stop/config-error exit handling. Those deployment paths are **not present in the npm package contents** inspected, and the current NIE repository says BXC/Wonderbot services were removed. They therefore require a historical/external checkout and must not be treated as deployable from current NIE or this npm tarball.

## Assessment for an Aphrody Discord integration

1. Treat the current NIE repository as having **no Discord module**; do not vendor or depend on an assumed current `packages/wonderbot` (not in repo).
2. Treat `@aphrody/wonderbot@0.2.2` as a historical reference implementation. Before reuse, restore provenance to an exact source commit and replace `workspace:*` / `catalog:` with a deliberate, lockfile-backed dependency resolution.
3. The useful reusable boundaries are the platform-neutral episode commands, catalogue queries, bounded refresh scheduler, forum synchronization model, and UI formatting. The Discord.js adapter is concentrated in `src/bot.ts`; voice is a distinct optional concern.
4. The current NIE successor is the pure `nie-media` navigation/player package, not a scraper or Discord service. Any live IETV ingestion now needs a separately identified owner/source.

## Verification performed

- Confirmed the local NIE path has no source files and is not recognized as a Git repository.
- Read NIE upstream `AGENTS.md`, `PLAN.md`, `packages/README.md` (not in repo), `docs/BXC-NATIVE.md` (not in repo), and relevant changelog entries at the commit listed above.
- Inspected the published npm package manifest, README, and TypeScript source from `@aphrody/wonderbot@0.2.2`, plus registry metadata for the adjacent IETV packages.
- Did not install dependencies, execute the package, access secret values, run tests, or modify either source repository.
