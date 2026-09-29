import { Migration } from "@mikro-orm/migrations";

export class Migration20260102125327 extends Migration {

  async up() {
    this.addSql(`create table "event_managers" ("event_id" int not null, "user_id" varchar(255) not null, constraint "event_managers_pkey" primary key ("event_id", "user_id"));`);

    this.addSql(`alter table "event_managers" add constraint "event_managers_event_id_foreign" foreign key ("event_id") references "event" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "event_managers" add constraint "event_managers_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "event" add column "challonge_id" varchar(255) null, add column "internal_state" text check ("internal_state" in ('Pending', 'Preparing', 'Ongoing', 'Finished', 'Canceled')) null default 'Pending', add column "organization_id" int null, add column "url" varchar(255) null, add column "tournament_type" text check ("tournament_type" in ('double elimination', 'free for all', 'round robin', 'single elimination', 'swiss')) null, add column "starts_at" timestamptz null, add column "grand_final_at" timestamptz null, add column "group_stage_enabled" boolean null default false, add column "game_name" varchar(255) null, add column "format_options" jsonb null, add column "registration_options" jsonb null, add column "meta_options" jsonb null;`);
    this.addSql(`alter table "event" add constraint "event_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "event" add constraint "event_challonge_id_unique" unique ("challonge_id");`);
  }

  async down() {
    this.addSql(`drop table if exists "event_managers" cascade;`);

    this.addSql(`alter table "event" drop constraint "event_organization_id_foreign";`);

    this.addSql(`alter table "event" drop constraint "event_challonge_id_unique";`);
    this.addSql(`alter table "event" drop column "challonge_id", drop column "internal_state", drop column "organization_id", drop column "url", drop column "tournament_type", drop column "starts_at", drop column "grand_final_at", drop column "group_stage_enabled", drop column "game_name", drop column "format_options", drop column "registration_options", drop column "meta_options";`);
  }

}
