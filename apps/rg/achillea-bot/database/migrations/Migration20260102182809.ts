import { Migration } from "@mikro-orm/migrations";

export class Migration20260102182809 extends Migration {

  async up() {
    this.addSql(`alter table "event" add column "planning" varchar(255) null, add column "ruleset" varchar(255) null;`);
  }

  async down() {
    this.addSql(`alter table "event" drop column "planning", drop column "ruleset";`);
  }

}
