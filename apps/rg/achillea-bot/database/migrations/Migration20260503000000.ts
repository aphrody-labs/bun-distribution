import { Migration } from "@mikro-orm/migrations";

/**
 * Fix user_view : la version précédente joinait user_elo sur mode IN (0, 1)
 * (anciennes valeurs solo/duo) alors que MatchMode actuel utilise 2 (ONE_VS_ONE)
 * et 4 (TWO_VS_TWO — count joueurs). Conséquence : solo_key/duo_key toujours
 * vides → /api/tournaments/:id et /api/users/:id timeout (lookup rank en boucle).
 */
export class Migration20260503000000 extends Migration {
	async up() {
		this.addSql(`DROP VIEW IF EXISTS user_view CASCADE;`);
		this.addSql(`
			CREATE VIEW user_view AS
			SELECT u.id,
				COALESCE(u.username, ''::character varying) AS username,
				u.last_interact AS "lastInteract",
				u.role,
				COALESCE(ue.current_level, 1) AS "currentLevel",
				COALESCE(ue.total_xp, 0) AS "totalXp",
				cm.clan_id AS "clanId",
				COALESCE(eq_solo.elo, 0) AS solo_elo,
				COALESCE(rk_solo.key, ''::character varying) AS solo_key,
				COALESCE(eq_duo.elo, 0) AS duo_elo,
				COALESCE(rk_duo.key, ''::character varying) AS duo_key,
				(EXISTS ( SELECT 1 FROM user_connection uc WHERE uc.user_id::text = u.id::text AND uc.provider = 'twitch'::text)) AS "hasTwitch",
				(EXISTS ( SELECT 1 FROM user_connection uc WHERE uc.user_id::text = u.id::text AND uc.provider = 'challonge'::text)) AS "hasChallonge",
				(EXISTS ( SELECT 1 FROM user_connection uc WHERE uc.user_id::text = u.id::text AND uc.provider = 'youtube'::text)) AS "hasYoutube",
				u.display_name AS "displayName",
				u.normalized_display_name AS "normalizedDisplayName",
				u.blacklist_id IS NOT NULL AS "isBlacklisted"
			FROM "user" u
				LEFT JOIN user_experience ue ON ue.user_id::text = u.id::text
				LEFT JOIN clan_member cm ON cm.user_id::text = u.id::text
				LEFT JOIN user_elo eq_solo ON eq_solo.user_id::text = u.id::text AND eq_solo.mode = 2
				LEFT JOIN rank rk_solo ON eq_solo.elo >= rk_solo.min_elo AND eq_solo.elo <= rk_solo.max_elo
				LEFT JOIN user_elo eq_duo ON eq_duo.user_id::text = u.id::text AND eq_duo.mode = 4
				LEFT JOIN rank rk_duo ON eq_duo.elo >= rk_duo.min_elo AND eq_duo.elo <= rk_duo.max_elo;
		`);
	}
}
