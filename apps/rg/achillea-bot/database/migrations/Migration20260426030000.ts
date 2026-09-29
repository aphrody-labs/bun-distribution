import { Migration } from "@mikro-orm/migrations";

export class Migration20260426030000 extends Migration {
  async up() {
    // 1. season_state enum
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE season_state AS ENUM ('Upcoming','Active','Closed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // 2. season table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "season" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "name"       VARCHAR(255) NOT NULL,
        "starts_at"  TIMESTAMPTZ NOT NULL,
        "ends_at"    TIMESTAMPTZ NOT NULL,
        "state"      season_state NOT NULL DEFAULT 'Upcoming',
        "config"     JSONB
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "season_state_idx" ON "season" ("state");
    `);

    // 3. Alter user_elo — add season_id, peak_rating, games_played
    this.addSql(`
      ALTER TABLE "user_elo"
        ADD COLUMN IF NOT EXISTS "season_id" UUID REFERENCES "season"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "peak_rating" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "games_played" INTEGER NOT NULL DEFAULT 0;
    `);

    // 4. Unique indexes: legacy rows (NULL season_id) + seasonal rows
    //    Primary key stays (user_id, mode) for backward compatibility with
    //    existing rows that have a NULL season_id.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_elo_legacy_uniq"
        ON "user_elo" ("user_id", "mode") WHERE "season_id" IS NULL;
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_elo_season_uniq"
        ON "user_elo" ("user_id", "mode", "season_id") WHERE "season_id" IS NOT NULL;
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "user_elo_season_idx"
        ON "user_elo" ("season_id") WHERE "season_id" IS NOT NULL;
    `);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "user_elo_season_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "user_elo_season_uniq";`);
    this.addSql(`DROP INDEX IF EXISTS "user_elo_legacy_uniq";`);
    this.addSql(`
      ALTER TABLE "user_elo"
        DROP COLUMN IF EXISTS "games_played",
        DROP COLUMN IF EXISTS "peak_rating",
        DROP COLUMN IF EXISTS "season_id";
    `);
    this.addSql(`DROP INDEX IF EXISTS "season_state_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "season";`);
    this.addSql(`DROP TYPE IF EXISTS season_state;`);
  }
}
