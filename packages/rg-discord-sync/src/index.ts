import type { SQL } from "bun";
import type { Guild, GuildMember } from "discord.js";
import { createBunSql } from "@rosegriffon/db/bun-sql";

// discord.js GatewayIntentBits.GuildMembers (bit 1); keep the mirror loadable
// without loading a second Discord runtime in cron or the legacy bot.
const GUILD_MEMBERS_INTENT = 1 << 1;

/** Discord REST page size for `GET /guilds/{id}/members`. */
const MEMBER_PAGE_SIZE = 1000;

export interface DiscordSnapshotSource {
  sourceBotId: string;
  profile: string;
}

export interface DiscordGuildSnapshotReport {
  guildId: string;
  memberCount: number;
  roleCount: number;
  channelCount: number;
  emojiCount: number;
  eventCount: number;
  activeThreadCount: number;
  membersComplete: boolean;
  emojisComplete: boolean;
  eventsComplete: boolean;
  activeThreadsComplete: boolean;
  syncedAt: string;
}

let mirrorSql: SQL | null = null;

/**
 * The shared bot mirror lives in the `discord_mirror` PostgreSQL schema. This
 * is not an identity store: OAuth credentials, message bodies and private user
 * data are deliberately outside its schema. `public` remains the application
 * source. The connection is lazy so importing the package opens no socket.
 */
export function discordMirrorSql(): SQL {
  mirrorSql ??= createBunSql();
  return mirrorSql;
}

// Row batches are bound as one JSON text and expanded with `jsonb_to_recordset`:
// a single statement per collection, whatever the guild size. The explicit
// `::text::jsonb` matters — Bun.sql binds a JS array of objects as a PostgreSQL
// array literal, not as JSON.

/** Overrides the mirror connection (one-shot imports, alternate databases). */
export function useDiscordMirrorSql(sql: SQL | null): void {
  mirrorSql = sql;
}

/** Better Auth link metadata only. Credential columns are intentionally excluded. */
export interface OAuthLinkMetadata {
  id: string;
  userId: string;
  providerId: string;
  providerAccountId: string;
  linkedAt: string | null;
  updatedAt: string | null;
}

export interface SiteTelemetryAggregate {
  host: string;
  windowStart: string;
  requests: number;
  bytes: number;
  errors4xx: number;
  errors5xx: number;
}

/** Hourly aggregate only: no IP, URL query, cookie or visitor identifier. */
export async function syncSiteTelemetryAggregates(
  rows: readonly SiteTelemetryAggregate[],
  complete: boolean,
): Promise<number> {
  if (rows.length === 0) return 0;
  const syncedAt = new Date().toISOString();
  const payload = rows.map(row => ({
    host: row.host,
    window_start: row.windowStart,
    requests: row.requests,
    bytes: row.bytes,
    errors_4xx: row.errors4xx,
    errors_5xx: row.errors5xx,
  }));
  await discordMirrorSql()`
    INSERT INTO discord_mirror.rg_site_telemetry
      (host, window_start, requests, bytes, errors_4xx, errors_5xx, complete, synced_at)
    SELECT r.host, r.window_start, r.requests, r.bytes, r.errors_4xx, r.errors_5xx,
           ${complete}, ${syncedAt}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::text::jsonb) AS r(
        host text, window_start timestamptz, requests integer, bytes bigint, errors_4xx integer, errors_5xx integer
      )
    ON CONFLICT (host, window_start) DO UPDATE SET
      requests = excluded.requests, bytes = excluded.bytes, errors_4xx = excluded.errors_4xx,
      errors_5xx = excluded.errors_5xx, complete = excluded.complete, synced_at = excluded.synced_at`;
  return rows.length;
}

/** Site traffic over the last `hours` hours — replaces the former Redis summary. */
export async function siteTelemetrySummary(
  hours = 24,
): Promise<{ hours: number; requests: number; complete: boolean; syncedAt: string | null }> {
  const [row] = await discordMirrorSql()`
    SELECT count(DISTINCT window_start)::int AS hours,
           coalesce(sum(requests), 0)::bigint AS requests,
           coalesce(bool_and(complete), true) AS complete,
           max(synced_at) AS synced_at
      FROM discord_mirror.rg_site_telemetry
     WHERE window_start >= now() - (${hours}::int * interval '1 hour')`;
  return {
    hours: Number(row?.hours ?? 0),
    requests: Number(row?.requests ?? 0),
    complete: Boolean(row?.complete ?? true),
    syncedAt: row?.synced_at ? new Date(row.synced_at).toISOString() : null,
  };
}

