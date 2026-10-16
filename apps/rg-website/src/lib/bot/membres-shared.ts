/**
 * Le vocabulaire du classement — la moitié CLIENT-SAFE.
 *
 * ── POURQUOI CE JUMEAU EXISTE ──────────────────────────────────────────────
 * `membres.ts` porte `import "server-only"` : il ouvre le pool Postgres, il n'a
 * rien à faire dans un bundle navigateur. Mais le tableau du classement est un
 * îlot `"use client"` (tri et pagination interactifs), et il a besoin des mêmes
 * libellés et des mêmes types.
 *
 * Les importer depuis `membres.ts` ferait échouer le build avec un
 * « Can't resolve 'fs' » très loin de sa cause. C'est le patron déjà retenu
 * ailleurs dans le dépôt (`lib/wiki/<x>-shared.ts`, `lib/cpk/…`) : les types et
 * les fonctions PURES d'un côté, l'accès aux données de l'autre.
 *
 * Rien ici ne touche au réseau, au disque ni à la base.
 */

/** Les tris proposés — chacun s'appuie sur un index existant ou sur la clé. */
export const TRIS_MEMBRES = ["xp", "jetons", "messages", "recent"] as const;

export type TriMembres = (typeof TRIS_MEMBRES)[number];

export const LIBELLES_TRI: Readonly<Record<TriMembres, string>> = Object.freeze({
	xp: "Expérience",
	jetons: "Jetons gagnés",
	messages: "Messages comptés",
	recent: "Activité récente",
});

export function estTriMembres(valeur: unknown): valeur is TriMembres {
	return typeof valeur === "string" && (TRIS_MEMBRES as readonly string[]).includes(valeur);
}

/**
 * D'où vient l'XP d'une ligne.
 *
 * Toutes les XP ne se valent pas, et l'interface doit le dire :
 *   - `api`        : relevée sur l'API Noctaly — valeur EXACTE ;
 *   - `classement` : lue sur le classement public — exacte aussi, mais datée du
 *                    dernier rendu de la page ;
 *   - `historique` : reconstituée depuis les annonces « Niveau supérieur »
 *                    retrouvées dans les salons — c'est le SEUIL du palier,
 *                    donc un minorant, pas une mesure ;
 *   - `bot`        : gagnée chez nous depuis le 14/8/2026.
 */
export type ProvenanceXp = "api" | "classement" | "historique" | "bot";

export const LIBELLES_PROVENANCE: Readonly<Record<ProvenanceXp, string>> = Object.freeze({
	api: "API Noctaly",
	classement: "Classement public",
	historique: "Historique des salons",
	bot: "Activité sur notre bot",
});

export interface LigneMembre {
	rang: number;
	discordId: string;
	pseudo: string;
	avatarUrl: string | null;
	xp: number;
	niveau: number;
	jetons: number;
	jetonsGagnes: number;
	messages: number;
	serieQuotidienne: number;
	/** ISO 8601, `null` si le membre n'a jamais rien gagné chez nous. */
	dernierGainLe: string | null;
	titre: string | null;
	provenance: ProvenanceXp;
	/** Le membre a-t-il quitté le serveur ? */
	parti: boolean;
}

export interface PageMembres {
	lignes: LigneMembre[];
	total: number;
	page: number;
	pages: number;
	tri: TriMembres;
}

/** Taille de page — assez pour un écran, assez peu pour rester lisible. */
export const PAR_PAGE = 50;
