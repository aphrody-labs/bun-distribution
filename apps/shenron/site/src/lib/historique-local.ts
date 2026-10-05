// SPDX-License-Identifier: Apache-2.0

/**
 * Historique de consultation — **local à l'appareil**, jamais envoyé.
 *
 * Pourquoi ne pas s'appuyer sur la télémétrie déjà en place : elle est en
 * opt-in strict (Consent Mode v2), donc vide pour qui refuse la mesure
 * d'audience, et elle vit côté serveur — la relire pour afficher « reprenez où
 * vous en étiez » demanderait de lire un cookie au rendu, ce qui ferait
 * basculer TOUTES les pages en `private, no-store` (le piège de latence qui a
 * déjà coûté le cache CDN du site entier).
 *
 * Ici, rien ne sort de l'appareil : `localStorage`, lu par un îlot client après
 * l'hydratation. Le service fonctionne pour tout le monde, y compris pour qui a
 * refusé la mesure — parce que ce n'est pas de la mesure, c'est un marque-page.
 */

export interface EntreeHistorique {
	/** URL de la fiche. */
	href: string;
	titre: string;
	/** Rubrique, pour l'affichage (« Personnage », « Épisode »…). */
	rubrique: string;
	image?: string | null;
	/** Horodatage de la dernière visite (ms). */
	vuLe: number;
}

const CLE = "dbfr:historique";
export const HISTORIQUE_MAX = 24;

function lireBrut(): EntreeHistorique[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const brut = JSON.parse(localStorage.getItem(CLE) ?? "[]") as unknown;
		if (!Array.isArray(brut)) return [];
		return brut.filter(
			(e): e is EntreeHistorique =>
				!!e &&
				typeof (e as EntreeHistorique).href === "string" &&
				typeof (e as EntreeHistorique).titre === "string" &&
				typeof (e as EntreeHistorique).vuLe === "number"
		);
	} catch {
		// Stockage plein, désactivé (navigation privée stricte) ou contenu
		// corrompu : l'historique est un confort, il ne casse jamais la page.
		return [];
	}
}

/** Les dernières fiches consultées, de la plus récente à la plus ancienne. */
export function lireHistorique(): EntreeHistorique[] {
	return lireBrut().toSorted((a, b) => b.vuLe - a.vuLe);
}

/**
 * Note une visite. Une fiche revue remonte en tête au lieu d'être dupliquée —
 * sinon relire trois fois la même page suffirait à remplir la liste.
 */
export function noterVisite(e: Omit<EntreeHistorique, "vuLe">): void {
	if (typeof localStorage === "undefined") return;
	try {
		const sans = lireBrut().filter((x) => x.href !== e.href);
		const suivant = [{ ...e, vuLe: Date.now() }, ...sans].slice(0, HISTORIQUE_MAX);
		localStorage.setItem(CLE, JSON.stringify(suivant));
	} catch {
		// idem : on n'interrompt jamais une lecture pour un marque-page.
	}
}

export function viderHistorique(): void {
	try {
		localStorage?.removeItem(CLE);
	} catch {
		/* rien à faire */
	}
}

/**
 * Entrées assez récentes pour être proposées. Au-delà d'un mois, « reprendre »
 * n'a plus de sens : ce n'est plus une lecture en cours, c'est une archive.
 */
export function reprises(maintenant = Date.now(), joursMax = 30): EntreeHistorique[] {
	const limite = maintenant - joursMax * 24 * 3600 * 1000;
	return lireHistorique().filter((e) => e.vuLe >= limite);
}
