import { Migration } from "@mikro-orm/migrations";

export class Migration20260425202759 extends Migration {
  async up() {
    // 1. Create audit_log table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "audit_log" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id"        VARCHAR(255),
        "action"          VARCHAR(255) NOT NULL,
        "target_type"     VARCHAR(255) NOT NULL,
        "target_id"       VARCHAR(255),
        "payload"         JSONB,
        "reason"          TEXT,
        "ip"              VARCHAR(64),
        "ts"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "prev_signature"  VARCHAR(64),
        "signature"       VARCHAR(64) NOT NULL
      );
    `);

    // 2. Indexes
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "audit_log_target_idx" ON "audit_log" ("target_type", "target_id");`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "audit_log_actor_id_idx" ON "audit_log" ("actor_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "audit_log_ts_idx" ON "audit_log" ("ts");`);

    // 3. Immutability triggers — reject any UPDATE or DELETE
    this.addSql(`
      CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END $$ LANGUAGE plpgsql;
    `);

    this.addSql(`
      CREATE TRIGGER no_update_audit_log
      BEFORE UPDATE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
    `);

    this.addSql(`
      CREATE TRIGGER no_delete_audit_log
      BEFORE DELETE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
    `);

    // 4. Add auditLogChannelId column to guild table
    this.addSql(`
      ALTER TABLE "guild"
        ADD COLUMN IF NOT EXISTS "audit_log_channel_id" VARCHAR(255);
    `);
  }

  async down() {
    // Remove triggers and function
    this.addSql(`DROP TRIGGER IF EXISTS no_update_audit_log ON "audit_log";`);
    this.addSql(`DROP TRIGGER IF EXISTS no_delete_audit_log ON "audit_log";`);
    this.addSql(`DROP FUNCTION IF EXISTS audit_log_immutable();`);

    // Drop indexes
    this.addSql(`DROP INDEX IF EXISTS "audit_log_target_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "audit_log_actor_id_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "audit_log_ts_idx";`);

    // Drop table
    this.addSql(`DROP TABLE IF EXISTS "audit_log";`);

    // Remove column from guild
    this.addSql(`ALTER TABLE "guild" DROP COLUMN IF EXISTS "audit_log_channel_id";`);
  }
}
