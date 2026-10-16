import "server-only";

// Lectures publiques du fil Discord — Postgres DIRECT (pas de PostgREST).
//
// Même parti pris que `/community` : la page ne doit pas dépendre de la
// disponibilité du Data API. Les garde-fous de la RLS sont retranscrits ici en
// SQL (salon `suivi` obligatoire, `deleted_at IS NULL`) pour que le pool
// serveur, qui se connecte en rôle propriétaire, n'expose jamais plus que ce
// qu'un visiteur anonyme aurait le droit de lire.

import { getPgPool } from "@/lib/db/pg";

import { type ContexteMentions, extraireIdentifiantsMentionnes } from "./markdown-ast";
import { type MessageDiscord, type SalonDiscord, normaliserMessage } from "./types";
import { couleurDiscord } from "./url";

/** Nombre de messages chargés par page (borne dure, y compris via l'API). */
export const LIMITE_MESSAGES = 50;

/** Nombre de messages rendus au premier affichage de la page. */
export const MESSAGES_PAR_DEFAUT = 20;

const COLONNES_MESSAGE = `
	m.message_id, m.channel_id, m.author_id, m.author_username, m.author_display_name,
	m.author_avatar_url, m.author_is_bot, m.type, m.content, m.attachments, m.embeds,
	m.stickers, m.reactions, m.poll, m.reference_message_id, m.pinned,
	m.created_at, m.edited_at
`;

/** Salons republiés publiquement, dans l'ordre du serveur Discord. */
export async function listerSalonsSuivis(): Promise<SalonDiscord[]> {
	try {
		const { rows } = await getPgPool().query<SalonDiscord & { position: number | null }>(
			`SELECT channel_id, name, type, topic, icon_emoji, position
			 FROM discord_channels
			 WHERE suivi = true
			 ORDER BY position NULLS LAST, name`
		);
		return rows.map((ligne) => ({
			channel_id: ligne.channel_id,
			icon_emoji: ligne.icon_emoji,
			name: ligne.name,
			topic: ligne.topic,
			type: ligne.type,
		}));
	} catch (error) {
		console.error("[discord] lecture des salons suivis impossible", error);
		return [];
	}
}

/** Vrai si le salon est bien republié publiquement. */
export async function salonEstSuivi(channelId: string): Promise<boolean> {
	try {
		const { rowCount } = await getPgPool().query(
			"SELECT 1 FROM discord_channels WHERE channel_id = $1 AND suivi = true",
			[channelId]
		);
		return (rowCount ?? 0) > 0;
	} catch (error) {
		console.error("[discord] verification du salon impossible", error);
		return false;
	}
}

export interface OptionsMessages {
	channelId: string;
	/** Identifiant du message servant de curseur : on renvoie ce qui le précède. */
	before?: string | null;
	limit?: number;
}

/**
 * Messages visibles d'un salon suivi, du plus récent au plus ancien.
 * La pagination remonte le temps via le curseur `before` (identifiant Discord).
 */
export async function listerMessages({
	before,
	channelId,
	limit = MESSAGES_PAR_DEFAUT,
}: OptionsMessages): Promise<MessageDiscord[]> {
	const taille = Math.min(Math.max(Math.trunc(limit) || 1, 1), LIMITE_MESSAGES);
	try {
		// `before` est résolu en (date, identifiant) : l'index partiel
		// (channel_id, created_at DESC) WHERE deleted_at IS NULL reste utilisable,
		// et l'identifiant départage les messages de même horodatage.
		const { rows } = await getPgPool().query<Record<string, unknown>>(
			`WITH repere AS (
				SELECT created_at, message_id FROM discord_messages WHERE message_id = $2::text
			)
			SELECT ${COLONNES_MESSAGE}
			FROM discord_messages m
			JOIN discord_channels c ON c.channel_id = m.channel_id AND c.suivi = true
			WHERE m.channel_id = $1
				AND m.deleted_at IS NULL
				AND (
					$2::text IS NULL
					OR EXISTS (
						SELECT 1 FROM repere r
						WHERE m.created_at < r.created_at
							OR (m.created_at = r.created_at AND m.message_id < r.message_id)
					)
				)
			ORDER BY m.created_at DESC, m.message_id DESC
			LIMIT $3`,
			[channelId, before ?? null, taille]
		);
		return rows
			.map((ligne) => normaliserMessage(ligne))
			.filter((message): message is MessageDiscord => message !== null);
	} catch (error) {
		console.error("[discord] lecture des messages impossible", error);
		return [];
	}
}

