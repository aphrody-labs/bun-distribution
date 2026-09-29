import { Migration } from "@mikro-orm/migrations";

export class Migration20260426010000 extends Migration {
  async up() {
    // 1. Enum license_status
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE license_status AS ENUM ('Active','Revoked','Expired');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // 2. Table principale
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "license" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        VARCHAR(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "license_number" VARCHAR(64) UNIQUE NOT NULL,
        "issued_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "valid_until"    TIMESTAMPTZ NOT NULL,
        "status"         license_status NOT NULL DEFAULT 'Active',
        "pdf_url"        TEXT,
        "qr_secret"      VARCHAR(64) UNIQUE NOT NULL,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Index user_id
    this.addSql(`CREATE INDEX IF NOT EXISTS "license_user_id_idx" ON "license" ("user_id");`);

    // 4. Index status (filtrer rapidement les licences actives)
    this.addSql(`CREATE INDEX IF NOT EXISTS "license_status_idx" ON "license" ("status");`);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "license_status_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "license_user_id_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "license";`);
    this.addSql(`DROP TYPE IF EXISTS license_status;`);
  }
}
