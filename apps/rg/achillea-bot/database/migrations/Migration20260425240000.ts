import { Migration } from "@mikro-orm/migrations";

export class Migration20260425240000 extends Migration {
  async up() {
    // T-2.4 — Colonnes idempotence notifications Cast J-2 / H-2
    this.addSql(`
      ALTER TABLE cast_attribution
        ADD COLUMN IF NOT EXISTS notified_j2 BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS notified_h2 BOOLEAN NOT NULL DEFAULT FALSE;
    `);
  }

  async down() {
    this.addSql(`ALTER TABLE cast_attribution DROP COLUMN IF EXISTS notified_j2;`);
    this.addSql(`ALTER TABLE cast_attribution DROP COLUMN IF EXISTS notified_h2;`);
  }
}