/** Un message précis, à condition qu'il soit visible et dans un salon suivi. */
export async function lireMessage(messageId: string): Promise<MessageDiscord | null> {
	try {
		const { rows } = await getPgPool().query<Record<string, unknown>>(
			`SELECT ${COLONNES_MESSAGE}
			 FROM discord_messages m
			 JOIN discord_channels c ON c.channel_id = m.channel_id AND c.suivi = true
			 WHERE m.message_id = $1 AND m.deleted_at IS NULL`,
			[messageId]
		);
		return rows[0] ? normaliserMessage(rows[0]) : null;
	} catch (error) {
		console.error("[discord] lecture du message impossible", error);
		return null;
	}
}

/**
 * Résout EN UNE FOIS, côté serveur, les pseudos / rôles / salons mentionnés
 * dans un lot de messages. Le navigateur ne fait aucune requête de résolution.
 */
export async function construireContexteMentions(
	messages: MessageDiscord[]
): Promise<ContexteMentions> {
	const contexte: ContexteMentions = { roles: {}, salons: {}, utilisateurs: {} };

	// Les mentions peuvent aussi vivre dans le texte des encarts (sondages EasyPoll).
	const textes: string[] = [];
	for (const message of messages) {
		textes.push(message.content);
		for (const encart of message.embeds) {
			if (encart.titre) textes.push(encart.titre);
			if (encart.description) textes.push(encart.description);
			for (const champ of encart.champs) {
				textes.push(champ.nom, champ.valeur);
			}
		}
	}

	const ids = extraireIdentifiantsMentionnes(textes);
	if (ids.utilisateurs.length === 0 && ids.roles.length === 0 && ids.salons.length === 0) {
		return contexte;
	}

	const pool = getPgPool();
	try {
		const [utilisateurs, roles, salons] = await Promise.all([
			ids.utilisateurs.length > 0
				? pool.query<{
						discord_id: string;
						username: string;
						display_name: string | null;
						nickname: string | null;
					}>(
						`SELECT discord_id, username, display_name, nickname
						 FROM discord_members WHERE discord_id = ANY($1::text[])`,
						[ids.utilisateurs]
					)
				: null,
			ids.roles.length > 0
				? pool.query<{ role_id: string; name: string; color: number | null }>(
						`SELECT role_id, name, color FROM discord_roles WHERE role_id = ANY($1::text[])`,
						[ids.roles]
					)
				: null,
			ids.salons.length > 0
				? pool.query<{ channel_id: string; name: string }>(
						`SELECT channel_id, name FROM discord_channels WHERE channel_id = ANY($1::text[])`,
						[ids.salons]
					)
				: null,
		]);

		for (const ligne of utilisateurs?.rows ?? []) {
			contexte.utilisateurs[ligne.discord_id] =
				ligne.nickname ?? ligne.display_name ?? ligne.username;
		}
		for (const ligne of roles?.rows ?? []) {
			contexte.roles[ligne.role_id] = {
				couleur: couleurDiscord(ligne.color),
				nom: ligne.name,
			};
		}
		for (const ligne of salons?.rows ?? []) {
			contexte.salons[ligne.channel_id] = ligne.name;
		}
	} catch (error) {
		// Sans résolution, le rendu retombe sur « @membre » / « @rôle » : dégradé,
		// jamais cassé.
		console.error("[discord] resolution des mentions impossible", error);
	}

	return contexte;
}

/** Fusionne deux contextes de mentions (page initiale + recharges du client). */
export function fusionnerContextes(
	base: ContexteMentions,
	ajout: ContexteMentions
): ContexteMentions {
	return {
		roles: { ...base.roles, ...ajout.roles },
		salons: { ...base.salons, ...ajout.salons },
		utilisateurs: { ...base.utilisateurs, ...ajout.utilisateurs },
	};
}
