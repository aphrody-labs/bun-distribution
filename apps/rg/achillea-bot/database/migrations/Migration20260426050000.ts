import { Migration } from "@mikro-orm/migrations";

export class Migration20260426050000 extends Migration {
  async up() {
    this.addSql(`
      ALTER TABLE "user_elo"
        ADD COLUMN IF NOT EXISTS "wins" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "losses" INTEGER NOT NULL DEFAULT 0;
    `);
  }

  async down() {
    this.addSql(`ALTER TABLE "user_elo" DROP COLUMN IF EXISTS "wins";`);
    this.addSql(`ALTER TABLE "user_elo" DROP COLUMN IF EXISTS "losses";`);
  }
}
