import type { Guild, GuildMember, User } from "discord.js";
import type { DiscordMember as MemberRow } from "@rosegriffon/types";

import { sql } from "../lib/db";

function resolveAvatarUrl(member: GuildMember): string | null {
  const guildAvatar = member.avatarURL({ size: 256, extension: "webp" });
  if (guildAvatar) return guildAvatar;
  const userAvatar = member.user.avatarURL({ size: 256, extension: "webp" });
  if (userAvatar) return userAvatar;
  return member.user.defaultAvatarURL ?? null;
}

function resolveUserAvatarUrl(user: User): string | null {
  return user.avatarURL({ size: 256, extension: "webp" }) ?? user.defaultAvatarURL ?? null;
}

export function memberToRow(member: GuildMember): MemberRow {
  const roleIds = [...member.roles.cache.keys()].filter(id => id !== member.guild.id);
  return {
    discord_id: member.id,
    username: member.user.username,
    display_name: member.user.globalName ?? null,
    nickname: member.nickname ?? null,
    avatar_url: resolveAvatarUrl(member),
    joined_at: member.joinedAt?.toISOString() ?? null,
    premium_since: member.premiumSince?.toISOString() ?? null,
    roles: roleIds,
    is_bot: member.user.bot,
    // La ligne décrit un membre que la passerelle vient de nous rendre : il est
    // présent, donc sans date de départ. La colonne `left_at` (migration
    // `20260811_discord_departs.sql`) remplace la suppression de la ligne.
    left_at: null,
    updated_at: new Date().toISOString(),
  };
}

function toPgTextArray(values: string[]): string {
  return `{${values.map(v => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

async function upsertRow(row: MemberRow): Promise<void> {
  const rolesLiteral = toPgTextArray(row.roles || []);
  await sql`
    INSERT INTO discord_members (
      discord_id, username, display_name, nickname,
      avatar_url, joined_at, premium_since, roles, is_bot, updated_at
    ) VALUES (
      ${row.discord_id}, ${row.username}, ${row.display_name}, ${row.nickname},
      ${row.avatar_url}, ${row.joined_at}, ${row.premium_since}, ${rolesLiteral}::text[], ${row.is_bot}, NOW()
    )
    ON CONFLICT (discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      nickname = EXCLUDED.nickname,
      avatar_url = EXCLUDED.avatar_url,
      joined_at = COALESCE(EXCLUDED.joined_at, discord_members.joined_at),
      premium_since = EXCLUDED.premium_since,
      roles = EXCLUDED.roles,
      is_bot = EXCLUDED.is_bot,
      -- Un retour efface la date de départ : sans cette ligne, un membre revenu
      -- restait compté comme parti (les statistiques du site filtrent sur
      -- left_at IS NULL) et son profil non réclamé pouvait être supprimé par la
      -- réconciliation des départs du cron.
      left_at = NULL,
      updated_at = NOW()
  `;
}

async function syncUserImage(discordId: string, avatarUrl: string | null): Promise<void> {
  if (!avatarUrl) return;
  await sql`
    UPDATE "user" u
    SET image = ${avatarUrl}, updated_at = NOW()
    FROM account a
    WHERE a.user_id = u.id AND a.provider_id = 'discord' AND a.account_id = ${discordId}
  `;
}

/**
 * Propage l'avatar Discord jusqu'à `profiles.avatar_url`.
 *
 * ── LA TABLE QUE LA SYNCHRO OUBLIAIT ───────────────────────────────────────
 * La synchronisation écrivait `discord_members.avatar_url` et `"user".image`,
 * jamais `profiles.avatar_url` — or c'est CETTE colonne que le site affiche :
 * page de profil publique, commentaires, annuaire de la communauté, tableau de
 * bord. Résultat, la photo posée à l'inscription ne bougeait plus jamais.
 * Relevé le 31/8/2026 : 17 comptes montraient encore un avatar périmé, dont
 * des comptes actifs qui avaient changé le leur depuis des mois.
 *
 * ── LA GARDE N'EST PAS UNE PRÉCAUTION, C'EST LA CONDITION ──────────────────
 * `/dashboard/account` laisse chacun TÉLÉVERSER sa photo (elle part sur notre
 * stockage), et onze comptes portent l'avatar de leur fournisseur d'origine
 * (Google, Twitch). Écraser sans condition remplacerait ces choix par l'avatar
 * Discord à la première synchronisation — une perte silencieuse, et impossible
 * à distinguer d'un bug. On ne remplace donc QUE ce que Discord avait posé, ou
 * rien du tout.
 */
async function syncProfileAvatar(discordId: string, avatarUrl: string | null): Promise<void> {
  if (!avatarUrl) return;
  await sql`
    UPDATE profiles
    SET avatar_url = ${avatarUrl}, updated_at = NOW()
    WHERE discord_id = ${discordId}
      AND avatar_url IS DISTINCT FROM ${avatarUrl}
      AND (avatar_url IS NULL OR avatar_url LIKE '%cdn.discordapp.com%')
  `;
}

/** Les trois tables où vit une photo de profil, mises à jour ensemble. */
async function syncAvatars(discordId: string, avatarUrl: string | null): Promise<void> {
  await syncUserImage(discordId, avatarUrl);
  await syncProfileAvatar(discordId, avatarUrl);
}

export interface SyncReport {
  fetched: number;
  upserted: number;
  errors: { discordId: string; reason: string }[];
  durationMs: number;
}

export async function syncAllMembers(guild: Guild): Promise<SyncReport> {
  const start = Date.now();
  const members = await guild.members.fetch();
  const errors: SyncReport["errors"] = [];
  let upserted = 0;

  for (const member of members.values()) {
    try {
      const row = memberToRow(member);
      await upsertRow(row);
      await syncAvatars(row.discord_id, row.avatar_url);
      upserted++;
    } catch (err) {
      errors.push({
        discordId: member.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    fetched: members.size,
    upserted,
    errors,
    durationMs: Date.now() - start,
  };
}

export async function syncOneMember(member: GuildMember): Promise<void> {
  const row = memberToRow(member);
  await upsertRow(row);
  await syncAvatars(row.discord_id, row.avatar_url);
}

export async function syncOneUser(user: User, guild: Guild): Promise<void> {
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
  if (member) {
    await syncOneMember(member);
    return;
  }
  await sql`
    UPDATE discord_members
    SET username = ${user.username},
        display_name = ${user.globalName ?? null},
        avatar_url = ${resolveUserAvatarUrl(user)},
        is_bot = ${user.bot},
        updated_at = NOW()
    WHERE discord_id = ${user.id}
  `;
  await syncAvatars(user.id, resolveUserAvatarUrl(user));
}
