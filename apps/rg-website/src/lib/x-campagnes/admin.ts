import "server-only";

/**
 * LECTURES D'ADMINISTRATION D'UNE CAMPAGNE.
 *
 * Séparé de `queries.ts` — qui sert la page PUBLIQUE — parce que les deux n'ont
 * pas les mêmes règles. `queries.ts` filtre systématiquement (`publiee`,
 * `not masque`, `deleted_at is null`) : c'est ce qui empêche une campagne
 * dépubliée ou une création modérée d'atteindre un visiteur. L'écran d'admin,
 * lui, doit voir EXACTEMENT le contraire — les campagnes non publiées, les
 * créations masquées, les relais en échec — sinon il ne sert à rien : on ne
 * démasque pas ce qu'on ne voit pas.
 *
 * ⚠ CES FONCTIONS NE DOIVENT ÊTRE APPELÉES QUE DERRIÈRE `requireAdmin()`.
 * `getPgPool()` se connecte avec le rôle `rg`, PROPRIÉTAIRE des tables : la RLS
 * ne s'applique pas (exemption propriétaire), et rien dans ces requêtes ne
 * protège quoi que ce soit. La garde est celle de `app/admin/layout.tsx`, plus
 * celle de chaque action d'écriture.
 */

import { getPgPool } from "@/lib/db/pg";

import type { Campagne } from "./types";

/** Une campagne telle que l'admin la manipule — colonnes brutes, rien de masqué. */
export interface CampagneAdmin extends Campagne {
	/** Variantes récoltées EN SILENCE, jamais affichées publiquement. */
	hashtagsRattrapage: string[];
	publiee: boolean;
	/** Salon Discord de suivi (`relais_salon`), distinct des salons de dépôt. */
	relaisSalon: string | null;
	relaisDepuis: string | null;
	updatedAt: string | null;
}

/** État d'un salon Discord, tel que la veille le connaît. */
export interface SalonSuivi {
	salonId: string;
	/** Rôle du salon pour cette campagne. */
	role: "depot" | "relais";
	nom: string | null;
	/** `false` = la veille n'archive pas ce salon : rien n'en remontera jamais. */
	suivi: boolean;
	/** `false` = l'historique est encore en cours de remontée. */
	backfillComplet: boolean;
	messages: number;
	dernierMessageLe: string | null;
	/** Créations rattachées à la campagne depuis ce salon. */
	creations: number;
}

/** Compteurs de la campagne, sources séparées — un total seul cacherait un trou. */
export interface BilanCampagne {
	postsX: number;
	postsXMasques: number;
	creationsDiscord: number;
	creationsDiscordMasquees: number;
	misEnAvant: number;
	relayes: number;
	relaisSautes: number;
	/** Créations éligibles au relais qui n'y sont pas encore passées. */
	relaisEnAttente: number;
	dernierRelaisLe: string | null;
	collecteLe: string | null;
}

/** Une création, vue de l'admin : masquée ou non, relayée ou non. */
export interface CreationAdmin {
	source: "x" | "discord";
	reference: string;
	auteur: string;
	texte: string;
	image: string | null;
	lien: string;
	hashtag: string | null;
	publieLe: string | null;
	masque: boolean;
	motifMasquage: string | null;
	misEnAvant: boolean;
	/** `null` = jamais relayée ; sinon l'identifiant du message Discord de relais. */
	relaisMessageId: string | null;
	relaisSauteMotif: string | null;
}

function texte(valeur: unknown): string {
	return typeof valeur === "string" ? valeur : "";
}

function tableauTexte(valeur: unknown): string[] {
	return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : [];
}

function iso(valeur: unknown): string | null {
	if (valeur instanceof Date) return valeur.toISOString();
	return typeof valeur === "string" && valeur ? valeur : null;
}

/**
 * La campagne à administrer, publiée ou non.
 *
 * Sans slug, on rend la campagne PRINCIPALE — c'est celle que sert `/iergday`,
 * donc celle qu'on vient administrer neuf fois sur dix.
 */
