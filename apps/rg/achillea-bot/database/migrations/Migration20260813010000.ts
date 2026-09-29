import { Migration } from "@mikro-orm/migrations";

/**
 * Notes du staff sur les joueurs (`player_note`).
 *
 * Espace demandé par les organisateurs : consigner ce qu'ils ont à dire d'un joueur
 * pendant un tournoi, à la lecture des autres membres du staff. Distinct de `sanction`,
 * qui porte des décisions ; ici ce ne sont que des observations.
 *
 * Contrairement au reste du schéma public, **aucune politique de lecture anonyme** :
 * ces lignes ne doivent jamais sortir par la clé `anon` embarquée dans le front. Seul
 * `service_role` (qui contourne la RLS) y accède, derrière les contrôles de l'API.
 */
export class Migration20260813010000 extends Migration {
	async up() {
		this.addSql(`
			CREATE TABLE IF NOT EXISTS "player_note" (
				"id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				"created_at"    timestamptz NOT NULL DEFAULT NOW(),
				"updated_at"    timestamptz NOT NULL DEFAULT NOW(),
				"target_id"     varchar(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
				"author_id"     varchar(255) NULL REFERENCES "user"("id") ON DELETE SET NULL,
				"tournament_id" integer NULL REFERENCES "event"("id") ON DELETE SET NULL,
				"category"      text NOT NULL DEFAULT 'other',
				"severity"      text NOT NULL DEFAULT 'info',
				"content"       text NOT NULL,
				"resolved"      boolean NOT NULL DEFAULT false,
				"resolved_at"   timestamptz NULL,
				"resolved_by_id" varchar(255) NULL REFERENCES "user"("id") ON DELETE SET NULL
			);
		`);

		this.addSql(`
			ALTER TABLE "player_note" DROP CONSTRAINT IF EXISTS "player_note_category_check";
		`);
		this.addSql(`
			ALTER TABLE "player_note" ADD CONSTRAINT "player_note_category_check"
				CHECK ("category" IN ('behavior','cheating','no_show','score_dispute','positive','other'));
		`);
		this.addSql(`
			ALTER TABLE "player_note" DROP CONSTRAINT IF EXISTS "player_note_severity_check";
		`);
		this.addSql(`
			ALTER TABLE "player_note" ADD CONSTRAINT "player_note_severity_check"
				CHECK ("severity" IN ('info','warning','serious'));
		`);

		this.addSql(`
			CREATE INDEX IF NOT EXISTS "player_note_target_created_idx"
				ON "player_note" ("target_id", "created_at" DESC);
		`);
		this.addSql(`
			CREATE INDEX IF NOT EXISTS "player_note_tournament_idx"
				ON "player_note" ("tournament_id") WHERE "tournament_id" IS NOT NULL;
		`);
		this.addSql(`
			CREATE INDEX IF NOT EXISTS "player_note_open_idx"
				ON "player_note" ("resolved") WHERE "resolved" = false;
		`);

		// RLS active SANS politique : personne ne lit via anon/authenticated.
		this.addSql(`ALTER TABLE "player_note" ENABLE ROW LEVEL SECURITY;`);
		this.addSql(`DROP POLICY IF EXISTS "player_note_anon_read" ON "player_note";`);
		this.addSql(`
			GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "player_note" TO service_role;
		`);
		this.addSql(`REVOKE ALL ON TABLE "player_note" FROM anon, authenticated;`);
	}

	async down() {
		this.addSql(`DROP TABLE IF EXISTS "player_note";`);
	}
}
