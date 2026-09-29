import { Migration } from "@mikro-orm/migrations";

export class Migration20251201075805 extends Migration {

  async up() {
    this.addSql(`create table "organization_manager" ("organization_id" int not null, "user_id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "organization_manager_pkey" primary key ("organization_id", "user_id"));`);

    this.addSql(`create table "organization" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(255) not null, "normalized_name" varchar(255) not null, "logo" varchar(255) not null, "description" varchar(255) not null, "owner_id" varchar(255) not null, "state" smallint not null default 0, "preapproved" boolean not null default false, "preapproved_at" timestamptz null, "preapproved_by_id" varchar(255) null, "twitter_url" varchar(255) null, "instagram_url" varchar(255) null, "tiktok_url" varchar(255) null, "twitch_url" varchar(255) null, "youtube_url" varchar(255) null, "origin" varchar(255) not null, constraint "organization_pkey" primary key ("id"));`);

    this.addSql(`alter table "organization_manager" add constraint "organization_manager_organization_id_foreign" foreign key ("organization_id") references "clan" ("id") on update cascade;`);
    this.addSql(`alter table "organization_manager" add constraint "organization_manager_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);

    this.addSql(`alter table "organization" add constraint "organization_owner_id_foreign" foreign key ("owner_id") references "user" ("id") on update cascade;`);
    this.addSql(`alter table "organization" add constraint "organization_preapproved_by_id_foreign" foreign key ("preapproved_by_id") references "user" ("id") on update cascade on delete set null;`);
  }

  async down() {
    this.addSql(`drop table if exists "organization_manager" cascade;`);

    this.addSql(`drop table if exists "organization" cascade;`);
  }

}
