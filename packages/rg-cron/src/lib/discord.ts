/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client, IntentsBitField, Routes, type Guild, type GuildMember } from "discord.js";
import { listGuildMembers } from "@rosegriffon/discord-sync";
import { sql } from "./db.js";
import { resolveGuildId } from "@rosegriffon/types/discord";

export const GUILD_ID = resolveGuildId(Bun.env as Record<string, string | undefined>);
export const DISCORD_TOKEN = Bun.env.DISCORD_BOT_TOKEN || Bun.env.DISCORD_TOKEN;

/**
 * Les serveurs Discord que la synchronisation balaie.
 *
 * Le bot Rose Griffon est membre des DEUX — vérifié sur
 * `GET /users/@me/guilds` — et son intent « Server Members » est actif sur les
 * deux : un seul jeton suffit, il n'y a pas à emprunter celui d'Achilléa.
 *
 * `GUILD_ID` reste le serveur Rose Griffon : c'est lui qui porte l'identité du
 * site (avatars, pré-création des profils, multicomptes), et lui seul alimente
 * `discord_members`. Les autres serveurs ne remplissent que
 * `discord_appartenances`.
 */
export const GUILDES_SUIVIES = [
  { id: GUILD_ID ?? "1072991720268111892", cle: "rose-griffon", nom: "Rose Griffon" },
  { id: "1055585286320554055", cle: "achillea", nom: "Achilléa" },
] as const;

export type CleGuilde = (typeof GUILDES_SUIVIES)[number]["cle"];

let discordClient: Client | null = null;
let botId: string | null = null;

/**
 * Client discord.js en mode REST seul : aucune connexion à la passerelle.
 *
 * Une fonction serverless ne tient pas de WebSocket ouverte entre deux appels,
 * et toutes les lectures des tâches passent par l'API REST (`guilds.fetch`,
 * `roles.fetch`, `channels.fetch`, `members.list`, `users.fetch`). Le client
 * n'est donc jamais connecté : seul son jeton REST est posé. Les intents ne
 * servent qu'à la passerelle ; `GuildMembers` est déclaré pour que le miroir
 * partagé reconnaisse un inventaire complet obtenu par `members.list`.
 */
export function getDiscordClient(): Client | null {
  if (!DISCORD_TOKEN) return null;
  if (!discordClient) {
    const client = new Client({ intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers] });
    client.token = DISCORD_TOKEN;
    client.rest.setToken(DISCORD_TOKEN);
    discordClient = client;
  }
  return discordClient;
}

/** Identifiant de l'utilisateur bot du jeton (`GET /users/@me`), mis en cache. */
export async function identifiantBot(client: Client): Promise<string> {
  if (!botId) {
    const moi = (await client.rest.get(Routes.user())) as { id: string };
    botId = moi.id;
  }
  return botId;
}

/** Nombre de membres annoncé par Discord : `member_count` en passerelle, approximation en REST. */
export function membresAnnonces(guild: Guild): number {
  return guild.memberCount ?? guild.approximateMemberCount ?? 0;
}

// ─── SERVICES DE SYNCHRONISATION ──────────────────────────────────────────

function resolveAvatarUrl(member: GuildMember): string | null {
  const guildAvatar = member.avatarURL({ size: 256, extension: "webp" });
  if (guildAvatar) return guildAvatar;
  const userAvatar = member.user.avatarURL({ size: 256, extension: "webp" });
  if (userAvatar) return userAvatar;
  return member.user.defaultAvatarURL ?? null;
}

