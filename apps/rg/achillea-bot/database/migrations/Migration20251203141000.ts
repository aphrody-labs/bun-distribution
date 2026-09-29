import { Migration } from "@mikro-orm/migrations";

export class Migration20251203141000 extends Migration {

  async up() {
    this.addSql(`alter table "user" add column "display_name" varchar(255) not null default '', add column "normalized_display_name" varchar(255) not null default '';`);
  }

  async down() {
    this.addSql(`alter table "user" drop column "display_name", drop column "normalized_display_name";`);
  }

}
