import { Migration } from "@mikro-orm/migrations";

/**
 * Politique de saisie des scores d'un tournoi (`event.score_report_policy`).
 *
 * Deux valeurs : `players` (les joueurs remplissent le score de leur match, comme
 * aujourd'hui) et `staff_only` (saisie et validation réservées aux organisateurs).
 * Défaut à `players` — les tournois déjà en base gardent exactement le comportement
 * qu'ils avaient, la restriction est un choix explicite de l'organisateur.
 *
 * Comme le reste du schéma, l'enum est stocké en `text` + contrainte CHECK plutôt
 * qu'en type ENUM natif : ajouter une valeur plus tard ne doit pas bloquer.
 */
export class Migration20260814000000 extends Migration {
	async up() {
		this.addSql(`
			ALTER TABLE "event"
				ADD COLUMN IF NOT EXISTS "score_report_policy" text NOT NULL DEFAULT 'players';
		`);

		this.addSql(`
			ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_score_report_policy_check";
		`);
		this.addSql(`
			ALTER TABLE "event" ADD CONSTRAINT "event_score_report_policy_check"
				CHECK ("score_report_policy" IN ('players', 'staff_only'));
		`);
	}

	async down() {
		this.addSql(`
			ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_score_report_policy_check";
		`);
		this.addSql(`ALTER TABLE "event" DROP COLUMN IF EXISTS "score_report_policy";`);
	}
}
