import "server-only";

import {
	fusionnerReglages,
	lireReglages,
	validerReglages,
	type ModificationReglages,
	type ReglagesCommunaute,
} from "@rosegriffon/types/bot";

import { pgQuery } from "@/lib/db/platform";

import { invaliderReglagesBots } from "./serveur";

/**
 * Lecture et écriture de `bot_reglages_guilde` depuis le site.
 *
 * ── DEUX ÉCRIVAINS, UN SEUL SCHÉMA ─────────────────────────────────────────
 * Le bot écrit cette colonne par ses slash commands ; le site l'écrit par son
 * formulaire d'administration. Les deux appliquent le MÊME schéma zod
 * (`@rosegriffon/types/bot`) : c'est la seule chose qui empêche le formulaire
 * d'enregistrer une valeur que le bot refuserait de relire — et comme
 * `lireReglages` ne lève jamais, une valeur illisible ferait retomber le bot
 * sur ses défauts, c'est-à-dire EFFACERAIT en pratique tous les réglages du
 * serveur sans que rien ne le signale.
 *
 * ── LA CONNEXION POSTGRES DIRECTE, PAS POSTGREST ───────────────────────────
 * `bot_reglages_guilde` porte des identifiants de salons et de rôles de
 * modération : la table n'est pas exposée aux rôles `anon`/`authenticated`, et
 * elle n'a donc rien à faire dans le Data API. On passe par le pool `pg` du
 * site, celui-là même qui sert la page Infrastructure.
 */

interface LigneReglages {
	valeurs: unknown;
	maj_le: string | Date | null;
}

export interface ReglagesGuilde {
	guildId: string;
	reglages: ReglagesCommunaute;
	/** ISO 8601, `null` si la guilde n'a jamais rien réglé. */
	majLe: string | null;
	/** Vrai quand aucune ligne n'existe encore : ce sont les défauts du schéma. */
	parDefaut: boolean;
}

/** Réglages d'une guilde. Rend les défauts si la ligne n'existe pas. */
export async function lireReglagesGuilde(guildId: string): Promise<ReglagesGuilde> {
	const lignes = await pgQuery<LigneReglages>(
		"SELECT valeurs, maj_le FROM public.bot_reglages_guilde WHERE guild_id = $1 LIMIT 1",
		[guildId]
	);
	const ligne = lignes[0];
	return {
		guildId,
		reglages: lireReglages(ligne?.valeurs),
		majLe: ligne?.maj_le ? new Date(ligne.maj_le).toISOString() : null,
		parDefaut: !ligne,
	};
}

/**
 * Applique une modification partielle et prévient les bots.
 *
 * L'ordre compte : on écrit, PUIS on invalide. L'inverse laisserait une fenêtre
 * pendant laquelle un bot recharge l'ancienne valeur juste après le vidage et
 * la remet en cache pour une minute.
 *
 * ⚠ `${valeurs}::jsonb` avec la valeur JS BRUTE, jamais `JSON.stringify()`
 * avant. C'est le piège documenté du 14/8/2026 : un encodage double écrit une
 * CHAÎNE contenant du JSON dans la colonne, `jsonb_typeof()` répond `string`,
 * et la relecture retombe sur les défauts. Ici on passe par `pg` (paramètre
 * `$2` de type `jsonb`), qui exige au contraire une chaîne JSON — d'où le
 * `JSON.stringify` explicite, correct pour CE pilote et faux pour `Bun.SQL`.
 * Les deux règles sont contradictoires et c'est normal : elles décrivent deux
 * pilotes différents.
 */
export async function enregistrerReglagesGuilde(
	guildId: string,
	modification: ModificationReglages
): Promise<ReglagesGuilde & { profilsPrevenus: string[] }> {
	const actuels = await lireReglagesGuilde(guildId);
	const fusionnes = fusionnerReglages(actuels.reglages, modification);

	const lignes = await pgQuery<{ maj_le: string | Date }>(
		`INSERT INTO public.bot_reglages_guilde (guild_id, valeurs, maj_le)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (guild_id) DO UPDATE
			 SET valeurs = EXCLUDED.valeurs, maj_le = NOW()
		 RETURNING maj_le`,
		[guildId, JSON.stringify(fusionnes)]
	);

	const profilsPrevenus = await invaliderReglagesBots(guildId);

	return {
		guildId,
		reglages: fusionnes,
		majLe: lignes[0]?.maj_le ? new Date(lignes[0]!.maj_le).toISOString() : null,
		parDefaut: false,
		profilsPrevenus,
	};
}

/**
 * Remplace intégralement le document — pour le bouton « rétablir les défauts ».
 *
 * Distinct de la fusion : remettre les défauts est une SUPPRESSION de tous les
 * réglages, et une fusion ne peut pas exprimer une suppression.
 */
