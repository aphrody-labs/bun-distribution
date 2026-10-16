/**
 * Sync des avatars Discord pour les `team_members` du website.
 *
 * Ce service complète `syncMembers.ts` (qui ne touche que `discord_members`)
 * en propageant les changements d'avatar aux 4 tables impactées :
 *   - team_members.image_url
 *   - discord_members (upsert)
 *   - "user".image (Better Auth, via account bridge)
 *   - profiles.avatar_url (ce que le site affiche), sauf photo choisie à la main
 *
 * Utilise `client.users.fetch(id)` de discord.js qui gère le rate-limit nativement.
 */
import type { Client } from "discord.js";

import { sql } from "../lib/db";

interface StaffRow {
  id: string;
  name: string;
  discord_user_id: string;
  current_image: string | null;
}

export interface StaffPhotoSyncReport {
  total: number;
  updated: number;
  unchanged: number;
  errors: { name: string; reason: string }[];
  durationMs: number;
}

export async function syncStaffPhotos(client: Client): Promise<StaffPhotoSyncReport> {
  const start = Date.now();
  const rows = await sql<StaffRow[]>`
    SELECT id, name, discord_user_id, image_url AS current_image
    FROM team_members
    WHERE is_active = true AND discord_user_id IS NOT NULL AND discord_user_id != ''
    ORDER BY team_id, order_index, name
  `;

  const errors: StaffPhotoSyncReport["errors"] = [];
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    try {
      // discord.js fetch avec cache + rate-limit auto + retry intégré
      const user = await client.users.fetch(row.discord_user_id, { force: true });
      const newWebp = user.displayAvatarURL({ size: 256, extension: "webp" });

      if (row.current_image === newWebp) {
        unchanged++;
        continue;
      }

      const newPng = newWebp.replace(".webp", ".png").replace(/\?size=\d+/, "");

      await sql`UPDATE team_members SET image_url = ${newWebp}, updated_at = NOW() WHERE id = ${row.id}`;
      await sql`
        INSERT INTO discord_members (discord_id, username, display_name, avatar_url, is_bot, updated_at)
        VALUES (${row.discord_user_id}, ${user.username}, ${user.globalName ?? null}, ${newWebp}, ${user.bot}, NOW())
        ON CONFLICT (discord_id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
      `;
      await sql`
        UPDATE "user" u
        SET image = ${newPng}, updated_at = NOW()
        FROM account a
        WHERE a.user_id = u.id
          AND a.provider_id = 'discord'
          AND a.account_id = ${row.discord_user_id}
      `;
      // Quatrième table, et la seule que le SITE affiche vraiment (profil
      // public, commentaires, annuaire). Même garde que `syncMembers.ts` : on
      // ne remplace que ce que Discord avait posé — jamais une photo
      // téléversée depuis `/dashboard/account`, jamais l'avatar Google ou
      // Twitch d'un compte lié autrement.
      await sql`
        UPDATE profiles
        SET avatar_url = ${newWebp}, updated_at = NOW()
        WHERE discord_id = ${row.discord_user_id}
          AND avatar_url IS DISTINCT FROM ${newWebp}
          AND (avatar_url IS NULL OR avatar_url LIKE '%cdn.discordapp.com%')
      `;

      updated++;
    } catch (err) {
      errors.push({
        name: row.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: rows.length,
    updated,
    unchanged,
    errors,
    durationMs: Date.now() - start,
  };
}
