import { Migration } from "@mikro-orm/migrations";

/**
 * Ranked — fin de match « double validation » + télémétrie.
 *
 *  - `lobby_user.screenshot_url`         : capture de preuve uploadée par un joueur en cas de litige.
 *  - `lobby_user.claimed_opponent_score` : score que CE joueur attribue à l'adversaire (avec `score`
 *    = son propre score, on a les 2 scorelines complètes → détection d'accord + arbitrage admin).
 *  - `ranked_match_event`                : journal de télémétrie de tout le flow d'un match ranked
 *    (matchmaking, invitation, création, scores, accord/désaccord, preuve, fin, litige, actions admin).
 *
 * DDL idempotent (IF [NOT] EXISTS) → ré-exécution sûre même si déjà appliqué hors MikroORM.
 */
export class Migration20260606000000 extends Migration {
	async up() {
		this.addSql(`ALTER TABLE lobby_user ADD COLUMN IF NOT EXISTS screenshot_url text;`);
		this.addSql(`ALTER TABLE lobby_user ADD COLUMN IF NOT EXISTS claimed_opponent_score integer;`);

		this.addSql(`
			CREATE TABLE IF NOT EXISTS ranked_match_event (
				id         serial PRIMARY KEY,
				created_at timestamptz NOT NULL DEFAULT now(),
				lobby_id   integer NULL,
				room_code  text NULL,
				mode       smallint NULL,
				user_id    varchar NULL,
				event_type text NOT NULL,
				detail     jsonb NOT NULL DEFAULT '{}'::jsonb
			);
		`);
		this.addSql(
			`CREATE INDEX IF NOT EXISTS idx_rme_lobby ON ranked_match_event (lobby_id);`
		);
		this.addSql(`CREATE INDEX IF NOT EXISTS idx_rme_room ON ranked_match_event (room_code);`);
		this.addSql(
			`CREATE INDEX IF NOT EXISTS idx_rme_created ON ranked_match_event (created_at DESC);`
		);
		this.addSql(`CREATE INDEX IF NOT EXISTS idx_rme_type ON ranked_match_event (event_type);`);

		// RLS : aligne ranked_match_event sur le modele des 65 autres tables publiques
		// (RLS ON + unique policy *_anon_read en SELECT ; les ecritures ne passent que
		// par service_role qui bypasse la RLS). Sans ca, la cle anon embarquee dans le
		// front Angular pourrait INSERT/UPDATE/DELETE/TRUNCATE le journal de telemetrie.
		this.addSql(`ALTER TABLE ranked_match_event ENABLE ROW LEVEL SECURITY;`);
		this.addSql(
			`DROP POLICY IF EXISTS ranked_match_event_anon_read ON ranked_match_event;`
		);
		this.addSql(
			`CREATE POLICY ranked_match_event_anon_read ON ranked_match_event FOR SELECT TO anon, authenticated USING (true);`
		);
	}

	async down() {
		this.addSql(
			`DROP POLICY IF EXISTS ranked_match_event_anon_read ON ranked_match_event;`
		);
		this.addSql(`DROP TABLE IF EXISTS ranked_match_event;`);
		this.addSql(`ALTER TABLE lobby_user DROP COLUMN IF EXISTS claimed_opponent_score;`);
		this.addSql(`ALTER TABLE lobby_user DROP COLUMN IF EXISTS screenshot_url;`);
	}
}
