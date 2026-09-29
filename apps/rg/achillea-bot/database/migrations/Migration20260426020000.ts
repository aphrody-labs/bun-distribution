import { Migration } from "@mikro-orm/migrations";

export class Migration20260426020000 extends Migration {
  async up() {
    // 1. Enums
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE phase_kind AS ENUM ('Swiss','SingleElim','DoubleElim','RoundRobin','Top8Bracket');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE phase_status AS ENUM ('Pending','Active','Completed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // 2. tournament_phase table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "tournament_phase" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "tournament_id"    INTEGER NOT NULL REFERENCES "event"("id") ON DELETE CASCADE,
        "index"            INTEGER NOT NULL,
        "kind"             phase_kind NOT NULL,
        "config"           JSONB,
        "status"           phase_status NOT NULL DEFAULT 'Pending',
        "started_at"       TIMESTAMPTZ,
        "ended_at"         TIMESTAMPTZ,
        "qualifiers_count" INTEGER NOT NULL DEFAULT 0
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "tournament_phase_tournament_idx" ON "tournament_phase" ("tournament_id");
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "tournament_phase_status_idx" ON "tournament_phase" ("status");
    `);

    // 3. Add phase + swiss_round columns to lobby
    this.addSql(`
      ALTER TABLE "lobby"
        ADD COLUMN IF NOT EXISTS "phase_id" UUID REFERENCES "tournament_phase"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "swiss_round" INTEGER;
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "lobby_phase_idx" ON "lobby" ("phase_id") WHERE "phase_id" IS NOT NULL;
    `);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "lobby_phase_idx";`);
    this.addSql(`ALTER TABLE "lobby" DROP COLUMN IF EXISTS "swiss_round";`);
    this.addSql(`ALTER TABLE "lobby" DROP COLUMN IF EXISTS "phase_id";`);
    this.addSql(`DROP INDEX IF EXISTS "tournament_phase_status_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "tournament_phase_tournament_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "tournament_phase";`);
    this.addSql(`DROP TYPE IF EXISTS phase_status;`);
    this.addSql(`DROP TYPE IF EXISTS phase_kind;`);
  }
}
