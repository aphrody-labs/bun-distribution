# Shared Discord snapshot

`@rosegriffon/discord-sync` mirrors Discord metadata visible to each bot into
the `discord_mirror` PostgreSQL schema (migration
`apps/rg-website/supabase/migrations/20261017_discord_mirror.sql`). It uses the
shared `@rosegriffon/db` Bun.sql factory, so every writer and reader reaches the
same database through `DATABASE_URL`; no local file, disk or Redis is involved,
which keeps it usable from serverless functions. The connection is opened
lazily on first use.

The `(source_bot_id, guild_id)` key keeps bot visibility separate. Member,
role, channel, active-thread, emoji, and scheduled-event metadata are kept by
source. `rg_discord_guild_presence` marks a bot leaving a guild without
deleting another bot's data. `rg_discord_sync_runs` records roster completeness;
the roster is listed over REST (`GET /guilds/{id}/members`), which requires the
privileged GuildMembers intent on the application, so a bot without it only
snapshots cached members. Optional collection fetches fall back to caches and
their report flags show incomplete coverage. Old rows remain historical: a
successful run does not claim a departed member or deleted channel is still
live merely because an old row exists. Consumers should filter by the run
timestamp when displaying current state.

Summaries are SQL queries over the mirror, not caches:
`discordSyncSummary(botId, guildId)` reads the latest run of a bot for a guild,
`oauthLinkSummary()` counts active links per provider and
`siteTelemetrySummary(hours)` totals site traffic over a window.

This is a metadata mirror, not an authentication database. Better Auth and
`public` remain authoritative for accounts and OAuth links. The cron task
mirrors account-link IDs, provider IDs and timestamps into
`rg_oauth_account_links`. OAuth access, refresh and ID tokens, Discord message
bodies, DMs, audit logs, attachments, and raw site telemetry are not copied into
the mirror. `syncSiteTelemetryAggregates` stores hourly host aggregates
(requests, bytes, 4xx, 5xx) in `rg_site_telemetry`; `complete=false` means the
source line cap was reached. The schema is not exposed through PostgREST and
its tables have row level security enabled without policies. Obtaining raw
private data requires separate consent, gateway intents or API permissions and
retention rules.
