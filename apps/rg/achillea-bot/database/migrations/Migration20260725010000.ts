import { Migration } from "@mikro-orm/migrations";

/**
 * Ajoute le type de tournoi `league` (championnat type Premier League / Asytral).
 * Constraint historique : round_robin | single_elimination | double_elimination.
 */
export class Migration20260725010000 extends Migration {
	async up() {
		this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);
		this.addSql(`
			alter table "event"
			add constraint "event_tournament_type_check"
			check ("tournament_type" in (
				'round_robin',
				'single_elimination',
				'double_elimination',
				'league'
			) or "tournament_type" is null)
		`);
	}

	async down() {
		this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);
		this.addSql(`
			update "event" set "tournament_type" = 'round_robin'
			where "tournament_type" = 'league'
		`);
		this.addSql(`
			alter table "event"
			add constraint "event_tournament_type_check"
			check ("tournament_type" in (
				'round_robin',
				'single_elimination',
				'double_elimination'
			))
		`);
	}
}
