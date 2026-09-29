#!/usr/bin/env bun
/**
 * enrichit-divers-dragonballcn.ts — Donne aux 135 ouvrages « divers » du
 * catalogue comic.dragonballcn.com les métadonnées que la page d'accueil porte
 * et que le relevé initial laissait tomber.
 *
 * Les onze pages d'édition présentent leurs tomes en vignettes, avec un bloc de
 * métadonnées par tome. La page d'accueil, elle, présente les databooks, artbooks
 * et hors-séries en LISTES DE LIENS, groupées par rubrique — d'où 135 ouvrages
 * sans date, sans rubrique et sans couverture dans le premier relevé.
 *
 * Ce que la page d'accueil porte quand même, et que ce script récupère :
 *   · la RUBRIQUE (`<h4>` du bloc) : « 龙珠资料书籍 » (ouvrages de référence),
 *     « 鸟山明其他作品 » (autres œuvres de Toriyama), « 新分享 » (nouveaux
 *     partages)… — c'est le classement éditorial du site lui-même ;
 *   · la DATE affichée devant le lien : `[2016-05-13]`, `[1996-08]` ou `[1985|2013]`
 *     (parution originale | édition numérique) ;
 *   · le FIL DE FORUM crédité à côté, quand il y en a un : c'est la source que le
 *     site cite pour la numérisation.
 *
 * Aucune couverture : le site n'en publie pas pour ces ouvrages-là. La seule image
 * de ces blocs est l'icône de rubrique (`class="folder-thumb"`), partagée par tous
 * les ouvrages du bloc — la donner comme couverture serait mentir sur la vignette.
 * Elle est enregistrée au niveau de la rubrique, à sa place.
 *
 * Le script lit les pages ARCHIVÉES sous `data/catalogues/pages/` : il ne
 * redemande rien au site.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/enrichit-divers-dragonballcn.ts --simulation
 *   bun apps/shenron/bot/scripts/enrichit-divers-dragonballcn.ts
 */
import { join } from "node:path";

const args = process.argv.slice(2);
const SIMULATION = args.includes("--simulation");

const DOSSIER = join(import.meta.dir, "..", "data", "catalogues");
const CATALOGUE = join(DOSSIER, "dragonballcn.json");
const PAGES = join(DOSSIER, "pages");
const CACHE = join(DOSSIER, ".cache-dragonballcn");
const RACINE = "https://comic.dragonballcn.com";

type Ouvrage = {
	did: string;
	libelle?: string;
	rubrique?: string;
	rubrique_icone?: string | null;
	date_affichee?: string | null;
	parution?: string | null;
	numerisation?: string | null;
	fil_forum?: string | null;
};
type Collection = { slug: string; ouvrages: Ouvrage[] };

const sansBalises = (html: string) =>
	html
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();

/**
 * `[1985|2013]` = parution originale | édition numérique ; `[1996-08]` = une seule
 * date. On garde la chaîne telle qu'affichée ET ses deux bornes séparées.
 */
function decoupeDate(brut: string | null) {
	if (!brut) return { date_affichee: null, parution: null, numerisation: null };
	const parts = brut.split("|").map((p) => p.trim());
	return {
		date_affichee: brut,
		parution: parts[0] || null,
		numerisation: parts.length > 1 ? parts[1] || null : null,
	};
}

/** Un bloc `<div class="it">` = une rubrique : son titre, son icône, ses ouvrages. */
function litLesRubriques(html: string) {
	const trouve = new Map<string, Omit<Ouvrage, "did">>();

	for (const bloc of html.matchAll(/<div class="it">([\s\S]*?)<\/div>/g)) {
		const corps = bloc[1] as string;
		const rubrique = sansBalises(/<h4>([\s\S]*?)<\/h4>/.exec(corps)?.[1] ?? "");
		const icone = /<img[^>]+class="folder-thumb"[^>]*>/.exec(corps)?.[0];
		const src = icone ? /src="([^"]+)"/.exec(icone)?.[1] : null;
		const rubriqueIcone = src ? new URL(src, `${RACINE}/`).href : null;

		for (const item of corps.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
			const ligne = item[1] as string;
			// Dans un même <li>, la date qui précède un lien vaut pour ce lien.
			let date: string | null = null;
			const jetons = ligne.matchAll(
				/<font color="blue">\[([^\]]+)\]<\/font>|<a href="(?:list\/)?gain_1\.php\?did=([\d-]+)"|<a href="(https?:\/\/bbs\.dragonballcn\.com[^"]+)"/g
			);
			let dernierDid: string | null = null;
			for (const jeton of jetons) {
				if (jeton[1]) {
					date = jeton[1];
					continue;
				}
				if (jeton[2]) {
					dernierDid = jeton[2];
					trouve.set(dernierDid, {
						rubrique: rubrique || undefined,
						rubrique_icone: rubriqueIcone,
						fil_forum: null,
						...decoupeDate(date),
					});
					continue;
				}
				// Le fil de forum cité APRÈS un lien crédite la numérisation de cet ouvrage.
				if (jeton[3] && dernierDid) {
					const fiche = trouve.get(dernierDid);
					if (fiche && !fiche.fil_forum) fiche.fil_forum = jeton[3];
				}
			}
		}
	}
	return trouve;
}

// ------------------------------------------------------------------- campagne

const catalogue = (await Bun.file(CATALOGUE).json()) as { collections: Collection[] };

/** L'accueil est archivé sous `divers.html` ; « update.htm » n'a que le cache. */
const sources = [
	join(PAGES, "divers.html"),
	join(CACHE, `${Bun.hash(`${RACINE}/update.htm`).toString(36)}.html`),
];

const metas = new Map<string, Omit<Ouvrage, "did">>();
for (const chemin of sources) {
	const fichier = Bun.file(chemin);
	if (!(await fichier.exists())) {
		console.warn(`  ⚠ page absente : ${chemin}`);
		continue;
	}
	for (const [did, meta] of litLesRubriques(await fichier.text())) {
		// La première page qui décrit un ouvrage fait foi (l'accueil avant update).
		if (!metas.has(did)) metas.set(did, meta);
	}
}
console.log(`${metas.size} ouvrages décrits par les pages d'index.`);

let poses = 0;
let deja = 0;
const rubriques = new Map<string, number>();

for (const collection of catalogue.collections) {
	for (const ouvrage of collection.ouvrages) {
		const meta = metas.get(ouvrage.did);
		if (!meta) continue;
		if (ouvrage.rubrique) {
			deja++;
			continue;
		}
		if (!SIMULATION) {
			ouvrage.rubrique = meta.rubrique;
			ouvrage.rubrique_icone = meta.rubrique_icone;
			ouvrage.date_affichee = meta.date_affichee;
			ouvrage.parution = meta.parution;
			ouvrage.numerisation = meta.numerisation;
			ouvrage.fil_forum = meta.fil_forum;
		}
		poses++;
		if (meta.rubrique) rubriques.set(meta.rubrique, (rubriques.get(meta.rubrique) ?? 0) + 1);
	}
}

if (!SIMULATION) await Bun.write(CATALOGUE, `${JSON.stringify(catalogue, null, "\t")}\n`);

console.log(
	`\n✔ ${poses} ouvrage(s) ${SIMULATION ? "à enrichir" : "enrichi(s)"}, ${deja} déjà fait(s).`
);
for (const [rubrique, n] of [...rubriques].toSorted((a, b) => b[1] - a[1])) {
	console.log(`  ${String(n).padStart(4)}  ${rubrique}`);
}
if (SIMULATION) console.log("  (simulation — relancer sans --simulation)");
