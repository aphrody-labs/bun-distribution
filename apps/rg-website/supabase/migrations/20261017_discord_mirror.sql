-- Miroir Discord partagé des bots — fin du fichier SQLite local.
--
-- `@rosegriffon/discord-sync` écrivait dans un `bun:sqlite` partagé
-- (`RG_DISCORD_SYNC_SQLITE_PATH`) et posait des résumés dans Redis. Une fonction
-- serverless n'a ni disque partagé ni Redis : le miroir vit désormais ici, dans
-- un schéma dédié, avec les mêmes tables et les mêmes colonnes, typées.
--
-- Ce n'est pas une base d'identité : aucun jeton OAuth, aucun corps de message,
-- aucune donnée privée. Better Auth et `public` restent la source applicative.
-- Le schéma n'est pas exposé par PostgREST : seuls les services serveur
-- (rôle `postgres`) y écrivent et y lisent.

begin;

create schema if not exists discord_mirror;
revoke all on schema discord_mirror from public, anon, authenticated;

create table if not exists discord_mirror.rg_discord_guilds (
  source_bot_id text not null,
  profile text not null,
  guild_id text not null,
  name text not null,
  icon_url text,
  description text,
  member_count integer,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id)
);

create table if not exists discord_mirror.rg_discord_members (
  source_bot_id text not null,
  guild_id text not null,
  member_id text not null,
  username text not null,
  global_name text,
  nickname text,
  avatar_url text,
  joined_at timestamptz,
  premium_since timestamptz,
  is_bot boolean not null,
  role_ids_json jsonb not null default '[]'::jsonb check (jsonb_typeof(role_ids_json) = 'array'),
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id, member_id)
);

create table if not exists discord_mirror.rg_discord_roles (
  source_bot_id text not null,
  guild_id text not null,
  role_id text not null,
  name text not null,
  color integer not null,
  position integer not null,
  permissions numeric(20, 0) not null,
  managed boolean not null,
  mentionable boolean not null,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id, role_id)
);

create table if not exists discord_mirror.rg_discord_channels (
  source_bot_id text not null,
  guild_id text not null,
  channel_id text not null,
  name text not null,
  type smallint not null,
  parent_id text,
  position integer,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id, channel_id)
);

create table if not exists discord_mirror.rg_discord_emojis (
  source_bot_id text not null,
  guild_id text not null,
  emoji_id text not null,
  name text,
  animated boolean not null,
  available boolean not null,
  url text not null,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id, emoji_id)
);

create table if not exists discord_mirror.rg_discord_events (
  source_bot_id text not null,
  guild_id text not null,
  event_id text not null,
  name text not null,
  description text,
  status smallint not null,
  entity_type smallint not null,
  starts_at timestamptz,
  ends_at timestamptz,
  channel_id text,
  location text,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id, event_id)
);

create table if not exists discord_mirror.rg_discord_sync_runs (
  source_bot_id text not null,
  guild_id text not null,
  profile text not null,
  member_count integer not null,
  role_count integer not null,
  channel_count integer not null,
  members_complete boolean not null,
  synced_at timestamptz not null,
  primary key (source_bot_id, guild_id)
);

create table if not exists discord_mirror.rg_discord_guild_presence (
  source_bot_id text not null,
  guild_id text not null,
  profile text not null,
  present boolean not null,
  changed_at timestamptz not null,
  primary key (source_bot_id, guild_id)
);

create table if not exists discord_mirror.rg_oauth_account_links (
  account_id text primary key,
  user_id text not null,
  provider_id text not null,
  provider_account_id text not null,
  linked_at timestamptz,
  updated_at timestamptz,
  active boolean not null,
  seen_at timestamptz not null
);

create index if not exists rg_oauth_account_links_actifs_idx
  on discord_mirror.rg_oauth_account_links (provider_id) where active;

create table if not exists discord_mirror.rg_site_telemetry (
  host text not null,
  window_start timestamptz not null,
  requests integer not null,
  bytes bigint not null,
  errors_4xx integer not null,
  errors_5xx integer not null,
  complete boolean not null,
  synced_at timestamptz not null,
  primary key (host, window_start)
);

create index if not exists rg_site_telemetry_window_idx on discord_mirror.rg_site_telemetry (window_start desc);

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'discord_mirror' loop
    execute format('alter table discord_mirror.%I enable row level security', t);
    execute format('revoke all on discord_mirror.%I from public, anon, authenticated', t);
  end loop;
end $$;

commit;
