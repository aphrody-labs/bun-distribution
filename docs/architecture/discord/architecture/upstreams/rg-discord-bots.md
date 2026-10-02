# Rose Griffon upstream Discord bots

Inventory checked against the `rg` workspace source and the Infra service catalog on 2026-09-28. Treat its production details as historical; the [2026-10-02 VPS observation](../../../../operations/infra/VPS-STATUS-2026-10-02.md) records current running units but does not verify application endpoints. Environment variable names are listed for integration work; secret values were not inspected or copied.

## System view

In accordance with the canonical convergence plan (`docs/plans/convergence/ROSE-GRIFFON-ACHILLEA-CONVERGENCE.md`), the previous split between `apps/rg/bot` and `apps/rg/achillea-bot` has been consolidated into **a single unified daemon**:

| Bot Daemon | Source workspace | Entrypoint | Runtime unit | Responsibilities |
|---|---|---|---|---|
| Rose Griffon Unified (`rg`, `azalee`, `achillea`) | `apps/rg/bot` (`@rosegriffon/bot`) | `src/entry-standalone.ts` / `src/index.ts` | `rg-bot.service` | Unified Discord commands (community, Azalée, Achilléa), Unified ElysiaJS API (:8800), WebSocket hub, and Colyseus ranked engine. |

The standalone `rg-achillea-bot.service` and the legacy ports (4000, 4002, 4005) have been retired. All Discord bot identities (`rg`, `azalee`, `achillea`) are loaded dynamically through the multi-profile engine in `apps/rg/bot/src/lib/profil.ts`, and can be compiled into a single AOT native binary (`dist/rg-bot`) via `aphrody discord compile rg --smoke`.

## 1. RG community bot (`apps/bot`)

### Architecture and startup

- Main: `apps/bot/src/index.ts`. Bun executes TypeScript directly (`bun run src/index.ts`); `dev` uses `bun --watch`. Build script emits a Bun-targeted bundle to `dist`, though the production systemd template runs the source entrypoint.
- Discord client: `discordx` over `discord.js`. `src/lib/profil.ts` is the profile registry (`rg` default, `azalee` optional); `src/lib/config.ts` resolves token, guild scope, branding, URLs, and announcement behavior. Command modules are dynamically imported sequentially before login, so only the active profile's command tree is registered.
- RG profile loads the community command modules and member/community events; guild-scoped slash commands. The `azalee` profile uses the same executable and shared code with its own command modules and global command scope, but its dedicated systemd service is retired according to the app README.
- On `clientReady`, slash commands are registered, tweet-post notification handling and an optional local admin HTTP surface start. Interaction failures receive an ephemeral fallback. SIGTERM/SIGINT stop timers/services, destroy the Discord client, close cache and PostgreSQL.
- Member synchronization is normally delegated to `rg-cron`; production `rg-bot.service` sets `BOT_SYNC_MEMBRES=0`. The bot supports opting into it with `BOT_SYNC_MEMBRES=1` plus the privileged members intent. `RG_DISCORD_SYNC_SQLITE_PATH` and `RG_DISCORD_SYNC_REDIS_URL` are also present in the unit for the shared Discord sync contract.

### Internal dependencies

Declared in `apps/bot/package.json`:

- Workspace packages: `@rosegriffon/achillea-client`, `@rosegriffon/azalee`, `@rosegriffon/db`, `@rosegriffon/types`, `@rosegriffon/ui` (`workspace:*`). `@rosegriffon/config` is a development dependency.
- Main external runtime packages: `discordx` and `discord.js` (`catalog:`), `reflect-metadata` (`catalog:`), `zod` (`catalog:`), and `@aphrody/canvas` (`catalog:`).
- Root catalog versions: `discordx 11.13.3`, `discord.js ^14.26.4`, `zod ^4.6.4`, `@aphrody/canvas 0.1.99`, `reflect-metadata ^0.2.2`. Package manifest ranges/catalog are the declared provenance; Bun lockfile is the resolution source.
- PostgreSQL access is provided by workspace `@rosegriffon/db` via `@rosegriffon/db/bun-sql`; cache uses Redis when configured and can fall back in memory. This bot does not own a separate schema or migration set.

### Storage and integration contracts

