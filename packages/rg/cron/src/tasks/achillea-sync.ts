/**
 * Projette les données Discord collectées vers les tables d'Achilléa.
 *
 * POURQUOI CETTE TÂCHE EXISTE À NOUVEAU
 * Elle portait ce nom du temps du miroir `postgres_fdw` : elle réalignait alors
 * la FORME de tables étrangères, et la fusion des bases l'a rendue sans objet.
 * Le problème qu'elle traite maintenant est différent, et réel : les tables
 * Discord d'Achilléa (`guild`, `guild_role`, `guild_member_meta`) ont été
 * remplies UNE FOIS, le 8 septembre 2026, par un script manuel
 * (`apps/achillea-bot/scripts/sync-discord-production.ts`) qui n'a jamais été
 * planifié. Leur `scanned_at` n'a pas bougé depuis : la base d'Achilléa décrit
 * un serveur tel qu'il était il y a deux semaines.
 *
 * UNE SEULE COLLECTE, DEUX CONSOMMATEURS
 * `discord:sync` interroge désormais Discord pour les DEUX serveurs et écrit
 * `discord_appartenances` + `discord_roles`. Cette tâche-ci ne parle pas à
 * Discord : elle recopie ce qui vient d'être relevé vers les tables que le bot
 * Achilléa lit. Un seul appel réseau, une seule vérité, deux formes.
 *
 * ELLE N'ÉCRASE JAMAIS UN GRADE
 * `achillea."user".role` (0 à 3) est décidé par le bot, pas par Discord. La
 * projection met à jour le pseudo et l'avatar ; elle ne touche ni au rôle, ni à
 * l'ELO, ni à l'expérience, ni aux clans.
 */

import { sql } from "../lib/db.js";
import { GUILDES_SUIVIES } from "../lib/discord.js";

export interface ResultatSyncAchillea {
	success: boolean;
	/** Membres projetés dans `achillea.guild_member_meta`. */
	membres?: number;
	/** Rôles projetés dans `achillea.guild_role`. */
	roles?: number;
	/** Comptes `achillea."user"` dont l'identité affichée a été rafraîchie. */
	comptes?: number;
	error?: string;
}

/** Guilde d'Achilléa : la seule dont le bot Achilléa a besoin. */
const GUILDE_ACHILLEA =
	GUILDES_SUIVIES.find((guilde) => guilde.cle === "achillea")?.id ?? "1055585286320554055";

export async function runAchilleaSync(): Promise<ResultatSyncAchillea> {
	try {
		// Les tables d'Achilléa portent la RLS de leur ancienne base : leurs
		// politiques n'ouvrent que le SELECT, à `anon` et `authenticated`. Le
		// démon se connecte en rôle `rg`, qui n'a pas `BYPASSRLS` — d'où un
		// « new row violates row-level security policy » sur le premier INSERT.
		// On emprunte `service_role`, dont `rg` est membre, le temps de la
		// projection : c'est le rôle de service déjà utilisé pour toute écriture
		// qui doit traverser une RLS. SET LOCAL reste lié à cette transaction.
		const resultat = await sql.begin(async (tx) => {
			await tx`SET LOCAL ROLE service_role`;
			const [source] = await tx`
				SELECT count(*)::integer AS membres
				  FROM public.discord_appartenances
				 WHERE guild_id = ${GUILDE_ACHILLEA} AND left_at IS NULL`;
			if (!source || Number(source.membres) === 0) {
				throw new Error("Aucune appartenance Achilléa active en source : projection annulée.");
			}

			// La ligne de guilde doit exister avant ses rôles : `guild_role.guild_id`
			// et `guild_member_meta.guild_id` la référencent en clé étrangère.
			await tx`
			INSERT INTO achillea.guild (id, created_at, updated_at, last_interact, deleted)
			VALUES (${GUILDE_ACHILLEA}, now(), now(), now(), false)
			ON CONFLICT (id) DO NOTHING`;

			const roles = await tx`
			INSERT INTO achillea.guild_role (
				id, guild_id, name, color, position, permissions, hoist, mentionable, scanned_at
			)
			SELECT r.role_id, r.guild_id, r.name, COALESCE(r.color, 0), COALESCE(r.position, 0),
			       r.permissions, COALESCE(r.is_hoisted, false), COALESCE(r.is_mentionable, false), now()
			  FROM public.discord_roles r
			 WHERE r.guild_id = ${GUILDE_ACHILLEA}
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				color = EXCLUDED.color,
				position = EXCLUDED.position,
				permissions = EXCLUDED.permissions,
				hoist = EXCLUDED.hoist,
				mentionable = EXCLUDED.mentionable,
				scanned_at = now()
			RETURNING id`;

			// Un rôle supprimé sur Discord disparaît aussi côté Achilléa : le laisser
			// ferait porter à des membres des rôles qui n'existent plus.
			await tx`
			DELETE FROM achillea.guild_role
			 WHERE guild_id = ${GUILDE_ACHILLEA}
			   AND id NOT IN (SELECT role_id FROM public.discord_roles WHERE guild_id = ${GUILDE_ACHILLEA})`;

			const membres = await tx`
			INSERT INTO achillea.guild_member_meta (
				guild_id, user_id, nick, joined_at, premium_since, roles, pending, scanned_at
			)
			SELECT a.guild_id, a.discord_id, a.nickname, a.joined_at, a.premium_since,
			       a.roles, false, now()
			  FROM public.discord_appartenances a
			 WHERE a.guild_id = ${GUILDE_ACHILLEA}
			   AND a.left_at IS NULL
			ON CONFLICT (guild_id, user_id) DO UPDATE SET
				nick = EXCLUDED.nick,
				joined_at = COALESCE(EXCLUDED.joined_at, achillea.guild_member_meta.joined_at),
				premium_since = EXCLUDED.premium_since,
				roles = EXCLUDED.roles,
				scanned_at = now()
			RETURNING user_id`;

			await tx`
			DELETE FROM achillea.guild_member_meta
			 WHERE guild_id = ${GUILDE_ACHILLEA}
			   AND user_id NOT IN (
			       SELECT discord_id FROM public.discord_appartenances
			        WHERE guild_id = ${GUILDE_ACHILLEA} AND left_at IS NULL
			   )`;

			// Identité affichée seulement, et seulement si elle a changé : un UPDATE
			// inconditionnel réécrirait 3 315 lignes toutes les demi-heures.
			const comptes = await tx`
			UPDATE achillea."user" u
			   SET username = COALESCE(a.username, u.username),
			       avatar = COALESCE(a.avatar_url, u.avatar),
			       updated_at = now()
			  FROM public.discord_appartenances a
			 WHERE a.guild_id = ${GUILDE_ACHILLEA}
			   AND a.left_at IS NULL
			   AND a.discord_id = u.id
			   AND (u.username IS DISTINCT FROM a.username OR u.avatar IS DISTINCT FROM a.avatar_url)
			RETURNING u.id`;

			return { comptes: comptes.length, membres: membres.length, roles: roles.length };
		});

		console.log(
			`[achillea] projection Discord → Achilléa : ${resultat.roles} rôles, ${resultat.membres} membres, ${resultat.comptes} comptes rafraîchis`
		);

		return {
			...resultat,
			success: true,
		};
	} catch (err) {
		const motif = err instanceof Error ? err.message : String(err);
		console.error("[achillea] projection impossible :", motif);
		return { error: motif, success: false };
	}
}