export async function chargerCampagneAdmin(slug?: string): Promise<CampagneAdmin | null> {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query(
			`select slug, titre, sur_titre, description, image_couverture, image_affiche,
			        image_reglement, note_affiche, reglement, hashtags, hashtags_affichage,
			        hashtags_rattrapage, debut_le, fin_le, actif, publiee, principale,
			        collecte_le, salons_depot, relais_salon, relais_depuis, updated_at
			   from public.x_campagnes
			  where ($1::text is null and principale) or slug = $1::text
			  order by principale desc
			  limit 1`,
			[slug ?? null]
		);
		const l = rows[0];
		if (!l) return null;

		return {
			actif: Boolean(l.actif),
			collecteLe: iso(l.collecte_le),
			debutLe: iso(l.debut_le),
			description: l.description ?? null,
			finLe: iso(l.fin_le),
			hashtags: tableauTexte(l.hashtags),
			hashtagsAffichage: tableauTexte(l.hashtags_affichage),
			hashtagsRattrapage: tableauTexte(l.hashtags_rattrapage),
			imageAffiche: l.image_affiche ?? null,
			imageCouverture: l.image_couverture ?? null,
			imageReglement: l.image_reglement ?? null,
			noteAffiche: l.note_affiche ?? null,
			principale: Boolean(l.principale),
			publiee: Boolean(l.publiee),
			reglement: tableauTexte(l.reglement),
			relaisDepuis: iso(l.relais_depuis),
			relaisSalon: l.relais_salon ?? null,
			salonsDepot: tableauTexte(l.salons_depot),
			slug: texte(l.slug),
			surTitre: l.sur_titre ?? null,
			titre: texte(l.titre),
			updatedAt: iso(l.updated_at),
		};
	} catch (err) {
		console.error("[admin/campagnes] chargerCampagneAdmin :", err);
		return null;
	}
}

/** Toutes les campagnes, pour le sélecteur — publiées ou non. */
export async function listerCampagnesAdmin(): Promise<
	Array<{ slug: string; titre: string; principale: boolean; publiee: boolean }>
> {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query(
			`select slug, titre, principale, publiee
			   from public.x_campagnes
			  order by principale desc, debut_le desc nulls last, slug`
		);
		return rows.map((l) => ({
			principale: Boolean(l.principale),
			publiee: Boolean(l.publiee),
			slug: texte(l.slug),
			titre: texte(l.titre),
		}));
	} catch (err) {
		console.error("[admin/campagnes] listerCampagnesAdmin :", err);
		return [];
	}
}

/**
 * L'état RÉEL des deux salons de la campagne.
 *
 * Le salon de dépôt et le salon de relais n'ont pas le même rôle et ne se
 * diagnostiquent pas pareil : un dépôt non `suivi` ne remontera JAMAIS de
 * création (la récolte lit `discord_messages`, pas Discord) ; un salon de relais
 * non suivi, lui, est parfaitement normal — le bot y écrit, il n'y lit pas.
 * C'est pour ça que `role` accompagne chaque ligne : le même `suivi: false` est
 * une panne d'un côté et l'état attendu de l'autre.
 */
export async function etatSalonsCampagne(campagne: CampagneAdmin): Promise<SalonSuivi[]> {
	const salons: Array<{ id: string; role: "depot" | "relais" }> = [
		...campagne.salonsDepot.map((id) => ({ id, role: "depot" as const })),
		...(campagne.relaisSalon ? [{ id: campagne.relaisSalon, role: "relais" as const }] : []),
	];
	if (salons.length === 0) return [];

	try {
		const pool = getPgPool();
		const ids = salons.map((s) => s.id);
		const { rows } = await pool.query(
			`select c.channel_id, c.name, c.suivi, c.backfill_complete, c.message_count,
			        (select max(m.created_at) from public.discord_messages m
			          where m.channel_id = c.channel_id and m.deleted_at is null) as dernier_le,
			        (select count(*) from public.campagne_creations_discord d
			          join public.discord_messages m2 on m2.message_id = d.message_id
			         where d.campagne_slug = $2 and m2.channel_id = c.channel_id) as creations
			   from public.discord_channels c
			  where c.channel_id = any($1::text[])`,
			[ids, campagne.slug]
		);
		const parId = new Map(rows.map((l) => [texte(l.channel_id), l]));

		return salons.map(({ id, role }) => {
			const l = parId.get(id);
			return {
				backfillComplet: Boolean(l?.backfill_complete),
				creations: Number(l?.creations ?? 0),
				dernierMessageLe: iso(l?.dernier_le),
				messages: Number(l?.message_count ?? 0),
				nom: l?.name ?? null,
				role,
				salonId: id,
				suivi: Boolean(l?.suivi),
			};
		});
	} catch (err) {
		console.error("[admin/campagnes] etatSalonsCampagne :", err);
		// Un salon dont on ignore l'état vaut mieux qu'un écran vide : on rend la
		// liste déclarée, non renseignée, plutôt que de faire disparaître la section.
		return salons.map(({ id, role }) => ({
			backfillComplet: false,
			creations: 0,
			dernierMessageLe: null,
			messages: 0,
			nom: null,
			role,
			salonId: id,
			suivi: false,
		}));
	}
}

