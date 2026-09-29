import { Migration } from "@mikro-orm/migrations";

export class Migration20260426040000 extends Migration {
  async up() {
    // transaction_type enum
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE transaction_type AS ENUM ('Credit','Debit','Transfer','Payout','Fine');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // wallet table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"    VARCHAR(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "balance"    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        "currency"   VARCHAR(10) NOT NULL DEFAULT 'ACH',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "wallet_user_id_uniq" ON "wallet" ("user_id");
    `);

    // transaction table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "transaction" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "type"         transaction_type NOT NULL,
        "amount"       DECIMAL(12,2) NOT NULL,
        "reason"       TEXT,
        "from_user_id" VARCHAR(255) REFERENCES "user"("id") ON DELETE SET NULL,
        "to_user_id"   VARCHAR(255) REFERENCES "user"("id") ON DELETE SET NULL,
        "metadata"     JSONB,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "transaction_from_user_idx" ON "transaction" ("from_user_id");
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "transaction_to_user_idx" ON "transaction" ("to_user_id");
    `);
  }

  async down() {
    this.addSql(`DROP INDEX IF EXISTS "transaction_to_user_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "transaction_from_user_idx";`);
    this.addSql(`DROP TABLE IF EXISTS "transaction";`);
    this.addSql(`DROP INDEX IF EXISTS "wallet_user_id_uniq";`);
    this.addSql(`DROP TABLE IF EXISTS "wallet";`);
    this.addSql(`DROP TYPE IF EXISTS transaction_type;`);
  }
}
