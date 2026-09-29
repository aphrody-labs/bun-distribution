import { Migration } from "@mikro-orm/migrations";

export class Migration20251109133014 extends Migration {

  async up() {
    this.addSql(`alter table "clan_invite" drop column "accepted";`);
  }

  async down() {
    this.addSql(`alter table "clan_invite" add column "accepted" boolean not null default false;`);
  }

}