/** Les compteurs de la campagne, source par source. */
export async function bilanCampagne(campagne: CampagneAdmin): Promise<BilanCampagne> {
	const vide: BilanCampagne = {
		collecteLe: campagne.collecteLe,
		creationsDiscord: 0,
		creationsDiscordMasquees: 0,
		dernierRelaisLe: null,
		misEnAvant: 0,
		postsX: 0,
		postsXMasques: 0,
		relaisEnAttente: 0,
		relaisSautes: 0,
		relayes: 0,
	};

	try {
		const pool = getPgPool();
		const { rows } = await pool.query(
			`select
			   (select count(*) from public.x_campagne_posts where campagne_slug = $1 and not masque) as x_ok,
			   (select count(*) from public.x_campagne_posts where campagne_slug = $1 and masque) as x_masques,
			   (select count(*) from public.campagne_creations_discord where campagne_slug = $1 and not masque) as d_ok,
			   (select count(*) from public.campagne_creations_discord where campagne_slug = $1 and masque) as d_masques,
			   (select count(*) from public.x_campagne_posts where campagne_slug = $1 and mis_en_avant)
			     + (select count(*) from public.campagne_creations_discord where campagne_slug = $1 and mis_en_avant) as en_avant,
			   (select count(*) from public.x_campagne_relais where campagne_slug = $1 and message_id is not null) as relayes,
			   (select count(*) from public.x_campagne_relais where campagne_slug = $1 and saute_motif is not null) as sautes,
			   (select max(poste_le) from public.x_campagne_relais where campagne_slug = $1 and message_id is not null) as dernier_relais,
			   -- Eligibles au relais et pas encore traitees : c'est CE nombre qui dit
			   -- si le relais est en retard, pas l'ecart entre deux totaux (les
			   -- creations anterieures a relais_depuis ne partiront jamais).
			   (select count(*) from public.x_campagne_posts p
			     where p.campagne_slug = $1 and not p.masque
			       and ($2::timestamptz is null or p.publie_le >= $2::timestamptz)
			       and not exists (select 1 from public.x_campagne_relais r
			                        where r.campagne_slug = p.campagne_slug
			                          and r.source = 'x' and r.reference_id = p.tweet_id))
			   + (select count(*) from public.campagne_creations_discord d
			       where d.campagne_slug = $1 and not d.masque
			         and ($2::timestamptz is null or d.publie_le >= $2::timestamptz)
			         and not exists (select 1 from public.x_campagne_relais r
			                          where r.campagne_slug = d.campagne_slug
			                            and r.source = 'discord' and r.reference_id = d.message_id)) as en_attente`,
			[campagne.slug, campagne.relaisDepuis]
		);
		const l = rows[0];
		if (!l) return vide;

		return {
			collecteLe: campagne.collecteLe,
			creationsDiscord: Number(l.d_ok ?? 0),
			creationsDiscordMasquees: Number(l.d_masques ?? 0),
			dernierRelaisLe: iso(l.dernier_relais),
			misEnAvant: Number(l.en_avant ?? 0),
			postsX: Number(l.x_ok ?? 0),
			postsXMasques: Number(l.x_masques ?? 0),
			relaisEnAttente: Number(l.en_attente ?? 0),
			relaisSautes: Number(l.sautes ?? 0),
			relayes: Number(l.relayes ?? 0),
		};
	} catch (err) {
		console.error("[admin/campagnes] bilanCampagne :", err);
		return vide;
	}
}

