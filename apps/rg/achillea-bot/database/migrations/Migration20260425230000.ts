import { Migration } from "@mikro-orm/migrations";

export class Migration20260425230000 extends Migration {
  async up() {
    // =========================================================================
    // T-2.1 — Cellule Cast : 4 tables (cast_event, cast_slot,
    //          cast_availability, cast_attribution)
    // Note : champs defraiement* nullable — charte CP en attente de décision.
    // =========================================================================

    // 1. cast_event
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cast_event" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"           VARCHAR(255) NOT NULL,
        "kind"           VARCHAR(16) NOT NULL
                           CHECK ("kind" IN ('match','tournament','stream','other')),
        "scheduled_at"   TIMESTAMPTZ NOT NULL,
        "duration"       INTEGER NOT NULL DEFAULT 60,
        "tournament_id"  UUID,
        "status"         VARCHAR(16) NOT NULL DEFAULT 'planned'
                           CHECK ("status" IN ('planned','open_signup','attributed','live','done','cancelled')),
        "description"    TEXT,
        "twitch_url"     VARCHAR(512),
        "created_by"     VARCHAR(32) NOT NULL,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Index sur scheduled_at (partiel : events à venir non annulés)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_event_scheduled_at_idx"
        ON "cast_event" ("scheduled_at")
        WHERE "status" IN ('planned','open_signup');
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_event_status_idx"
        ON "cast_event" ("status");
    `);

    // 2. cast_slot
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cast_slot" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id"             UUID NOT NULL
                                 REFERENCES "cast_event"("id") ON DELETE CASCADE,
        "role"                 VARCHAR(32) NOT NULL
                                 CHECK ("role" IN ('caster_main','caster_secondary','observer','producer','host','technical')),
        "required"             BOOLEAN NOT NULL DEFAULT TRUE,
        "defrayment_amount"    DECIMAL(10,2),
        "defrayment_currency"  VARCHAR(3),
        "defrayment_reason"    TEXT,
        "notes"                TEXT
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_slot_event_id_idx"
        ON "cast_slot" ("event_id");
    `);

    // 3. cast_availability
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cast_availability" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"          VARCHAR(32) NOT NULL,
        "event_id"         UUID NOT NULL
                             REFERENCES "cast_event"("id") ON DELETE CASCADE,
        "status"           VARCHAR(16) NOT NULL DEFAULT 'unavailable'
                             CHECK ("status" IN ('available','maybe','unavailable')),
        "preferred_roles"  JSONB,
        "notes"            TEXT,
        "declared_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "cast_availability_user_event_uniq" UNIQUE ("user_id", "event_id")
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_availability_event_id_idx"
        ON "cast_availability" ("event_id");
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_availability_user_id_idx"
        ON "cast_availability" ("user_id");
    `);

    // 4. cast_attribution
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cast_attribution" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "slot_id"       UUID NOT NULL
                          REFERENCES "cast_slot"("id") ON DELETE CASCADE,
        "user_id"       VARCHAR(32),
        "assigned_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "assigned_by"   VARCHAR(32) NOT NULL,
        "confirmed_at"  TIMESTAMPTZ,
        CONSTRAINT "cast_attribution_slot_uniq" UNIQUE ("slot_id")
      );
    `);

    // Index partiel : user_id non nul (recherche rapide par caster)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "cast_attribution_user_id_idx"
        ON "cast_attribution" ("user_id")
        WHERE "user_id" IS NOT NULL;
    `);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "cast_attribution_user_id_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "cast_attribution";`);

    this.addSql(`DROP INDEX IF EXISTS "cast_availability_user_id_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "cast_availability_event_id_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "cast_availability";`);

    this.addSql(`DROP INDEX IF EXISTS "cast_slot_event_id_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "cast_slot";`);

    this.addSql(`DROP INDEX IF EXISTS "cast_event_status_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "cast_event_scheduled_at_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "cast_event";`);
  }
}