- PostgreSQL via the `@rosegriffon/db/bun-sql` workspace adapter (`src/lib/db.ts`); uses shared RG application tables/settings, including Discord member, community, ticket/moderation, and announcement state. The `rg` database is the source of truth.
- Redis cache: `REDIS_URL`, defaulting in code to local Redis database 1.
- Website bot API: `WEBSITE_API_URL` with `BOT_API_TOKEN` for authenticated bot-to-site calls (`src/lib/api.ts`). Public links use profile-selected website base URL.
- Azalée game-data API is consumed over HTTP through `AZALEE_API_URL` (default local `rg-api` `/v1/azalee`); Achilléa API integration uses `ACHILLEA_UNIFIED_API_URL` (default `https://api.rosegriffon.fr/v1/achillea`).
- Cron coordination: Unix socket path `RG_CRON_SOCKET` with a code default; the bot's X/tweet notifier uses the shared database and per-profile cursor. RG production unit also configures `WEBSITE_URL` and `WEBSITE_API_URL`.
- Optional admin listener: `BOT_ADMIN_TOKEN` gates startup; port is `BOT_ADMIN_PORT`. It is not opened without a token.
- Discord intents are profile-specific: RG requests guilds, members and guild messages; Azalée profile only guilds. The code explicitly avoids Message Content access.

### Configuration key names

The committed `apps/bot/.env.example` has a legacy/incomplete sample. Current code and `src/lib/profil.ts` establish these keys (some optional, feature-dependent):

- Discord/profile: `RG_PROFIL_BOT`, `DISCORD_BOT_TOKEN` (RG), `DISCORD_TOKEN` (RG fallback), `AZALEE_DISCORD_BOT_TOKEN` (Azalée profile), `GUILD_ID`, `BOT_COMMAND_GUILDS` (legacy/alternate source where referenced), `TEST_GUILD_ID`.
- Profile-specific URLs and announcement controls: `WEBSITE_URL`, `AZALEE_WEBSITE_URL`, `DISCORD_NEWS_CHANNEL_ID`, `AZALEE_DISCORD_NEWS_CHANNEL_ID`, `DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID`, `DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID`.
- Site and upstream APIs: `WEBSITE_API_URL`, `BOT_API_TOKEN`, `AZALEE_API_URL`, `AZALEE_URL`, `ACHILLEA_UNIFIED_API_URL`.
- Database/cache/sync: `DATABASE_URL`, `REDIS_URL`, `BOT_SYNC_MEMBRES`, `SYNC_INTERVAL_MS`, `RG_DISCORD_SYNC_SQLITE_PATH`, `RG_DISCORD_SYNC_REDIS_URL`, `RG_CRON_SOCKET`.
- Admin/ops and optional scripts: `BOT_ADMIN_TOKEN`, `BOT_ADMIN_PORT`, `RG_RELEASES_ROOT`, `NOCTALY_API_KEY`, `CANVAS_SMOKE_DIR`.
- General process setting: `NODE_ENV` (provided by the service unit).

