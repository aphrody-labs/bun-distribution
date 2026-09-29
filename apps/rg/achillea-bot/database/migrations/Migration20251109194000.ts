import { Migration } from "@mikro-orm/migrations";

export class Migration20251109194000 extends Migration {

  async up() {
    this.addSql(`alter table "clan" add column "normalized_name" varchar(255) not null default '';`);
  }

  async down() {
    this.addSql(`alter table "clan" drop column "normalized_name";`);
  }

}