function toPgTextArray(values: string[]): string {
  return `{${values.map(v => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

interface MemberRow {
  discord_id: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string | null;
  premium_since: string | null;
  roles: string[];
  is_bot: boolean;
  updated_at: string;
}

function memberToRow(member: GuildMember): MemberRow {
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
    updated_at: new Date().toISOString(),
  };
}

/** Taille des lots d'écriture : une requête par lot, quel que soit le serveur. */
const TAILLE_LOT = 1000;

/** Les lignes d'un lot, liées en UN texte JSON (Bun.sql lie un tableau d'objets comme un tableau Postgres). */
function lot(rows: readonly MemberRow[]): string {
  return JSON.stringify(rows);
}

/** Écrit l'identité Rose Griffon (`discord_members`) d'un lot de membres. */
async function upsertRows(rows: readonly MemberRow[]): Promise<void> {
  await sql`
    INSERT INTO discord_members (
      discord_id, username, display_name, nickname,
      avatar_url, joined_at, premium_since, roles, is_bot, updated_at
    )
    SELECT r.discord_id, r.username, r.display_name, r.nickname, r.avatar_url, r.joined_at, r.premium_since,
           ARRAY(SELECT jsonb_array_elements_text(r.roles))::text[], r.is_bot, NOW()
      FROM jsonb_to_recordset(${lot(rows)}::text::jsonb) AS r(
        discord_id text, username text, display_name text, nickname text, avatar_url text,
        joined_at timestamptz, premium_since timestamptz, roles jsonb, is_bot boolean
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
      updated_at = NOW()
  `;
}

/**
 * Écrit l'appartenance à un serveur donné, pour un lot de membres.
 *
 * Même ligne source que `upsertRows`, autre question : `discord_members` dit
 * « qui est cette personne pour Rose Griffon », `discord_appartenances` dit
 * « de quels serveurs elle est membre, avec quels rôles ».
 */
async function upsertAppartenances(guildId: string, rows: readonly MemberRow[]): Promise<void> {
  await sql`
    INSERT INTO discord_appartenances (
      guild_id, discord_id, username, display_name, nickname,
      avatar_url, joined_at, premium_since, roles, is_bot, updated_at, left_at
    )
    SELECT ${guildId}, r.discord_id, r.username, r.display_name, r.nickname, r.avatar_url, r.joined_at,
           r.premium_since, ARRAY(SELECT jsonb_array_elements_text(r.roles))::text[], r.is_bot, NOW(), NULL
      FROM jsonb_to_recordset(${lot(rows)}::text::jsonb) AS r(
        discord_id text, username text, display_name text, nickname text, avatar_url text,
        joined_at timestamptz, premium_since timestamptz, roles jsonb, is_bot boolean
      )
    ON CONFLICT (guild_id, discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      nickname = EXCLUDED.nickname,
      avatar_url = EXCLUDED.avatar_url,
      joined_at = COALESCE(EXCLUDED.joined_at, discord_appartenances.joined_at),
      premium_since = EXCLUDED.premium_since,
      roles = EXCLUDED.roles,
      is_bot = EXCLUDED.is_bot,
      updated_at = NOW(),
      -- Un membre revu est un membre revenu : le départ précédent est effacé.
      left_at = NULL
  `;
}

/** Recopie l'avatar Discord sur les comptes du site reliés à ces membres. */
async function syncUserImages(rows: readonly MemberRow[]): Promise<void> {
  await sql`
    UPDATE "user" u
       SET image = r.avatar_url, updated_at = NOW()
      FROM account a, jsonb_to_recordset(${lot(rows)}::text::jsonb) AS r(discord_id text, avatar_url text)
     WHERE a.user_id = u.id
       AND a.provider_id = 'discord'
       AND a.account_id = r.discord_id
       AND r.avatar_url IS NOT NULL
       AND u.image IS DISTINCT FROM r.avatar_url
  `;
}

export interface SyncReport {
  fetched: number;
  upserted: number;
  /** Membres marqués comme partis par la réconciliation de ce balayage. */
  partis: number;
  errors: { discordId: string; reason: string }[];
  durationMs: number;
}

export async function syncAllMembers(
  guild: Guild,
  verifiedMembers?: ReadonlyMap<string, GuildMember>,
): Promise<SyncReport> {
  const start = Date.now();
  // Inventaire complet par REST paginé : un inventaire incomplet ne doit jamais
  // déclencher la purge des départs.
  const members = verifiedMembers ?? (await listGuildMembers(guild));
  if (members.size === 0 && membresAnnonces(guild) > 0) {
    throw new Error(`Inventaire Discord vide pour ${guild.id} (${membresAnnonces(guild)} membres annoncés).`);
  }
  console.log(`[Cron Discord] ${members.size} membres récupérés depuis Discord.`);
  const errors: SyncReport["errors"] = [];
  let upserted = 0;

  // `discord_members` et la pré-création des profils ne valent QUE pour le
  // serveur Rose Griffon : ce sont des mécanismes d'identité du site, pas
  // d'appartenance. Les appliquer au serveur Achilléa créerait des profils
  // Rose Griffon pour des gens qui n'y ont jamais mis les pieds, et marquerait
  // « partis » tous les membres de l'autre serveur à chaque balayage.
  const estServeurPrincipal = guild.id === (GUILD_ID ?? GUILDES_SUIVIES[0].id);

  // Écriture par lots : une requête par millier de membres, et non trois par
  // membre — une fonction serverless n'a pas le temps de 6000 allers-retours.
  const rows = [...members.values()].map(memberToRow);
  for (let i = 0; i < rows.length; i += TAILLE_LOT) {
    const tranche = rows.slice(i, i + TAILLE_LOT);
    try {
      await upsertAppartenances(guild.id, tranche);
      if (estServeurPrincipal) {
        await upsertRows(tranche);
        await syncUserImages(tranche);
      }
      upserted += tranche.length;
    } catch (err) {
      errors.push({
        discordId: `${tranche[0]?.discord_id ?? guild.id}…`,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Réconciliation : tout membre que ce balayage complet n'a pas vu a quitté le
  // serveur. Sans cette étape, seuls les départs observés en direct étaient
  // enregistrés, et le démon manque forcément ceux de ses coupures.
  let partis = 0;
  if (errors.length === 0) {
    try {
      const sortisGuilde = await sql`
			UPDATE discord_appartenances
			   SET left_at = now()
			 WHERE guild_id = ${guild.id}
			   AND left_at IS NULL
			   AND updated_at < ${new Date(start).toISOString()}::timestamptz
			RETURNING discord_id`;
      partis = sortisGuilde.length;

      if (estServeurPrincipal) {
        await sql`
				UPDATE discord_members
				   SET left_at = now()
				 WHERE left_at IS NULL
				   AND updated_at < ${new Date(start).toISOString()}::timestamptz`;
        if (partis > 0) {
          await sql`
					DELETE FROM profiles
					 WHERE claimed_at IS NULL
					   AND discord_id IN (
					       SELECT discord_id FROM discord_members WHERE left_at IS NOT NULL
					   )`;
        }
      }
    } catch (err) {
      console.error("[discord] réconciliation des départs impossible:", err);
      errors.push({
        discordId: guild.id,
        reason: `réconciliation: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // L'invariant « tout membre actuel a un profil » est maintenu ici plutôt que
  // par un trigger : un trigger tournerait à chaque ligne de chaque balayage et
  // ferait échouer la synchro entière à la moindre exception.
  if (estServeurPrincipal) {
    try {
      const [res] = await sql`SELECT * FROM rg_precreer_profils_discord()`;
      if (res?.crees) {
        console.log(`[discord] ${res.crees} profil(s) pré-créé(s)`);
      }
    } catch (err) {
      console.error("[discord] pré-création des profils impossible:", err);
    }
  }

  return {
    fetched: members.size,
    upserted,
    partis,
    errors,
    durationMs: Date.now() - start,
  };
}

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

  // Récupérer les comptes Discord reliés pour éviter les requêtes SQL lentes d'update inutile sur la table "user"
  const linkedAccounts = await sql`SELECT account_id FROM account WHERE provider_id = 'discord'`;
  const linkedDiscordIds = new Set(linkedAccounts.map((a: any) => a.account_id));

  for (const row of rows) {
    try {
      // Utiliser le cache en priorité (fetch sans force: true interroge le cache d'abord)
      const user = await client.users.fetch(row.discord_user_id);
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

      if (linkedDiscordIds.has(row.discord_user_id)) {
        await sql`
          UPDATE "user" u
          SET image = ${newPng}, updated_at = NOW()
          FROM account a
          WHERE a.user_id = u.id
            AND a.provider_id = 'discord'
            AND a.account_id = ${row.discord_user_id}
        `;
      }

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

export interface RoleSyncReport {
  fetched: number;
  upserted: number;
  errors: { roleId: string; name: string; reason: string }[];
  durationMs: number;
}

export async function syncAllRoles(guild: Guild): Promise<RoleSyncReport> {
  const start = Date.now();
  const roles = await guild.roles.fetch();
  const errors: RoleSyncReport["errors"] = [];
  let upserted = 0;

  for (const role of roles.values()) {
    try {
      await sql`
				INSERT INTO discord_roles (
					role_id, guild_id, name, color, position, is_hoisted, is_mentionable, permissions, icon_url, updated_at
				) VALUES (
					${role.id}, ${guild.id}, ${role.name}, ${role.color}, ${role.position}, ${role.hoist}, ${role.mentionable}, ${role.permissions.bitfield.toString()}, ${role.iconURL({ size: 128, extension: "webp" }) ?? null}, NOW()
				)
				ON CONFLICT (role_id) DO UPDATE SET
					name = EXCLUDED.name,
					color = EXCLUDED.color,
					position = EXCLUDED.position,
					is_hoisted = EXCLUDED.is_hoisted,
					is_mentionable = EXCLUDED.is_mentionable,
					permissions = EXCLUDED.permissions,
					icon_url = EXCLUDED.icon_url,
					updated_at = NOW()
			`;
      upserted++;
    } catch (err) {
      errors.push({
        roleId: role.id,
        name: role.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Un rôle supprimé sur Discord restait en base indéfiniment : la table en
  // comptait 95 pour 91 rôles réels, et la hiérarchie affichée inventait donc
  // des échelons qui n'existent plus.
  if (errors.length === 0)
    try {
      const vivants = [...roles.keys()];
      await sql`
			DELETE FROM discord_roles
			 WHERE guild_id = ${guild.id}
			   AND role_id <> ALL (${toPgTextArray(vivants)}::text[])`;
    } catch (err) {
      console.error("[discord] purge des rôles disparus impossible:", err);
      errors.push({
        roleId: guild.id,
        name: guild.name,
        reason: `purge: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

  return {
    fetched: roles.size,
    upserted,
    errors,
    durationMs: Date.now() - start,
  };
}
