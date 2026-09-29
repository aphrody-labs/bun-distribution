import { Migration } from "@mikro-orm/migrations";

/**
 * Tournois — statut de participant, journal d'évènements, planning automatisé,
 * rôle Discord, clôture / annulation (voir `docs/plan-tournois.md`).
 *
 * DDL idempotent (IF [NOT] EXISTS) : la base de production a déjà été alignée à la
 * main par le passé, une ré-exécution doit rester sans effet.
 *
 * Les enums MikroORM string sont stockés en `text` + contrainte CHECK dans ce schéma
 * (cf. `Migration20251108123648`) : on garde ce style plutôt que des types ENUM natifs,
 * qui rendraient chaque ajout de valeur bloquant.
 */
export class Migration20260812000000 extends Migration {
	async up() {
		// ── 1. Statut de participant (liste d'attente + disqualification) ────────
		this.addSql(`
			ALTER TABLE "tournament_participant"
				ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'Active',
				ADD COLUMN IF NOT EXISTS "registered_at" timestamptz NOT NULL DEFAULT NOW(),
				ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz NULL,
				ADD COLUMN IF NOT EXISTS "status_reason" varchar(500) NULL,
				ADD COLUMN IF NOT EXISTS "status_actor_id" varchar(255) NULL;
		`);

		this.addSql(`
			ALTER TABLE "tournament_participant"
				DROP CONSTRAINT IF EXISTS "tournament_participant_status_check";
		`);
		this.addSql(`
			ALTER TABLE "tournament_participant"
				ADD CONSTRAINT "tournament_participant_status_check"
				CHECK ("status" IN ('Active', 'Waitlisted', 'Disqualified'));
		`);

		// Les inscrits existants sont tous actifs (aucun autre statut n'existait) ; leur
		// date d'inscription réelle est `created_at`, pas la date de cette migration —
		// sans ce report, la liste d'attente les classerait tous ex aequo.
		this.addSql(`
			UPDATE "tournament_participant"
			SET "registered_at" = "created_at"
			WHERE "created_at" IS NOT NULL AND "registered_at" > "created_at";
		`);

		this.addSql(`
			CREATE INDEX IF NOT EXISTS "tournament_participant_tournament_status_idx"
				ON "tournament_participant" ("tournament_id", "status");
		`);

		// ── 2. Planning automatisé, rôle Discord, clôture / annulation ───────────
		// `event` est la table du discriminateur Event → Tournament.
		this.addSql(`
			ALTER TABLE "event"
				ADD COLUMN IF NOT EXISTS "registration_opens_at" timestamptz NULL,
				ADD COLUMN IF NOT EXISTS "registration_closes_at" timestamptz NULL,
				ADD COLUMN IF NOT EXISTS "auto_start" boolean NOT NULL DEFAULT false,
				ADD COLUMN IF NOT EXISTS "discord_role_id" varchar(255) NULL,
				ADD COLUMN IF NOT EXISTS "discord_guild_id" varchar(255) NULL,
				ADD COLUMN IF NOT EXISTS "cancel_reason" varchar(500) NULL,
				ADD COLUMN IF NOT EXISTS "canceled_at" timestamptz NULL,
				ADD COLUMN IF NOT EXISTS "closed_at" timestamptz NULL;
		`);

		// ── 3. Journal métier du tournoi ─────────────────────────────────────────
		this.addSql(`
			CREATE TABLE IF NOT EXISTS "tournament_event" (
				"id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"tournament_id" integer NOT NULL REFERENCES "event"("id") ON DELETE CASCADE,
				"type"          text NOT NULL,
				"actor_id"      varchar(255) NULL REFERENCES "user"("id") ON DELETE SET NULL,
				"target_id"     varchar(255) NULL REFERENCES "user"("id") ON DELETE SET NULL,
				"payload"       jsonb NULL,
				"reason"        varchar(500) NULL,
				"created_at"    timestamptz NOT NULL DEFAULT NOW()
			);
		`);

		this.addSql(`
			CREATE INDEX IF NOT EXISTS "tournament_event_tournament_created_idx"
				ON "tournament_event" ("tournament_id", "created_at" DESC);
		`);

		// RLS alignée sur le reste du schéma public : lecture anonyme, écritures
		// réservées à service_role (qui contourne la RLS). Sans cela, la clé anon
		// embarquée dans le front pourrait réécrire le journal.
		this.addSql(`ALTER TABLE "tournament_event" ENABLE ROW LEVEL SECURITY;`);
		this.addSql(`DROP POLICY IF EXISTS "tournament_event_anon_read" ON "tournament_event";`);
		this.addSql(`
			CREATE POLICY "tournament_event_anon_read" ON "tournament_event"
				FOR SELECT TO anon, authenticated USING (true);
		`);
	}

	async down() {
		this.addSql(`DROP POLICY IF EXISTS "tournament_event_anon_read" ON "tournament_event";`);
		this.addSql(`DROP TABLE IF EXISTS "tournament_event";`);

		this.addSql(`
			ALTER TABLE "event"
				DROP COLUMN IF EXISTS "registration_opens_at",
				DROP COLUMN IF EXISTS "registration_closes_at",
				DROP COLUMN IF EXISTS "auto_start",
				DROP COLUMN IF EXISTS "discord_role_id",
				DROP COLUMN IF EXISTS "discord_guild_id",
				DROP COLUMN IF EXISTS "cancel_reason",
				DROP COLUMN IF EXISTS "canceled_at",
				DROP COLUMN IF EXISTS "closed_at";
		`);

		this.addSql(`DROP INDEX IF EXISTS "tournament_participant_tournament_status_idx";`);
		this.addSql(`
			ALTER TABLE "tournament_participant"
				DROP CONSTRAINT IF EXISTS "tournament_participant_status_check";
		`);
		this.addSql(`
			ALTER TABLE "tournament_participant"
				DROP COLUMN IF EXISTS "status",
				DROP COLUMN IF EXISTS "registered_at",
				DROP COLUMN IF EXISTS "status_changed_at",
				DROP COLUMN IF EXISTS "status_reason",
				DROP COLUMN IF EXISTS "status_actor_id";
		`);
	}
}
