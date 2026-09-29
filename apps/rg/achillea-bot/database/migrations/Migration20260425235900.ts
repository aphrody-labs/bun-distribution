import { Migration } from "@mikro-orm/migrations";

export class Migration20260425235900 extends Migration {
  async up() {
    // 1. Enums
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE sanction_type AS ENUM ('warn','mute','kick','ban','unmute','unban','note');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE sanction_issuer_type AS ENUM ('user','bot','staff','system');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // 2. Table principale
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "sanction" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         VARCHAR(255) NOT NULL,
        "guild_id"        VARCHAR(255) NOT NULL,
        "type"            sanction_type NOT NULL,
        "reason"          TEXT,
        "duration_sec"    INTEGER CHECK ("duration_sec" > 0),
        "issued_by"       VARCHAR(255) NOT NULL,
        "issued_by_type"  sanction_issuer_type NOT NULL DEFAULT 'staff',
        "expires_at"      TIMESTAMPTZ,
        "revoked_at"      TIMESTAMPTZ,
        "revoked_by"      VARCHAR(255),
        "revoke_reason"   TEXT,
        "evidence"        JSONB,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Index sur userId
    this.addSql(`CREATE INDEX IF NOT EXISTS "sanction_user_id_idx" ON "sanction" ("user_id");`);

    // 4. Index composite (guildId, userId)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "sanction_guild_user_idx" ON "sanction" ("guild_id", "user_id");`,
    );

    // 5. Index partiel pour le scan TTL (sanctions actives avec expiration)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "sanction_active_expiry_idx"
        ON "sanction" ("expires_at")
        WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
    `);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "sanction_active_expiry_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "sanction_guild_user_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "sanction_user_id_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "sanction";`);
    this.addSql(`DROP TYPE IF EXISTS sanction_issuer_type;`);
    this.addSql(`DROP TYPE IF EXISTS sanction_type;`);
  }
}