export async function syncOAuthLinkMetadata(rows: readonly OAuthLinkMetadata[]): Promise<number> {
  const seenAt = new Date().toISOString();
  const payload = rows.map(row => ({
    account_id: row.id,
    user_id: row.userId,
    provider_id: row.providerId,
    provider_account_id: row.providerAccountId,
    linked_at: row.linkedAt,
    updated_at: row.updatedAt,
  }));
  await discordMirrorSql().begin(async tx => {
    if (payload.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_oauth_account_links
          (account_id, user_id, provider_id, provider_account_id, linked_at, updated_at, active, seen_at)
        SELECT r.account_id, r.user_id, r.provider_id, r.provider_account_id, r.linked_at, r.updated_at,
               true, ${seenAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(payload)}::text::jsonb) AS r(
            account_id text, user_id text, provider_id text, provider_account_id text,
            linked_at timestamptz, updated_at timestamptz
          )
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = excluded.user_id, provider_id = excluded.provider_id,
          provider_account_id = excluded.provider_account_id, linked_at = excluded.linked_at,
          updated_at = excluded.updated_at, active = true, seen_at = excluded.seen_at`;
    await tx`UPDATE discord_mirror.rg_oauth_account_links SET active = false WHERE seen_at <> ${seenAt}::timestamptz`;
  });
  return rows.length;
}

/** Active OAuth links per provider — replaces the former Redis summary. */
export async function oauthLinkSummary(): Promise<{
  total: number;
  counts: { provider_id: string; count: number }[];
  syncedAt: string | null;
}> {
  const counts = (await discordMirrorSql()`
    SELECT provider_id, count(*)::int AS count
      FROM discord_mirror.rg_oauth_account_links
     WHERE active
     GROUP BY provider_id
     ORDER BY provider_id`) as { provider_id: string; count: number }[];
  const [last] = await discordMirrorSql()`SELECT max(seen_at) AS seen_at FROM discord_mirror.rg_oauth_account_links`;
  return {
    total: counts.reduce((sum, row) => sum + Number(row.count), 0),
    counts: counts.map(row => ({ provider_id: row.provider_id, count: Number(row.count) })),
    syncedAt: last?.seen_at ? new Date(last.seen_at).toISOString() : null,
  };
}

/** Latest snapshot report of one bot for one guild — replaces the former Redis summary. */
export async function discordSyncSummary(
  sourceBotId: string,
  guildId: string,
): Promise<{
  guildId: string;
  profile: string;
  memberCount: number;
  roleCount: number;
  channelCount: number;
  membersComplete: boolean;
  syncedAt: string;
} | null> {
  const [row] = await discordMirrorSql()`
    SELECT guild_id, profile, member_count, role_count, channel_count, members_complete, synced_at
      FROM discord_mirror.rg_discord_sync_runs
     WHERE source_bot_id = ${sourceBotId} AND guild_id = ${guildId}`;
  if (!row) return null;
  return {
    guildId: row.guild_id,
    profile: row.profile,
    memberCount: Number(row.member_count),
    roleCount: Number(row.role_count),
    channelCount: Number(row.channel_count),
    membersComplete: Boolean(row.members_complete),
    syncedAt: new Date(row.synced_at).toISOString(),
  };
}

/** A guild departure affects only the bot identity that observed it. */
export async function markDiscordGuildLeft(source: DiscordSnapshotSource, guildId: string): Promise<void> {
  await discordMirrorSql()`
    INSERT INTO discord_mirror.rg_discord_guild_presence (source_bot_id, guild_id, profile, present, changed_at)
    VALUES (${source.sourceBotId}, ${guildId}, ${source.profile}, false, now())
    ON CONFLICT (source_bot_id, guild_id) DO UPDATE SET
      profile = excluded.profile, present = false, changed_at = excluded.changed_at`;
}

/**
 * Complete roster through REST (`GET /guilds/{id}/members`, paginated by id).
 * Works without a gateway session; Discord answers 403 when the application
 * lacks the privileged GuildMembers intent, which keeps completeness honest.
 */
export async function listGuildMembers(guild: Guild): Promise<Map<string, GuildMember>> {
  const members = new Map<string, GuildMember>();
  let after: string | undefined;
  for (;;) {
    const page = await guild.members.list({ limit: MEMBER_PAGE_SIZE, after });
    for (const [id, member] of page) members.set(id, member);
    if (page.size < MEMBER_PAGE_SIZE) return members;
    after = page.lastKey();
  }
}

interface ChannelRow {
  channel_id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number | null;
}

function memberRow(member: GuildMember, sourceBotId: string) {
  return {
    member_id: member.id,
    username: member.user.username,
    global_name: member.user.globalName ?? null,
    nickname: member.nickname ?? null,
    avatar_url:
      member.avatarURL({ size: 256, extension: "webp" }) ?? member.user.avatarURL({ size: 256, extension: "webp" }),
    joined_at: member.joinedAt?.toISOString() ?? null,
    premium_since: member.premiumSince?.toISOString() ?? null,
    is_bot: member.user.bot,
    role_ids_json: [...member.roles.cache.keys()].filter(id => id !== member.guild.id),
    source_bot_id: sourceBotId,
  };
}

export async function syncDiscordGuildSnapshot(
  guild: Guild,
  source: DiscordSnapshotSource,
  options: { members?: ReadonlyMap<string, GuildMember>; membersComplete?: boolean } = {},
): Promise<DiscordGuildSnapshotReport> {
  const [roles, channels, emojiResult, eventResult, threadResult] = await Promise.all([
    guild.roles.fetch(),
    guild.channels.fetch(),
    guild.emojis
      .fetch()
      .then(value => ({ value, complete: true }))
      .catch(() => ({ value: guild.emojis.cache, complete: false })),
    guild.scheduledEvents
      .fetch()
      .then(value => ({ value, complete: true }))
      .catch(() => ({ value: guild.scheduledEvents.cache, complete: false })),
    guild.channels
      .fetchActiveThreads()
      .then(value => ({ value: value.threads, complete: true }))
      .catch(() => ({ value: guild.channels.cache.filter(channel => channel.isThread()), complete: false })),
  ]);
  // A missing GuildMembers intent cannot be treated as a complete roster.
  const hasMembersIntent = guild.client.options.intents.has(GUILD_MEMBERS_INTENT);
  let members: ReadonlyMap<string, GuildMember> = options.members ?? guild.members.cache;
  let membersComplete = false;
  if (options.members) {
    membersComplete = hasMembersIntent && options.membersComplete === true;
  } else if (hasMembersIntent) {
    try {
      members = await listGuildMembers(guild);
      membersComplete = true;
    } catch (error) {
      console.warn(
        "[discord-sync] member roster unavailable for",
        guild.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const syncedAt = new Date().toISOString();
  const bot = source.sourceBotId;
  const report: DiscordGuildSnapshotReport = {
    guildId: guild.id,
    memberCount: members.size,
    roleCount: roles.size,
    channelCount: channels.size,
    emojiCount: emojiResult.value.size,
    eventCount: eventResult.value.size,
    activeThreadCount: threadResult.value.size,
    membersComplete,
    emojisComplete: emojiResult.complete,
    eventsComplete: eventResult.complete,
    activeThreadsComplete: threadResult.complete,
    syncedAt,
  };

  const memberRows = [...members.values()].map(member => memberRow(member, bot));
  const roleRows = [...roles.values()].map(role => ({
    role_id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    managed: role.managed,
    mentionable: role.mentionable,
  }));
  const channelRows: ChannelRow[] = [];
  for (const channel of channels.values())
    if (channel)
      channelRows.push({
        channel_id: channel.id,
        name: channel.name,
        type: channel.type,
        parent_id: channel.parentId,
        position: channel.position,
      });
  for (const thread of threadResult.value.values())
    if (thread)
      channelRows.push({
        channel_id: thread.id,
        name: thread.name,
        type: thread.type,
        parent_id: thread.parentId,
        position: null,
      });
  const emojiRows = [...emojiResult.value.values()].map(emoji => ({
    emoji_id: emoji.id,
    name: emoji.name,
    animated: Boolean(emoji.animated),
    available: Boolean(emoji.available),
    url: emoji.imageURL(),
  }));
  const eventRows = [...eventResult.value.values()].map(event => ({
    event_id: event.id,
    name: event.name,
    description: event.description,
    status: event.status,
    entity_type: event.entityType,
    starts_at: event.scheduledStartAt?.toISOString() ?? null,
    ends_at: event.scheduledEndAt?.toISOString() ?? null,
    channel_id: event.channelId,
    location: event.entityMetadata?.location ?? null,
  }));
  const memberCount = guild.memberCount ?? guild.approximateMemberCount ?? null;

  await discordMirrorSql().begin(async tx => {
    await tx`
      INSERT INTO discord_mirror.rg_discord_guilds
        (source_bot_id, profile, guild_id, name, icon_url, description, member_count, synced_at)
      VALUES (${bot}, ${source.profile}, ${guild.id}, ${guild.name}, ${guild.iconURL()}, ${guild.description},
              ${memberCount}, ${syncedAt}::timestamptz)
      ON CONFLICT (source_bot_id, guild_id) DO UPDATE SET
        profile = excluded.profile, name = excluded.name, icon_url = excluded.icon_url,
        description = excluded.description, member_count = excluded.member_count, synced_at = excluded.synced_at`;
    if (memberRows.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_discord_members
          (source_bot_id, guild_id, member_id, username, global_name, nickname, avatar_url, joined_at,
           premium_since, is_bot, role_ids_json, synced_at)
        SELECT ${bot}, ${guild.id}, r.member_id, r.username, r.global_name, r.nickname, r.avatar_url, r.joined_at,
               r.premium_since, r.is_bot, r.role_ids_json, ${syncedAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(memberRows)}::text::jsonb) AS r(
            member_id text, username text, global_name text, nickname text, avatar_url text,
            joined_at timestamptz, premium_since timestamptz, is_bot boolean, role_ids_json jsonb
          )
        ON CONFLICT (source_bot_id, guild_id, member_id) DO UPDATE SET
          username = excluded.username, global_name = excluded.global_name, nickname = excluded.nickname,
          avatar_url = excluded.avatar_url, joined_at = excluded.joined_at, premium_since = excluded.premium_since,
          is_bot = excluded.is_bot, role_ids_json = excluded.role_ids_json, synced_at = excluded.synced_at`;
    if (roleRows.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_discord_roles
          (source_bot_id, guild_id, role_id, name, color, position, permissions, managed, mentionable, synced_at)
        SELECT ${bot}, ${guild.id}, r.role_id, r.name, r.color, r.position, r.permissions::numeric, r.managed,
               r.mentionable, ${syncedAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(roleRows)}::text::jsonb) AS r(
            role_id text, name text, color integer, position integer, permissions text, managed boolean,
            mentionable boolean
          )
        ON CONFLICT (source_bot_id, guild_id, role_id) DO UPDATE SET
          name = excluded.name, color = excluded.color, position = excluded.position,
          permissions = excluded.permissions, managed = excluded.managed, mentionable = excluded.mentionable,
          synced_at = excluded.synced_at`;
    if (channelRows.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_discord_channels
          (source_bot_id, guild_id, channel_id, name, type, parent_id, position, synced_at)
        SELECT ${bot}, ${guild.id}, r.channel_id, r.name, r.type, r.parent_id, r.position, ${syncedAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(channelRows)}::text::jsonb) AS r(
            channel_id text, name text, type smallint, parent_id text, position integer
          )
        ON CONFLICT (source_bot_id, guild_id, channel_id) DO UPDATE SET
          name = excluded.name, type = excluded.type, parent_id = excluded.parent_id,
          position = excluded.position, synced_at = excluded.synced_at`;
    if (emojiRows.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_discord_emojis
          (source_bot_id, guild_id, emoji_id, name, animated, available, url, synced_at)
        SELECT ${bot}, ${guild.id}, r.emoji_id, r.name, r.animated, r.available, r.url, ${syncedAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(emojiRows)}::text::jsonb) AS r(
            emoji_id text, name text, animated boolean, available boolean, url text
          )
        ON CONFLICT (source_bot_id, guild_id, emoji_id) DO UPDATE SET
          name = excluded.name, animated = excluded.animated, available = excluded.available,
          url = excluded.url, synced_at = excluded.synced_at`;
    if (eventRows.length > 0)
      await tx`
        INSERT INTO discord_mirror.rg_discord_events
          (source_bot_id, guild_id, event_id, name, description, status, entity_type, starts_at, ends_at,
           channel_id, location, synced_at)
        SELECT ${bot}, ${guild.id}, r.event_id, r.name, r.description, r.status, r.entity_type, r.starts_at,
               r.ends_at, r.channel_id, r.location, ${syncedAt}::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(eventRows)}::text::jsonb) AS r(
            event_id text, name text, description text, status smallint, entity_type smallint,
            starts_at timestamptz, ends_at timestamptz, channel_id text, location text
          )
        ON CONFLICT (source_bot_id, guild_id, event_id) DO UPDATE SET
          name = excluded.name, description = excluded.description, status = excluded.status,
          entity_type = excluded.entity_type, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          channel_id = excluded.channel_id, location = excluded.location, synced_at = excluded.synced_at`;
    await tx`
      INSERT INTO discord_mirror.rg_discord_sync_runs
        (source_bot_id, guild_id, profile, member_count, role_count, channel_count, members_complete, synced_at)
      VALUES (${bot}, ${guild.id}, ${source.profile}, ${report.memberCount}, ${report.roleCount},
              ${report.channelCount}, ${report.membersComplete}, ${syncedAt}::timestamptz)
      ON CONFLICT (source_bot_id, guild_id) DO UPDATE SET
        profile = excluded.profile, member_count = excluded.member_count, role_count = excluded.role_count,
        channel_count = excluded.channel_count, members_complete = excluded.members_complete,
        synced_at = excluded.synced_at`;
    await tx`
      INSERT INTO discord_mirror.rg_discord_guild_presence (source_bot_id, guild_id, profile, present, changed_at)
      VALUES (${bot}, ${guild.id}, ${source.profile}, true, ${syncedAt}::timestamptz)
      ON CONFLICT (source_bot_id, guild_id) DO UPDATE SET
        profile = excluded.profile, present = true, changed_at = excluded.changed_at`;
  });
  return report;
}
