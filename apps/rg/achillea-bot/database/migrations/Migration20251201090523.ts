import { Migration } from "@mikro-orm/migrations";

export class Migration20251201090523 extends Migration {

  async up() {
    this.addSql(`alter table "user" add column "avatar" varchar(255) null;`);
  }

  async down() {
    this.addSql(`alter table "user" drop column "avatar";`);
  }

}
