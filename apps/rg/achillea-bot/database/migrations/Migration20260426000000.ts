import { Migration } from "@mikro-orm/migrations";

export class Migration20260426000000 extends Migration {
  async up() {
    // 1. Table ruleset
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ruleset" (
        "id"                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "version"                           VARCHAR(32) NOT NULL,
        "name"                              VARCHAR(128) NOT NULL,
        "category"                          VARCHAR(32) NOT NULL DEFAULT 'custom',
        "is_official"                       BOOLEAN NOT NULL DEFAULT FALSE,
        "forbidden_tactics_dropable"        JSONB,
        "forbidden_tactics_movement"        JSONB,
        "forbidden_tactics_immobilization"  JSONB,
        "forbidden_tactics_rng"             JSONB,
        "stadiums_allowed"                  JSONB,
        "default_bo"                        INTEGER NOT NULL DEFAULT 3,
        "golden_goal"                       BOOLEAN NOT NULL DEFAULT FALSE,
        "half_time_minutes"                 INTEGER,
        "judgment_of_advantage_protocol"    JSONB,
        "tiebreaker_rules"                  JSONB,
        "parent_ruleset_id"                 UUID REFERENCES "ruleset"("id") ON DELETE SET NULL
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "ruleset_is_official_idx" ON "ruleset" ("is_official");
    `);

    // 2. Seed — legacy (placeholder for pre-existing tournaments)
    this.addSql(`
      INSERT INTO "ruleset" ("id", "version", "name", "category", "is_official", "default_bo")
      VALUES (
        'aaaaaaaa-0000-0000-0000-000000000001',
        'legacy',
        'Legacy (pré-migration)',
        'legacy',
        FALSE,
        3
      )
      ON CONFLICT ("id") DO NOTHING;
    `);

    // 3. Seed — Astral League v1
    this.addSql(`
      INSERT INTO "ruleset" (
        "id", "version", "name", "category", "is_official",
        "default_bo", "golden_goal"
      )
      VALUES (
        'bbbbbbbb-0000-0000-0000-000000000001',
        '1.0.0',
        'Astral League v1',
        'official',
        TRUE,
        3,
        FALSE
      )
      ON CONFLICT ("id") DO NOTHING;
    `);

    // 4. Seed — Astral Cup v1
    this.addSql(`
      INSERT INTO "ruleset" (
        "id", "version", "name", "category", "is_official",
        "default_bo", "golden_goal"
      )
      VALUES (
        'cccccccc-0000-0000-0000-000000000001',
        '1.0.0',
        'Astral Cup v1',
        'official',
        TRUE,
        3,
        FALSE
      )
      ON CONFLICT ("id") DO NOTHING;
    `);

    // 5. Seed — The Beyblade Combine v1
    this.addSql(`
      INSERT INTO "ruleset" (
        "id", "version", "name", "category", "is_official",
        "default_bo", "golden_goal"
      )
      VALUES (
        'dddddddd-0000-0000-0000-000000000001',
        '1.0.0',
        'The Beyblade Combine v1',
        'official',
        TRUE,
        3,
        FALSE
      )
      ON CONFLICT ("id") DO NOTHING;
    `);

    // 6. FK sur event (STI Tournament)
    this.addSql(`
      ALTER TABLE "event"
        ADD COLUMN IF NOT EXISTS "ruleset_entity_id" UUID
          REFERENCES "ruleset"("id") ON DELETE SET NULL;
    `);

    // 7. Migrer tous les tournois existants vers le ruleset legacy
    this.addSql(`
      UPDATE "event"
      SET "ruleset_entity_id" = 'aaaaaaaa-0000-0000-0000-000000000001'
      WHERE "type" = 'TOURNAMENT'
        AND "ruleset_entity_id" IS NULL;
    `);
  }

  async down() {
    this.addSql(`ALTER TABLE "event" DROP COLUMN IF EXISTS "ruleset_entity_id";`);
    this.addSql(`DROP INDEX IF EXISTS "ruleset_is_official_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "ruleset";`);
  }
}
