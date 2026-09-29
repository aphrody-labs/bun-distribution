import { Migration } from "@mikro-orm/migrations";

export class Migration20251204093600 extends Migration {

  async up() {
    this.addSql(`alter table "blacklist" add column "reason" varchar(255) not null default '';`);
  }

  async down() {
    this.addSql(`alter table "blacklist" drop column "reason";`);
  }

}
