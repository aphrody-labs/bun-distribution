import { Migration } from "@mikro-orm/migrations";

export class Migration20260102181642 extends Migration {

  async up() {
    this.addSql(`alter table "event" add column "logo" varchar(255) null;`);
  }

  async down() {
    this.addSql(`alter table "event" drop column "logo";`);
  }

}
