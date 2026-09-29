import { Migration } from "@mikro-orm/migrations";

/**
 * Tables brackets-manager (préfixe `bm_`) mappées par MikroORMBracketAdapter.
 *
 * Le DDL vivait dans `database/create_brackets_tables.sql`, référencé NULLE PART
 * (ni migration, ni script de setup) → sur une base fraîche les tables n'existaient
 * jamais et tout le flux bracket (initTechnicalBracket / makeSeeding / generateLobbies)
 * plantait avec « relation "bm_stage" does not exist ». On le rapatrie ici pour que
 * `migrator.up()` (Database.initialize) les crée automatiquement. `IF NOT EXISTS`
 * garde la migration idempotente sur les bases où le .sql avait déjà été joué à la main.
 */
export class Migration20260628000000 extends Migration {
	async up() {
		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_participant" (
			"id" SERIAL PRIMARY KEY,
			"tournament_id" INT NOT NULL,
			"name" VARCHAR(255) NOT NULL
		);`);

		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_stage" (
			"id" SERIAL PRIMARY KEY,
			"tournament_id" INT NOT NULL,
			"name" VARCHAR(255) NOT NULL,
			"type" VARCHAR(255) NOT NULL,
			"settings" JSONB NOT NULL,
			"number" INT NOT NULL
		);`);

		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_group" (
			"id" SERIAL PRIMARY KEY,
			"stage_id" INT NOT NULL,
			"number" INT NOT NULL
		);`);

		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_round" (
			"id" SERIAL PRIMARY KEY,
			"stage_id" INT NOT NULL,
			"group_id" INT NOT NULL,
			"number" INT NOT NULL
		);`);

		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_match" (
			"id" SERIAL PRIMARY KEY,
			"stage_id" INT NOT NULL,
			"group_id" INT NOT NULL,
			"round_id" INT NOT NULL,
			"number" INT NOT NULL,
			"child_count" INT NOT NULL,
			"status" INT NOT NULL,
			"opponent1" JSONB NULL,
			"opponent2" JSONB NULL
		);`);

		this.addSql(`CREATE TABLE IF NOT EXISTS "bm_match_game" (
			"id" SERIAL PRIMARY KEY,
			"stage_id" INT NOT NULL,
			"parent_id" INT NOT NULL,
			"number" INT NOT NULL,
			"status" INT NOT NULL,
			"opponent1" JSONB NULL,
			"opponent2" JSONB NULL
		);`);

		// NB : pas de CREATE INDEX ici. Sur les bases où le .sql historique a déjà créé les
		// tables bm_* sous un autre rôle, `CREATE INDEX` échouerait (« must be owner of table »)
		// car le rôle applicatif Supabase n'est pas propriétaire. Les CREATE TABLE IF NOT EXISTS
		// ci-dessus restent, eux, de simples no-op idempotents.
	}

	async down() {
		this.addSql(`DROP TABLE IF EXISTS "bm_match_game";`);
		this.addSql(`DROP TABLE IF EXISTS "bm_match";`);
		this.addSql(`DROP TABLE IF EXISTS "bm_round";`);
		this.addSql(`DROP TABLE IF EXISTS "bm_group";`);
		this.addSql(`DROP TABLE IF EXISTS "bm_stage";`);
		this.addSql(`DROP TABLE IF EXISTS "bm_participant";`);
	}
}
