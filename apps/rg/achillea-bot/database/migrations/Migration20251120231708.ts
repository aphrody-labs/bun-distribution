import { Migration } from "@mikro-orm/migrations";

export class Migration20251120231708 extends Migration {

  async up() {
    this.addSql(`alter table "clan_member_history" rename column "fame_contributed" to "clan_fame_contributed";`);
  }

  async down() {
    this.addSql(`alter table "clan_member_history" rename column "clan_fame_contributed" to "fame_contributed";`);
  }

}