export async function remplacerReglagesGuilde(
	guildId: string,
	document: unknown
): Promise<ReglagesGuilde & { profilsPrevenus: string[] }> {
	const valides = validerReglages(document);
	const lignes = await pgQuery<{ maj_le: string | Date }>(
		`INSERT INTO public.bot_reglages_guilde (guild_id, valeurs, maj_le)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (guild_id) DO UPDATE
			 SET valeurs = EXCLUDED.valeurs, maj_le = NOW()
		 RETURNING maj_le`,
		[guildId, JSON.stringify(valides)]
	);
	const profilsPrevenus = await invaliderReglagesBots(guildId);
	return {
		guildId,
		reglages: valides,
		majLe: lignes[0]?.maj_le ? new Date(lignes[0]!.maj_le).toISOString() : null,
		parDefaut: false,
		profilsPrevenus,
	};
}

export interface StatistiquesCommunaute {
	profils: number;
	niveauMoyen: number;
	xpTotale: number;
	jetonsEnCirculation: number;
	ticketsOuverts: number;
	ticketsTotal: number;
	suggestionsOuvertes: number;
	menusRoles: number;
}

const STATISTIQUES_VIDES: StatistiquesCommunaute = Object.freeze({
	profils: 0,
	niveauMoyen: 0,
	xpTotale: 0,
	jetonsEnCirculation: 0,
	ticketsOuverts: 0,
	ticketsTotal: 0,
	suggestionsOuvertes: 0,
	menusRoles: 0,
});

/**
 * Les compteurs de la vie de communauté.
 *
 * ── LES QUATRE TABLES SONT INTERROGÉES SÉPARÉMENT ──────────────────────────
 * Une seule requête à sous-sélections serait plus courte, mais elle échoue
 * ENTIÈREMENT si une seule des quatre tables manque — et les migrations `bot_*`
 * datent du 14/8/2026, donc un environnement de recette peut parfaitement n'en
 * avoir appliqué que la moitié. Ici, une table absente rend zéro pour ses
 * propres compteurs et n'emporte pas le reste du tableau de bord.
 *
 * `statut <> 'ferme'` et non `ferme_le IS NULL` : la contrainte de la table
 * connaît trois états (`ouvert`, `pris`, `ferme`) et un ticket PRIS en charge
 * est toujours ouvert pour qui l'a déposé.
 */
export async function statistiquesCommunaute(guildId: string): Promise<StatistiquesCommunaute> {
	const [profils, tickets, suggestions, menus] = await Promise.all([
		compter<{ profils: string; niveau_moyen: string | null; xp: string; jetons: string }>(
			`SELECT count(*) AS profils,
			        coalesce(round(avg(niveau), 1), 0) AS niveau_moyen,
			        coalesce(sum(xp), 0) AS xp,
			        coalesce(sum(jetons), 0) AS jetons
			   FROM public.bot_profils WHERE guild_id = $1`,
			guildId
		),
		compter<{ ouverts: string; total: string }>(
			`SELECT count(*) FILTER (WHERE statut <> 'ferme') AS ouverts, count(*) AS total
			   FROM public.bot_tickets WHERE guild_id = $1`,
			guildId
		),
		compter<{ ouvertes: string }>(
			`SELECT count(*) AS ouvertes FROM public.bot_suggestions
			  WHERE guild_id = $1 AND statut = 'ouverte'`,
			guildId
		),
		compter<{ total: string }>(
			"SELECT count(*) AS total FROM public.bot_menus_roles WHERE guild_id = $1",
			guildId
		),
	]);

	return {
		profils: Number(profils?.profils ?? 0),
		niveauMoyen: Number(profils?.niveau_moyen ?? 0),
		xpTotale: Number(profils?.xp ?? 0),
		jetonsEnCirculation: Number(profils?.jetons ?? 0),
		ticketsOuverts: Number(tickets?.ouverts ?? 0),
		ticketsTotal: Number(tickets?.total ?? 0),
		suggestionsOuvertes: Number(suggestions?.ouvertes ?? 0),
		menusRoles: Number(menus?.total ?? 0),
	};
}

/**
 * Une agrégation qui tolère une table absente.
 *
 * On journalise l'échec — il n'est pas normal en production — mais on ne le
 * propage pas : un compteur manquant vaut mieux qu'un tableau de bord blanc.
 */
async function compter<T>(sql: string, guildId: string): Promise<T | null> {
	try {
		const lignes = await pgQuery<T>(sql, [guildId]);
		return lignes[0] ?? null;
	} catch (erreur) {
		console.warn(
			"[bot/reglages] agrégat indisponible :",
			erreur instanceof Error ? erreur.message : erreur
		);
		return null;
	}
}

export { STATISTIQUES_VIDES };
