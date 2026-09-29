import { Migration } from "@mikro-orm/migrations";

export class Migration20251217230303 extends Migration {

  async up() {
    this.addSql(`create table "organization_validation" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" varchar(255) not null, "reviewer_id" varchar(255) not null, "name" varchar(255) null, "logo" varchar(255) null, "description" varchar(255) null, "twitter_url" varchar(255) null, "instagram_url" varchar(255) null, "tiktok_url" varchar(255) null, "twitch_url" varchar(255) null, "youtube_url" varchar(255) null, constraint "organization_validation_pkey" primary key ("id"));`);

    this.addSql(`alter table "organization_validation" add constraint "organization_validation_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "organization_validation" add constraint "organization_validation_reviewer_id_foreign" foreign key ("reviewer_id") references "user" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`drop table if exists "organization_validation" cascade;`);
  }

}
