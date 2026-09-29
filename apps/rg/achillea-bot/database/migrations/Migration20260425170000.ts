import { Migration } from "@mikro-orm/migrations";

export class Migration20260425170000 extends Migration {
  async up() {
    this.addSql(`drop view if exists user_view;`);
    this.addSql(`
      CREATE VIEW user_view AS
      SELECT
        u.id,
        COALESCE(u.username, '') AS username,
        u.last_interact AS "lastInteract",
        u.role,
        COALESCE(ue.current_level, 1) AS "currentLevel",
        COALESCE(ue.total_xp, 0) AS "totalXp",
        cm.clan_id AS "clanId",
        COALESCE(eq_solo.elo, 0) AS solo_elo,
        COALESCE(rk_solo.key, '') AS solo_key,
        COALESCE(eq_duo.elo, 0) AS duo_elo,
        COALESCE(rk_duo.key, '') AS duo_key,
        EXISTS(SELECT 1 FROM user_connection uc WHERE uc.user_id = u.id AND uc.provider = 'twitch') AS "hasTwitch",
        EXISTS(SELECT 1 FROM user_connection uc WHERE uc.user_id = u.id AND uc.provider = 'challonge') AS "hasChallonge",
        EXISTS(SELECT 1 FROM user_connection uc WHERE uc.user_id = u.id AND uc.provider = 'youtube') AS "hasYoutube",
        u.display_name AS "displayName",
        u.normalized_display_name AS "normalizedDisplayName",
        (u.blacklist_id IS NOT NULL) AS "isBlacklisted"
      FROM "user" u
      LEFT JOIN user_experience ue ON ue.user_id = u.id
      LEFT JOIN clan_member cm ON cm.user_id = u.id
      LEFT JOIN user_elo eq_solo ON eq_solo.user_id = u.id AND eq_solo.mode = 0
      LEFT JOIN rank rk_solo ON eq_solo.elo BETWEEN rk_solo.min_elo AND rk_solo.max_elo
      LEFT JOIN user_elo eq_duo ON eq_duo.user_id = u.id AND eq_duo.mode = 1
      LEFT JOIN rank rk_duo ON eq_duo.elo BETWEEN rk_duo.min_elo AND rk_duo.max_elo;
    `);
  }

  async down() {
    this.addSql(`drop view if exists user_view;`);
  }
}
