import { Migration } from "@mikro-orm/migrations";

export class Migration20251213194653 extends Migration {

  async up() {
    this.addSql(`create table "notification" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "title" varchar(255) not null, "message" varchar(255) not null, "type" smallint not null, "category" smallint not null, "payload" jsonb null, constraint "notification_pkey" primary key ("id"));`);

    this.addSql(`create table "user_notification" ("id" varchar(255) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "notification_id" varchar(255) not null, "user_id" varchar(255) not null, "is_read" boolean not null default false, "read_at" varchar(255) null, constraint "user_notification_pkey" primary key ("id"));`);
    this.addSql(`create index "user_notification_notification_id_index" on "user_notification" ("notification_id");`);
    this.addSql(`create index "user_notification_user_id_index" on "user_notification" ("user_id");`);

    this.addSql(`alter table "user_notification" add constraint "user_notification_notification_id_foreign" foreign key ("notification_id") references "notification" ("id") on update cascade;`);
    this.addSql(`alter table "user_notification" add constraint "user_notification_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`alter table "user_notification" drop constraint "user_notification_notification_id_foreign";`);

    this.addSql(`drop table if exists "notification" cascade;`);

    this.addSql(`drop table if exists "user_notification" cascade;`);
  }

}
