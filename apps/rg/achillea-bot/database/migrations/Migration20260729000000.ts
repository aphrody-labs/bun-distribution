import { Migration } from "@mikro-orm/migrations";

/**
 * Bonus AP podium tournoi (1er / 2e / demis) — idempotence par tournoi.
 *
 * Quand un bracket se termine (`TournamentState.FINISHED`), on verse un forfait
 * d'AP ranked aux top 4 selon la taille du tournoi. Ce booléen évite une double
 * application (retry, re-finish, script rétroactif).
 */
export class Migration20260729000000 extends Migration {
	async up() {
		this.addSql(`
			ALTER TABLE "event"
			ADD COLUMN IF NOT EXISTS "placement_elo_applied" boolean NOT NULL DEFAULT false
		`);
	}

	async down() {
		this.addSql(`ALTER TABLE "event" DROP COLUMN IF EXISTS "placement_elo_applied"`);
	}
}