/**
 * Les dernières créations, MASQUÉES COMPRISES.
 *
 * C'est la différence avec `listerPostsCampagne` : ici le masquage est une
 * COLONNE à afficher, pas un filtre à appliquer. Une modération invisible ne se
 * corrige pas.
 */
export async function listerCreationsAdmin(
	slug: string,
	limite = 40
): Promise<CreationAdmin[]> {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query(
			`(select 'x' as source, p.tweet_id as reference,
			         coalesce('@' || t.author_username, t.author_name, 'auteur inconnu') as auteur,
			         coalesce(t.text, '') as texte, t.media as media, null::jsonb as images,
			         t.author_username as pseudo, null::text as salon_id, null::text as guild_id,
			         p.hashtag_trouve, p.publie_le, p.masque, p.motif_masquage, p.mis_en_avant,
			         r.message_id as relais_message_id, r.saute_motif as relais_saute_motif
			    from public.x_campagne_posts p
			    join public.tweets t on t.id = p.tweet_id
			    left join public.x_campagne_relais r
			      on r.campagne_slug = p.campagne_slug and r.source = 'x' and r.reference_id = p.tweet_id
			   where p.campagne_slug = $1)
			 union all
			 (select 'discord' as source, d.message_id as reference,
			         coalesce(m.author_display_name, m.author_username, 'membre inconnu') as auteur,
			         coalesce(m.content, '') as texte, null::jsonb as media, d.images as images,
			         m.author_username as pseudo, m.channel_id as salon_id, m.guild_id as guild_id,
			         d.hashtag_trouve, d.publie_le, d.masque, d.motif_masquage, d.mis_en_avant,
			         r.message_id as relais_message_id, r.saute_motif as relais_saute_motif
			    from public.campagne_creations_discord d
			    join public.discord_messages m on m.message_id = d.message_id
			    left join public.x_campagne_relais r
			      on r.campagne_slug = d.campagne_slug and r.source = 'discord' and r.reference_id = d.message_id
			   where d.campagne_slug = $1 and m.deleted_at is null)
			 order by publie_le desc
			 limit $2`,
			[slug, limite]
		);

		return rows.map((l) => {
			const source = l.source === "discord" ? ("discord" as const) : ("x" as const);
			return {
				auteur: texte(l.auteur),
				hashtag: l.hashtag_trouve ?? null,
				image:
					source === "x" ? premiereImageTweet(l.media) : premiereImageAsset(l.images),
				lien:
					source === "x"
						? `https://x.com/${texte(l.pseudo) || "i"}/status/${texte(l.reference)}`
						: `https://discord.com/channels/${texte(l.guild_id) || "@me"}/${texte(l.salon_id)}/${texte(l.reference)}`,
				masque: Boolean(l.masque),
				misEnAvant: Boolean(l.mis_en_avant),
				motifMasquage: l.motif_masquage ?? null,
				publieLe: iso(l.publie_le),
				reference: texte(l.reference),
				relaisMessageId: l.relais_message_id ?? null,
				relaisSauteMotif: l.relais_saute_motif ?? null,
				source,
				texte: texte(l.texte),
			};
		});
	} catch (err) {
		console.error("[admin/campagnes] listerCreationsAdmin :", err);
		return [];
	}
}

/** Première image d'un tweet, ré-hébergée de préférence (les URL X expirent). */
function premiereImageTweet(media: unknown): string | null {
	if (!Array.isArray(media)) return null;
	for (const item of media) {
		if (typeof item !== "object" || item === null) continue;
		const m = item as { type?: string; storage_url?: string; media_url_https?: string };
		if (m.type && m.type !== "photo" && m.type !== "image") continue;
		const url = m.storage_url || m.media_url_https;
		if (typeof url === "string" && url.startsWith("http")) return url;
	}
	return null;
}

/** Première image ré-hébergée d'une création Discord (`chemin` dans `assets`). */
function premiereImageAsset(images: unknown): string | null {
	if (!Array.isArray(images)) return null;
	for (const item of images) {
		if (typeof item !== "object" || item === null) continue;
		const chemin = (item as { chemin?: string | null }).chemin;
		if (typeof chemin === "string" && chemin.trim()) {
			return `/storage/v1/object/public/assets/${chemin.trim().replace(/^\/+/, "")}`;
		}
	}
	return null;
}
