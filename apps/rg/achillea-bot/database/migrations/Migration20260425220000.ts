import { Migration } from "@mikro-orm/migrations";

export class Migration20260425220000 extends Migration {
  async up() {
    // 1. Extend guild table with metadata columns from Discord scan
    this.addSql(`
      ALTER TABLE "guild"
        ADD COLUMN IF NOT EXISTS "name" TEXT,
        ADD COLUMN IF NOT EXISTS "icon" TEXT,
        ADD COLUMN IF NOT EXISTS "banner" TEXT,
        ADD COLUMN IF NOT EXISTS "owner_id" VARCHAR(255),
        ADD COLUMN IF NOT EXISTS "member_count" INTEGER,
        ADD COLUMN IF NOT EXISTS "presence_count" INTEGER,
        ADD COLUMN IF NOT EXISTS "features" TEXT[],
        ADD COLUMN IF NOT EXISTS "premium_tier" SMALLINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "verification_level" SMALLINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "description" TEXT,
        ADD COLUMN IF NOT EXISTS "scanned_at" TIMESTAMPTZ;
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS "guild_member_count_idx" ON "guild" ("member_count" DESC NULLS LAST);`,
    );

    // 2. guild_role
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "guild_role" (
        "id" VARCHAR(255) PRIMARY KEY,
        "guild_id" VARCHAR(255) NOT NULL REFERENCES "guild"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "color" INTEGER NOT NULL DEFAULT 0,
        "position" INTEGER NOT NULL DEFAULT 0,
        "permissions" VARCHAR(40),
        "hoist" BOOLEAN DEFAULT false,
        "managed" BOOLEAN DEFAULT false,
        "mentionable" BOOLEAN DEFAULT false,
        "scanned_at" TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "guild_role_guild_id_idx" ON "guild_role" ("guild_id");`,
    );

    // 3. guild_channel
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "guild_channel" (
        "id" VARCHAR(255) PRIMARY KEY,
        "guild_id" VARCHAR(255) NOT NULL REFERENCES "guild"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "type" SMALLINT NOT NULL,
        "parent_id" VARCHAR(255),
        "position" INTEGER DEFAULT 0,
        "topic" TEXT,
        "nsfw" BOOLEAN DEFAULT false,
        "scanned_at" TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "guild_channel_guild_id_idx" ON "guild_channel" ("guild_id");`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "guild_channel_type_idx" ON "guild_channel" ("type");`);

    // 4. guild_member_meta
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "guild_member_meta" (
        "guild_id" VARCHAR(255) NOT NULL REFERENCES "guild"("id") ON DELETE CASCADE,
        "user_id" VARCHAR(255) NOT NULL,
        "nick" VARCHAR(255),
        "joined_at" TIMESTAMPTZ,
        "premium_since" TIMESTAMPTZ,
        "roles" TEXT[],
        "pending" BOOLEAN DEFAULT false,
        "scanned_at" TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY ("guild_id", "user_id")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "guild_member_meta_user_id_idx" ON "guild_member_meta" ("user_id");`,
    );
  }

  async down() {
    this.addSql(`DROP TABLE IF EXISTS "guild_member_meta";`);
    this.addSql(`DROP TABLE IF EXISTS "guild_channel";`);
    this.addSql(`DROP TABLE IF EXISTS "guild_role";`);
    this.addSql(`DROP INDEX IF EXISTS "guild_member_count_idx";`);
    this.addSql(`
      ALTER TABLE "guild"
        DROP COLUMN IF EXISTS "name",
        DROP COLUMN IF EXISTS "icon",
        DROP COLUMN IF EXISTS "banner",
        DROP COLUMN IF EXISTS "owner_id",
        DROP COLUMN IF EXISTS "member_count",
        DROP COLUMN IF EXISTS "presence_count",
        DROP COLUMN IF EXISTS "features",
        DROP COLUMN IF EXISTS "premium_tier",
        DROP COLUMN IF EXISTS "verification_level",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "scanned_at";
    `);
  }
}
