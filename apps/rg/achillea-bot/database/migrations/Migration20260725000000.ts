import { Migration } from "@mikro-orm/migrations";

/**
 * Idempotence Elo ranked pour les matchs de tournoi.
 *
 * Quand un lobby TOURNAMENT se termine, on applique le même barème AP progressif
 * que le ranked (user_elo + elo_variation). Ce booléen évite une double application
 * (retry réseau, revalidation admin, script rétroactif).
 */
export class Migration20260725000000 extends Migration {
	async up() {
		this.addSql(`
			ALTER TABLE "lobby"
			ADD COLUMN IF NOT EXISTS "ranked_elo_applied" boolean NOT NULL DEFAULT false
		`);
		this.addSql(`
			CREATE INDEX IF NOT EXISTS "lobby_tournament_elo_pending_idx"
			ON "lobby" ("event_type", "state", "ranked_elo_applied")
			WHERE "event_type" = 'TOURNAMENT' AND "ranked_elo_applied" = false
		`);
	}

	async down() {
		this.addSql(`DROP INDEX IF EXISTS "lobby_tournament_elo_pending_idx"`);
		this.addSql(`ALTER TABLE "lobby" DROP COLUMN IF EXISTS "ranked_elo_applied"`);
	}
}
