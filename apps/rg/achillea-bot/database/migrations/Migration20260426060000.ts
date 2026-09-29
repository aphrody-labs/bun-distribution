import { Migration } from "@mikro-orm/migrations";

export class Migration20260426060000 extends Migration {
  async up() {
    this.addSql(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "bio" TEXT,
        ADD COLUMN IF NOT EXISTS "twitch_url" VARCHAR(255);
    `);
  }

  async down() {
    this.addSql(`ALTER TABLE "user" DROP COLUMN IF EXISTS "bio";`);
    this.addSql(`ALTER TABLE "user" DROP COLUMN IF EXISTS "twitch_url";`);
  }
}
