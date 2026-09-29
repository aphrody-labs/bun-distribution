import { Migration } from "@mikro-orm/migrations";

export class Migration20251213201638 extends Migration {

  async up() {
    this.addSql(`alter table "user_notification" drop constraint "user_notification_notification_id_foreign";`);

    this.addSql(`alter table "notification" alter column "id" type int using ("id"::int);`);
    this.addSql(`create sequence if not exists "notification_id_seq";`);
    this.addSql(`select setval('notification_id_seq', (select max("id") from "notification"));`);
    this.addSql(`alter table "notification" alter column "id" set default nextval('notification_id_seq');`);

    this.addSql(`alter table "user_notification" alter column "id" type int using ("id"::int);`);
    this.addSql(`alter table "user_notification" alter column "notification_id" type int using ("notification_id"::int);`);
    this.addSql(`create sequence if not exists "user_notification_id_seq";`);
    this.addSql(`select setval('user_notification_id_seq', (select max("id") from "user_notification"));`);
    this.addSql(`alter table "user_notification" alter column "id" set default nextval('user_notification_id_seq');`);
    this.addSql(`alter table "user_notification" add constraint "user_notification_notification_id_foreign" foreign key ("notification_id") references "notification" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`alter table "user_notification" drop constraint "user_notification_notification_id_foreign";`);

    this.addSql(`alter table "notification" alter column "id" type varchar(255) using ("id"::varchar(255));`);
    this.addSql(`alter table "notification" alter column "id" drop default;`);

    this.addSql(`alter table "user_notification" alter column "id" type varchar(255) using ("id"::varchar(255));`);
    this.addSql(`alter table "user_notification" alter column "notification_id" type varchar(255) using ("notification_id"::varchar(255));`);
    this.addSql(`alter table "user_notification" alter column "id" drop default;`);
    this.addSql(`alter table "user_notification" add constraint "user_notification_notification_id_foreign" foreign key ("notification_id") references "notification" ("id") on update cascade;`);
  }

}
