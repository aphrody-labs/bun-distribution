import { Migration } from "@mikro-orm/migrations";

export class Migration20260115200624 extends Migration {

  async up() {
    this.addSql(`create table "tournament_series" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(255) not null, "description" varchar(1500) not null, "logo" varchar(255) not null, "organization_id" int not null);`);

    this.addSql(`alter table "tournament_series" add constraint "tournament_series_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade;`);

    this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);

    this.addSql(`alter table "event" drop constraint "event_challonge_id_unique";`);
    this.addSql(`alter table "event" drop column "challonge_id", drop column "url", drop column "game_name", drop column "format_options", drop column "registration_options", drop column "meta_options";`);

    this.addSql(`alter table "event" add column "series_id" int null, add column "participants_number" int null, add column "group_stage_type" text check ("group_stage_type" in ('double elimination', 'round robin', 'single elimination')) null, add column "affiche" varchar(255) null;`);
    this.addSql(`alter table "event" add constraint "event_series_id_foreign" foreign key ("series_id") references "tournament_series" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "event" add constraint "event_tournament_type_check" check("tournament_type" in ('double elimination', 'round robin', 'single elimination'));`);
  }

  async down() {
    this.addSql(`alter table "event" drop constraint "event_series_id_foreign";`);

    this.addSql(`drop table if exists "tournament_series" cascade;`);

    this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);

    this.addSql(`alter table "event" drop column "series_id", drop column "participants_number", drop column "group_stage_type";`);

    this.addSql(`alter table "event" add column "url" varchar(255) null, add column "game_name" varchar(255) null, add column "format_options" jsonb null, add column "registration_options" jsonb null, add column "meta_options" jsonb null;`);
    this.addSql(`alter table "event" add constraint "event_tournament_type_check" check("tournament_type" in ('double elimination', 'free for all', 'round robin', 'single elimination', 'swiss'));`);
    this.addSql(`alter table "event" rename column "affiche" to "challonge_id";`);
    this.addSql(`alter table "event" add constraint "event_challonge_id_unique" unique ("challonge_id");`);
  }

}
