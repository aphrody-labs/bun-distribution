import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inventaire des routes réellement servies par un App Router Next.
 *
 * Utilisé par les tests de non-régression des liens : une entrée de menu qui ne
 * correspond à aucune route ici est un 404 en production. Aucune dépendance à
 * Next — on lit l'arborescence, ce qui marche aussi bien en test qu'en CI.
 */

const FICHIERS_PAGE = ["page.tsx", "page.ts", "page.jsx", "page.js"];
const FICHIERS_ROUTE = ["route.tsx", "route.ts", "route.jsx", "route.js"];

/** Un segment `(groupe)` n'apparaît pas dans l'URL. */
function estGroupe(segment: string): boolean {
	return segment.startsWith("(") && segment.endsWith(")");
}

/** `@modal` / `_prive` : parallel routes et dossiers privés ne sont pas des URL. */
function estIgnore(segment: string): boolean {
	return segment.startsWith("@") || segment.startsWith("_") || segment.startsWith(".");
}

/**
 * Liste les motifs d'URL d'un dossier `app/`, segments dynamiques conservés
 * (`/chara/[id]`, `/modeles/[[...path]]`).
 */
export function listerMotifsRoutes(racineApp: string, inclureApi = false): string[] {
	const motifs: string[] = [];

	const visiter = (dossier: string, urlSegments: string[]): void => {
		let entrees: string[];
		try {
			entrees = readdirSync(dossier);
		} catch {
			return;
		}

		const fichiers = new Set(entrees);
		const aPage = FICHIERS_PAGE.some((f) => fichiers.has(f));
		const aRoute = inclureApi && FICHIERS_ROUTE.some((f) => fichiers.has(f));
		if (aPage || aRoute) {
			motifs.push(`/${urlSegments.join("/")}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1"));
		}

		for (const entree of entrees) {
			if (estIgnore(entree)) {
				continue;
			}
			const chemin = join(dossier, entree);
			if (!statSync(chemin).isDirectory()) {
				continue;
			}
			visiter(chemin, estGroupe(entree) ? urlSegments : [...urlSegments, entree]);
		}
	};

	visiter(racineApp, []);
	return [...new Set(motifs)].sort();
}

/** Un motif de route Next accepte-t-il ce chemin concret ? */
export function motifAccepte(motif: string, chemin: string): boolean {
	const segmentsMotif = motif.split("/").filter(Boolean);
	const segmentsChemin = chemin.split("/").filter(Boolean);

	for (let i = 0; i < segmentsMotif.length; i++) {
		const m = segmentsMotif[i]!;
		// `[[...x]]` : optionnel, avale tout le reste (y compris rien).
		if (m.startsWith("[[...") && m.endsWith("]]")) {
			return i === segmentsMotif.length - 1;
		}
		// `[...x]` : avale le reste, mais exige au moins un segment.
		if (m.startsWith("[...") && m.endsWith("]")) {
			return i === segmentsMotif.length - 1 && segmentsChemin.length > i;
		}
		const c = segmentsChemin[i];
		if (c === undefined) {
			return false;
		}
		if (m.startsWith("[") && m.endsWith("]")) {
			continue;
		}
		if (m !== c) {
			return false;
		}
	}

	return segmentsChemin.length === segmentsMotif.length;
}

/** Ce chemin est-il servi par au moins une route de l'app ? */
export function routeExiste(motifs: string[], chemin: string): boolean {
	const sansQuery = chemin.split(/[?#]/)[0]!;
	return motifs.some((motif) => motifAccepte(motif, sansQuery));
}
