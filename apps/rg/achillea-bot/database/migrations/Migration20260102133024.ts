import { Migration } from "@mikro-orm/migrations";

export class Migration20260102133024 extends Migration {

  async up() {
    this.addSql(`alter table "event" add column "organization_id" int null;`);
    this.addSql(`alter table "event" add constraint "event_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade on delete set null;`);
  }

  async down() {
    this.addSql(`alter table "event" drop constraint "event_organization_id_foreign";`);

    this.addSql(`alter table "event" drop column "organization_id";`);
  }

}