The sample also mentions `SUPABASE_INTERNAL_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `DISCORD_CLIENT_ID`; they are not the current runtime's primary bot DB/token contract. Treat code and deployed unit configuration as authoritative over that historical sample.

### Deployment

`systemd/rg-bot.service` is a simple Bun service with `WorkingDirectory=/srv/rg/current/apps/bot`, external `EnvironmentFile`, `ExecStart` of `bun run src/index.ts`, restart-on-exit, and journal logs. It is deployed from immutable RG releases. `rg-bot` is private/internal as a service; it has no declared public listener. Cron owns broader community synchronization and HTTP announcement duties. These deployment details are the 2026-09-28 snapshot described above.

## 2. Achilléa bot/backend (`apps/achillea-bot`)

### Architecture and startup

- Main: `apps/achillea-bot/src/main.ts`. Development executes `bun --watch src/main.ts`; production compiles TypeScript/aliases to `build/` and starts `bun build/main.js`. The build separately emits ranked ESM under `build/ranked/`.
- Discord: `@aphrody/discordx`/discordx decorators, `discord.js`, profile selected by `BOT_PROFILE` (`current` in the production unit; `legacy` is supported). `src/client.ts` validates the token against its selected application ID using Discord REST and resolves granted privileged intents before creating the client. Commands and events are loaded from `src/commands` and `src/events`, plus plugins.
- Main process initializes plugin services, MikroORM, Socket.IO and a child Bun process for Colyseus ranked, then starts the Ts.ED REST server. The Discord gateway is initialized afterward; REST/Socket.IO/ranked are designed to remain running even if Discord login fails. Graceful shutdown stops API, Socket.IO, watchers, scheduler/workers, Discord, ranked child and database.
- REST server: Ts.ED + Express compatibility at `API_HOST:API_PORT` (production unit binds loopback port 4000), health endpoint `/health/check`, Swagger `/docs`.
- Ranked child: `src/ranked/main.ts`; Colyseus rooms and HTTP routes on loopback port 4002. Socket.IO is a separate listener on loopback port 4005. The parent supervises the child; `RANKED_DISABLED` and `RANKED_ENTRY` can change this behavior.
- The 2026-09-28 snapshot recorded `rg-achillea-bot.service` (formerly `achillea-bot.service`), with REST `:4000` and ranked `:4002` listed as upstreams and Socket.IO `:4005` reserved. The current [VPS observation](../../../../operations/infra/VPS-STATUS-2026-10-02.md) confirms unit presence only, not listener or Nginx state.

### Internal dependencies

From `apps/achillea-bot/package.json`:

- Workspace packages: `@rosegriffon/db`, `@rosegriffon/discord-sync`, `@rosegriffon/achillea-core`, `@rosegriffon/achillea-types`, `@rosegriffon/auth` (`workspace:*`). `@rosegriffon/achillea-contract` exists in the monorepo as the generated API contract package, though it is not a direct runtime dependency here.
- Discord/runtime: `discordx ~11.13.3`, `discord.js ^14.26.4`, `discord-api-types ~0.38.48`.
- Persistence/queues: `@mikro-orm/core`, `@mikro-orm/postgresql`, migrations and CLI `^7.1.x`; `kysely` from catalog (`^0.29.2`); `ioredis ^5.11.1`, `bullmq ^5.78.0`.
- HTTP/realtime/game: `@tsed/common ^8.30.0`, `@tsed/platform-express ^8.30.0`, `express ^5.2.1`, `colyseus ^0.17.10`, `@colyseus/bun-websockets ^0.17.13`, `socket.io ^4.8.3`.
- Other integrations include `axios ^1.17.0`, `dotenv ^17.4.2`, `envalid ^8.1.1`, `installoop ^1.1.0`, and `@aphrody/canvas 0.1.99`. Versions above are package declarations; `bun.lock` holds exact resolutions.

### Storage and integration contracts

- PostgreSQL: MikroORM 7 against the unified RG PostgreSQL database, with Kysely/Bun SQL used by the ranked child. `DATABASE_URL` is preferred; legacy host/name/user/password fields remain supported. The schema is now native `achillea` in database `rg` (per current `docs/achillea-services.md` and root instructions), while `database/migrations/` preserves Achilléa TypeScript migrations. ORM initialization does not mutate schema; migrations are explicit deployment operations. Do not infer a separate active DB service from the older app README's portage note.
- Authentication: Discord bot OAuth/session integration coexists with unified Better Auth; `@rosegriffon/auth` is internal dependency. The website's `/api/achillea/session` is the current user-facing session contract; the legacy bot also has API auth/session modules. `JWT_SECRET_KEY` and cookie domain affect legacy session handling.
- Redis: `ioredis`/BullMQ queues. `src/configs/redis.ts` uses logical DB 2 and key prefix `achillea`; test uses DB 9. Inputs `REDIS_HOST`, `REDIS_PORT` (defaults local host/port). This separates its queues from RG's logical Redis DB.
- Supabase Storage: server-side service secret for public `images` and private `ranked-proofs` buckets; private proofs use signed URL TTL. Image uploads validate size/type and do not fall back to disk in production. Ranked proof storage can use Supabase or development-local storage according to `src/ranked/storage.ts`.
- Internal HTTP contracts: the ranked child proxies/uses unified API and posts internal notifications back to parent REST using `RANKED_INTERNAL_SECRET`; parent exposes notification, health, auth and domain controllers. `UNIFIED_API_URL` points at current RG API. CORS is configured from `WEB_ALLOWED_ORIGINS`, `WEBSITE_URL` and ranked-specific origin settings.
- Discord sync contract: guild create/delete/ready handlers use `@rosegriffon/discord-sync` and `RG_DISCORD_SYNC_SQLITE_PATH`; production shares the same SQLite path and Redis URL convention with RG cron/bot.
- External integrations are feature-specific: Twitch, YouTube, Challonge and Google Workspace credentials; cross-server sanction synchronization uses signed HMAC webhooks and configured target JSON. Optional image provider/Imgur keys also exist.

### Configuration key names

Names below are derived from `src/utils/types/environment.ts`, config modules, ranked process and direct `process.env` consumers; values are omitted.

- Process/profile: `NODE_ENV`, `BOT_PROFILE`, `BOT_COMMAND_GUILDS`, `BOT_TOKEN`, `DEV_BOT_TOKEN`, `BOT_OWNER_ID`, `TEST_GUILD_ID`.
- Discord application: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_ID_DEV`, `DISCORD_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET_DEV`, `DISCORD_PUBLIC_KEY`, `DISCORD_PUBLIC_KEY_DEV`.
- PostgreSQL: `DATABASE_URL`, `DATABASE_URL_DEV`, `TEST_DATABASE_URL`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `_DEV` variants for each host/port/name/user/password.
- API and realtime: `API_HOST`, `API_PORT`, `API_ADMIN_TOKEN`, `TEST_API_PORT`, `SOCKET_HOST`, `SOCKET_PORT`, `TEST_SOCKET_PORT`, `RANKED_HOST`, `RANKED_PORT`, `RANKED_INTERNAL_SECRET`, `RANKED_DISABLED`, `RANKED_ENTRY`, `RANKED_PUBLIC_URL`, `PORT`.
- Web/API origins and auth: `WEBSITE_URL`, `PUBLIC_API_URL`, `UNIFIED_API_URL`, `OAUTH_CALLBACK_BASE_URL`, `WEB_ALLOWED_ORIGINS`, `RANKED_ALLOWED_ORIGINS`, `SESSION_COOKIE_DOMAIN`, `JWT_SECRET_KEY`.
- Redis, Supabase, files: `REDIS_HOST`, `REDIS_PORT`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_KEY` (legacy alias), `SUPABASE_ANON_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_PRIVATE_STORAGE_BUCKET`, `SUPABASE_SIGNED_URL_TTL`, `RANKED_STORAGE_DIR`.
- Discord sync / cross-sync: `RG_DISCORD_SYNC_SQLITE_PATH`, `RG_DISCORD_SYNC_REDIS_URL`, `ACHILLEA_CROSS_SYNC_TARGETS`, `ACHILLEA_CROSS_SYNC_RECEIVE_SECRET`.
- Integrations: `IMGUR_CLIENT_ID`, `TWITCH_CLIENT_ID`, `TWITCH_SECRET`, `TWITCH_TOKENS_KEY`, `YOUTUBE_TOKENS_KEY`, `CHALLONGE_TOKENS_KEY`, `CHALLONGE_CLIENT_ID`, `CHALLONGE_CLIENT_ID_TEST`, `CHALLONGE_API_KEY`, `CHALLONGE_API_KEY_TEST`, `CHALLONGE_BASE_URL`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `GOOGLE_PLAYER_NOTES_DOC_ID`, `IMAGE_SERVER_API_KEY`, `IMAGE_SERVER_URL`, `SUPABASE_PRIVATE_STORAGE_BUCKET`.
- Scheduling/features: `SKIP_SCHEDULE`, `TOURNAMENT_MAX_LEAD_DAYS`, `TOURNAMENT_MIN_LEAD_DAYS`, `TOURNAMENT_MAX_OPEN_PER_ORG`, `ACHILLEA_STAFF_CHANNEL_ID`.

`rg-achillea-bot.service` additionally sets non-secret operational values: production mode, profile `current`, command guilds, host/ports, unified API URL, ranked entrypoint, and shared Discord-sync file path. Secrets come from `/etc/rose-griffon/rg-achillea-bot.env` and are not reproduced.

### Deployment

The infra unit runs `bun build/main.js` from `/srv/rg/current/apps/achillea-bot`, loads an external env file and uses systemd to supervise the parent plus ranked child (`KillMode=control-group`). It grants writable shared state only for Achilléa logs/storage and the shared Discord-sync directory. Restart policy is `always`; logs go to journald. Current service catalog identifies it as public because it owns HTTP upstreams; actual listeners bind loopback in the unit configuration.

## Source references

- `rg/AGENTS.md`, `rg/README.md`
- `rg/apps/bot/README.md`, `rg/apps/bot/package.json`, `rg/apps/bot/src/index.ts`, `rg/apps/bot/src/lib/{profil,config,db}.ts`
- `rg/apps/achillea-bot/README.md`, `rg/apps/achillea-bot/package.json`, `rg/apps/achillea-bot/src/{main.ts,client.ts,api/server.ts}`, `rg/apps/achillea-bot/src/configs/`, `rg/apps/achillea-bot/src/utils/types/environment.ts`, `rg/apps/achillea-bot/src/ranked/`
- `rg/docs/achillea-services.md`, `rg/docs/PROD-STATUS.md`
- [`config/service-catalog.json`](../../../../../config/service-catalog.json), [`systemd/rg-bot.service`](../../../../../systemd/rg-bot.service), [`systemd/rg-achillea-bot.service`](../../../../../systemd/rg-achillea-bot.service)
