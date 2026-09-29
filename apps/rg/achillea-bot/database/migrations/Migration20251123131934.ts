import { Migration } from "@mikro-orm/migrations";

export class Migration20251123131934 extends Migration {

  async up() {
    this.addSql(`alter table "clan_application" add column "message_id" varchar(255) null;`);
  }

  async down() {
    this.addSql(`alter table "clan_application" drop column "message_id";`);
  }

}
