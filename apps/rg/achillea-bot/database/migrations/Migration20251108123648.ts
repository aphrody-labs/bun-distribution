import { Migration } from "@mikro-orm/migrations";

export class Migration20251108123648 extends Migration {

  async up() {
    this.addSql(`create table "blacklist" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "blacklist_pkey" primary key ("id"));`);

    this.addSql(`create table "data" ("key" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "value" varchar(255) not null default '', constraint "data_pkey" primary key ("key"));`);

    this.addSql(`create table "experience" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "level" int not null, "xp_required" int not null);`);
    this.addSql(`alter table "experience" add constraint "experience_level_unique" unique ("level");`);

    this.addSql(`create table "guild" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "prefix" varchar(255) null, "deleted" boolean not null default false, "last_interact" timestamptz not null, "broadcast_channel" varchar(255) null, "ranked_enabled" boolean not null default false, constraint "guild_pkey" primary key ("id"));`);

    this.addSql(`create table "clan" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "founders" text[] not null, "name" varchar(255) not null, "role_id" varchar(255) not null, "shortened_name" varchar(255) not null, "clan_avatar_url" varchar(255) not null, "clan_biography" varchar(1500) not null, "x_url" varchar(255) null, "instagram_url" varchar(255) null, "tiktok_url" varchar(255) null, "clan_fame" int not null default 0, "guild_id" varchar(255) null, "is_recruiting" boolean not null default false, "is_inactive" boolean not null default false, "is_hidden" boolean not null default false, "is_disbanded" boolean not null default false, "auto_accept_members" boolean not null default false, "state" smallint not null, "channel_id" varchar(255) not null, "normalized_short_name" varchar(255) not null default '', "clan_emoji_id" varchar(255) not null default '', "languages" text[] not null default '{}', "origin" varchar(255) not null default '', "under_member_limit" boolean not null default false);`);
    this.addSql(`alter table "clan" add constraint "clan_name_unique" unique ("name");`);
    this.addSql(`alter table "clan" add constraint "clan_role_id_unique" unique ("role_id");`);
    this.addSql(`alter table "clan" add constraint "clan_shortened_name_unique" unique ("shortened_name");`);
    this.addSql(`alter table "clan" add constraint "clan_clan_avatar_url_unique" unique ("clan_avatar_url");`);
    this.addSql(`alter table "clan" add constraint "clan_guild_id_unique" unique ("guild_id");`);

    this.addSql(`create table "event" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(255) not null, "description" varchar(1500) not null, "type" text check ("type" in ('TOURNAMENT', 'INTERCLAN', 'RANKED')) not null, "status" text check ("status" in ('Open', 'Locked', 'Validating presence', 'Pairing', 'Validating start', 'Repooling', 'Matching', 'Finished', 'Canceled')) null default 'Open', "queue_ends_at" timestamptz null, "mode" smallint null default 2, "clan_a_id" int null, "clan_b_id" int null, "winner_clan_id" varchar(255) null, "state" int null default 0, "fixed_date" timestamptz null, "discord_channel_id" varchar(255) null);`);
    this.addSql(`create index "event_type_index" on "event" ("type");`);

    this.addSql(`create table "event_announcement" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "event_id" int not null, "guild_id" varchar(255) not null, "channel_id" varchar(255) not null, "message_id" varchar(255) not null);`);

    this.addSql(`create table "clan_experience_log" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "clan_id" int not null, "reason" varchar(255) not null default '', "xp_change" int not null default 0);`);

    this.addSql(`create table "clan_experience" ("clan_id" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "current_level" int not null default 1, "total_xp" int not null default 0, constraint "clan_experience_pkey" primary key ("clan_id"));`);

    this.addSql(`create table "image" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "file_name" varchar(255) not null, "base_path" varchar(255) not null default '', "url" varchar(255) not null, "size" int not null, "tags" text[] not null, "hash" varchar(255) not null, "delete_hash" varchar(255) not null);`);

    this.addSql(`create table "interclan_lineup" ("id" serial primary key, "event_id" int not null, "clan_id" int not null, "locked_in" boolean not null default false);`);

    this.addSql(`create table "oauth_csrf" ("token" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "discord_id" varchar(255) not null, constraint "oauth_csrf_pkey" primary key ("token"));`);

    this.addSql(`create table "rank" ("id" serial primary key, "key" varchar(255) not null, "min_elo" int not null, "max_elo" int not null, "emoji_id" varchar(255) not null, "emoji_key" varchar(255) not null default '', "gradient" text[] not null default '{}');`);

    this.addSql(`create table "stat" ("id" serial primary key, "type" varchar(255) not null, "value" varchar(255) not null default '', "additional_data" jsonb null, "created_at" timestamptz not null);`);

    this.addSql(`create table "user" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "last_interact" timestamptz not null, "role" smallint not null default 0, "username" varchar(255) null, constraint "user_pkey" primary key ("id"));`);

    this.addSql(`create table "ranked_queue_entry" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "ranked_id" int not null, "validated_presence" boolean not null default false);`);

    this.addSql(`create table "lobby" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "event_type" text check ("event_type" in ('TOURNAMENT', 'INTERCLAN', 'RANKED')) not null, "event_id" int not null, "mode" smallint not null default 2, "state" text check ("state" in ('Fresh', 'Ongoing', 'Pending validation', 'Contested', 'Finished', 'Canceled', 'Forfeited')) not null default 'Fresh', "challonge_id" varchar(255) null, "channel_id" varchar(255) null, "host_user_id" int null, "is_repool" boolean not null default false);`);

    this.addSql(`create table "lobby_user" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "lobby_id" int not null, "team" smallint not null default 1, "score" int not null default 0, "forfeit" boolean not null default false, "elo_variation" int not null default 0, "challonge_id" varchar(255) null, "validated_result" boolean not null default false, "state" text check ("state" in ('Pending', 'Ready', 'Afk', 'Ongoing', 'Finished', 'Repooled')) not null default 'Pending');`);
    this.addSql(`alter table "lobby_user" add constraint "lobby_user_user_id_lobby_id_unique" unique ("user_id", "lobby_id");`);

    this.addSql(`create table "interclan_lineup_member" ("id" serial primary key, "lineup_id" int not null, "user_id" varchar(255) not null, "position" int not null);`);

    this.addSql(`create table "clan_member_history" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "clan_id" int not null, "join_date" timestamptz not null, "leave_reason" smallint not null, "kick_reason" varchar(255) null, "fame_contributed" int not null default 0, "role" smallint not null);`);

    this.addSql(`create table "clan_member" ("clan_id" int not null, "user_id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "clan_fame_contributed" int not null default 0, "role" smallint not null default 0, "distinctions" text[] not null default '{}', constraint "clan_member_pkey" primary key ("clan_id", "user_id"));`);

    this.addSql(`create table "clan_team" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "clan_id" int not null, "name" varchar(255) not null, "type" smallint not null, "captain_id" int null);`);

    this.addSql(`create table "clan_team_member" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "team_id" int not null, "member_clan_id" int not null, "member_user_id" varchar(255) not null, "role" smallint not null default 0, "added_by_id" varchar(255) not null);`);
    this.addSql(`alter table "clan_team_member" add constraint "clan_team_member_member_clan_id_member_user_id_unique" unique ("member_clan_id", "member_user_id");`);

    this.addSql(`create table "clan_invite" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "clan_id" int not null, "inviter_id" varchar(255) not null, "thread_id" varchar(255) null, "distinctions" text[] not null default '{}');`);

    this.addSql(`create table "clan_application" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "clan_id" int not null, "distinctions" text[] not null default '{}');`);

    this.addSql(`create table "user_connection" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "provider" text check ("provider" in ('twitch', 'challonge', 'youtube')) not null, "external_id" varchar(255) null, "external_username" varchar(255) null, "access_token" text null, "refresh_token" text null);`);
    this.addSql(`alter table "user_connection" add constraint "user_connection_user_id_provider_unique" unique ("user_id", "provider");`);

    this.addSql(`create table "user_elo" ("user_id" varchar(255) not null, "mode" smallint not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "elo" int not null default 0, constraint "user_elo_pkey" primary key ("user_id", "mode"));`);

    this.addSql(`create table "user_experience" ("user_id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "current_level" int not null default 1, "total_xp" int not null default 0, constraint "user_experience_pkey" primary key ("user_id"));`);

    this.addSql(`create table "user_experience_log" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" varchar(255) not null, "reason" varchar(255) not null default '', "xp_change" int not null default 0);`);

    this.addSql(`create table "vote_proposal" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "type" text check ("type" in ('CLAN_CREATION', 'CLAN_APPROVAL', 'RANKED_RECLAMATION', 'TOURNAMENT_APPEAL', 'INTERCLAN_VALIDATION')) not null, "target_entity_type" varchar(255) not null, "target_entity_id" int not null, "reason" varchar(255) not null, "closed_at" date null, "status" text check ("status" in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')) not null default 'PENDING', "strategy" text check ("strategy" in ('UNANIMOUS', 'MAJORITY', 'SUPERMAJORITY_2_3')) not null default 'MAJORITY', "min_participation_ratio" int not null default 1, "expires_at" timestamptz not null);`);

    this.addSql(`create table "vote_proposal_eligible_voters" ("vote_proposal_id" int not null, "user_id" varchar(255) not null, constraint "vote_proposal_eligible_voters_pkey" primary key ("vote_proposal_id", "user_id"));`);

    this.addSql(`create table "vote" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "proposal_id" int not null, "voter_id" varchar(255) not null, "vote" text check ("vote" in ('APPROVE', 'REJECT')) not null);`);

    this.addSql(`alter table "clan" add constraint "clan_guild_id_foreign" foreign key ("guild_id") references "guild" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "event" add constraint "event_clan_a_id_foreign" foreign key ("clan_a_id") references "clan" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "event" add constraint "event_clan_b_id_foreign" foreign key ("clan_b_id") references "clan" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "event_announcement" add constraint "event_announcement_event_id_foreign" foreign key ("event_id") references "event" ("id") on update cascade;`);

    this.addSql(`alter table "clan_experience_log" add constraint "clan_experience_log_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "clan_experience" add constraint "clan_experience_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "interclan_lineup" add constraint "interclan_lineup_event_id_foreign" foreign key ("event_id") references "event" ("id") on update cascade;`);
    this.addSql(`alter table "interclan_lineup" add constraint "interclan_lineup_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade;`);

    this.addSql(`alter table "ranked_queue_entry" add constraint "ranked_queue_entry_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "ranked_queue_entry" add constraint "ranked_queue_entry_ranked_id_foreign" foreign key ("ranked_id") references "event" ("id") on update cascade;`);

    this.addSql(`alter table "lobby" add constraint "lobby_event_id_foreign" foreign key ("event_id") references "event" ("id") on update cascade;`);
    this.addSql(`alter table "lobby" add constraint "lobby_host_user_id_foreign" foreign key ("host_user_id") references "lobby_user" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "lobby_user" add constraint "lobby_user_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "lobby_user" add constraint "lobby_user_lobby_id_foreign" foreign key ("lobby_id") references "lobby" ("id") on update cascade;`);

    this.addSql(`alter table "interclan_lineup_member" add constraint "interclan_lineup_member_lineup_id_foreign" foreign key ("lineup_id") references "interclan_lineup" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "interclan_lineup_member" add constraint "interclan_lineup_member_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);

    this.addSql(`alter table "clan_member_history" add constraint "clan_member_history_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "clan_member_history" add constraint "clan_member_history_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade;`);

    this.addSql(`alter table "clan_member" add constraint "clan_member_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade;`);
    this.addSql(`alter table "clan_member" add constraint "clan_member_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);

    this.addSql(`alter table "clan_team" add constraint "clan_team_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "clan_team" add constraint "clan_team_captain_id_foreign" foreign key ("captain_id") references "clan_team_member" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "clan_team_member" add constraint "clan_team_member_team_id_foreign" foreign key ("team_id") references "clan_team" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "clan_team_member" add constraint "clan_team_member_member_clan_id_member_user_id_foreign" foreign key ("member_clan_id", "member_user_id") references "clan_member" ("clan_id", "user_id") on update cascade on delete cascade;`);
    this.addSql(`alter table "clan_team_member" add constraint "clan_team_member_added_by_id_foreign" foreign key ("added_by_id") references "user" ("id") on update cascade;`);

    this.addSql(`alter table "clan_invite" add constraint "clan_invite_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "clan_invite" add constraint "clan_invite_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade;`);
    this.addSql(`alter table "clan_invite" add constraint "clan_invite_inviter_id_foreign" foreign key ("inviter_id") references "user" ("id") on update cascade;`);

    this.addSql(`alter table "clan_application" add constraint "clan_application_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "clan_application" add constraint "clan_application_clan_id_foreign" foreign key ("clan_id") references "clan" ("id") on update cascade;`);

    this.addSql(`alter table "user_connection" add constraint "user_connection_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "user_elo" add constraint "user_elo_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "user_experience" add constraint "user_experience_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "user_experience_log" add constraint "user_experience_log_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "vote_proposal_eligible_voters" add constraint "vote_proposal_eligible_voters_vote_proposal_id_foreign" foreign key ("vote_proposal_id") references "vote_proposal" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "vote_proposal_eligible_voters" add constraint "vote_proposal_eligible_voters_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "vote" add constraint "vote_proposal_id_foreign" foreign key ("proposal_id") references "vote_proposal" ("id") on update cascade;`);
    this.addSql(`alter table "vote" add constraint "vote_voter_id_foreign" foreign key ("voter_id") references "user" ("id") on update cascade;`);
  }

}
