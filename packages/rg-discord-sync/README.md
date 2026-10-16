# Shared Discord snapshot

`@rosegriffon/discord-sync` mirrors Discord metadata visible to each bot into
one SQLite file. Set `RG_DISCORD_SYNC_SQLITE_PATH` to the **same absolute path**
for `rg-cron` and the Achilléa bot. If unset, the sync returns `null` and does
not create a local database. Set `RG_DISCORD_SYNC_REDIS_URL` (or `REDIS_URL`) to
cache the latest per-bot/per-guild sync report for one hour.

The `(source_bot_id, guild_id)` key keeps bot visibility separate. Member,
role, channel, active-thread, emoji, and scheduled-event metadata are kept by
source. `rg_discord_guild_presence` marks a bot leaving a guild without
deleting another bot's data. `rg_discord_sync_runs` records roster completeness;
a bot without the privileged GuildMembers intent can only snapshot cached
members. Optional collection fetches fall back to caches and their report flags
show incomplete coverage. Old rows remain historical: a successful run does
not claim a departed member or deleted channel is still live merely because an
old row exists. Consumers should filter by the run timestamp when displaying
current state.

This is a metadata mirror, not an authentication database. Better Auth and
PostgreSQL remain authoritative for accounts and OAuth links. The cron task
mirrors account-link IDs, provider IDs and timestamps into
`rg_oauth_account_links`, with a provider count in Redis. OAuth access,
refresh and ID tokens, Discord message bodies, DMs, audit logs, attachments,
and raw site telemetry are not copied into SQLite or Redis. The scheduled
`stats:achillea` task writes hourly host aggregates (requests, bytes, 4xx,
5xx) for the last 24 hours to `rg_site_telemetry` and a Redis summary.
`complete=0` means the 200,000-line source cap was reached. Obtaining raw
private data requires
separate consent, gateway intents or API permissions and retention rules.
