import { Migration } from "@mikro-orm/migrations";

/**
 * Officialise la ladder fraîche : crée la « Saison 1 » active (baseRating 0) si aucune saison
 * active n'existe, puis rattache les comptes seasonless (user_elo.season_id NULL) à cette saison.
 */
export class Migration20260609010000 extends Migration {
	async up() {
		this.addSql(`
			INSERT INTO season (id, name, starts_at, ends_at, state, config, created_at, updated_at)
			SELECT gen_random_uuid(), 'Saison 1', now(), now() + interval '90 days', 'Active',
				'{"kFactor":32,"baseRating":0,"decayRate":0}'::jsonb, now(), now()
			WHERE NOT EXISTS (SELECT 1 FROM season WHERE state = 'Active');
		`);
		this.addSql(`
			UPDATE user_elo
			SET season_id = (SELECT id FROM season WHERE state = 'Active' ORDER BY starts_at DESC LIMIT 1),
				updated_at = now()
			WHERE season_id IS NULL;
		`);
	}

	async down() {
		this.addSql(
			`UPDATE user_elo SET season_id = NULL WHERE season_id IN (SELECT id FROM season WHERE name = 'Saison 1');`
		);
		this.addSql(`DELETE FROM season WHERE name = 'Saison 1';`);
	}
}
