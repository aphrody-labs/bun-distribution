import { Migration } from "@mikro-orm/migrations";

/**
 * Rôle Discord du tournoi : case à cocher plutôt qu'automatisme systématique.
 *
 * Le cadrage précise « seulement si c'est un tournoi que moi ou Kolti organisons, donc
 * il faut une case à cocher pour qu'on valide ça ou non ». Défaut à `false` : les
 * tournois déjà en base ne se voient pas attribuer de rôle rétroactivement.
 */
export class Migration20260813000000 extends Migration {
	async up() {
		this.addSql(`
			ALTER TABLE "event"
				ADD COLUMN IF NOT EXISTS "discord_role_enabled" boolean NOT NULL DEFAULT false;
		`);

		// Un tournoi qui a déjà un rôle l'a reçu avant l'introduction de la case :
		// on considère l'option activée pour lui, sinon les attributions suivantes
		// cesseraient sans raison visible.
		this.addSql(`
			UPDATE "event" SET "discord_role_enabled" = true WHERE "discord_role_id" IS NOT NULL;
		`);
	}

	async down() {
		this.addSql(`ALTER TABLE "event" DROP COLUMN IF EXISTS "discord_role_enabled";`);
	}
}
