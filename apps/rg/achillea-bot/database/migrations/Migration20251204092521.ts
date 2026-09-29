import { Migration } from "@mikro-orm/migrations";

export class Migration20251204092521 extends Migration {

  async up() {
    this.addSql(`alter table "blacklist" add column "username" varchar(255) not null default '', add column "display_name" varchar(255) not null default '';`);
  }

  async down() {
    this.addSql(`alter table "blacklist" drop column "username", drop column "display_name";`);
  }

}
