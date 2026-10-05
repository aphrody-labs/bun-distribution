import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dbUniverse } from "@/lib/db-universe";
import { analyzeCanon, type CanonAnalysisResult } from "@/lib/canon-engine";
import { getCanonConfig } from "@/lib/canon-config";
import {
	getShenronCharacter,
	getShenronPlanet,
	getShenronRace,
	getShenronTechnique,
	getShenronTransformation,
} from "@/lib/shenron";

/**
 * Les preuves derrière un verdict de canonicité.
 *
 * Le verdict lui-même vient de `canon-engine`, appliqué à la doctrine éditée
 * dans `/admin/ia?tab=canon` : une table curée, déterministe, relue à la main. Il n'est
 * **pas** rédigé par un modèle — le rédacteur LLM du RAG est hors-ligne et sa
 * prose de repli n'a aucune valeur probante.
 *
 * Ce module ne fait qu'une chose : aller chercher, dans nos propres bases, de
 * quoi vérifier ce verdict sans quitter la page. Une planche de databook avec
 * son image, sa transcription japonaise et sa traduction ; une fiche du wiki.
 * Rien qui vienne d'ailleurs.
 */

export interface PlanchePreuve {
	databookId: number;
	databookTitre: string;
	numero: number;
	image: string | null;
	/** Transcription japonaise de la planche. */
	texte: string | null;
	/** Traduction française, quand la planche est passée en relecture. */
	texteFr: string | null;
	verifiee: boolean;
	href: string;
	score: number;
}

interface FichePreuve {
	kind: string;
	titre: string;
	extrait: string;
	href: string;
	score: number;
	/** Asset path of the entity picture, when the page has one. */
	image: string | null;
	/** Japanese name, when the entity carries one. */
	nameJa: string | null;
}

export interface CanonPreuves {
	verdict: CanonAnalysisResult;
	planches: PlanchePreuve[];
	fiches: FichePreuve[];
	/** Mode effectif du moteur de recherche (hybrid+rerank | hybrid | lexical). */
	mode: string | null;
	/** Ruled topics close to the question, as ready-to-ask links. */
	suggestions: { titre: string; href: string }[];
}

/**
 * `/wiki/databooks/105#planche-11` → `{ id: 105, numero: 11 }`.
 *
 * Le RAG rend une URL absolue ou relative selon l'indexeur ; on ne se fie donc
 * qu'au motif, pas au préfixe.
 */
function refPlanche(url: string): { id: number; numero: number } | null {
	const m = /\/wiki\/databooks\/(\d+)(?:#planche-(\d+))?/.exec(url);
	if (!m) return null;
	const id = Number(m[1]);
	const numero = m[2] ? Number(m[2]) : 1;
	return Number.isFinite(id) ? { id, numero } : null;
}

/**
 * Résout les planches citées **en une seule requête**.
 *
 * La colonne `pages` d'un databook porte jusqu'à plusieurs centaines de
 * planches avec leur transcription ; charger la fiche entière pour en lire une
 * ferait traverser des mégaoctets à chaque question posée. On découpe donc côté
 * Postgres : `jsonb_path_query_first` sur le numéro demandé.
 */
async function resoudrePlanches(
	refs: { id: number; numero: number; score: number }[]
): Promise<PlanchePreuve[]> {
	if (refs.length === 0) return [];
	const paires = sql.join(
		refs.map((r) => sql`(${r.id}::int, ${r.numero}::int)`),
		sql`, `
	);
	const rows = await db.execute<{
		id: number;
		titre: string;
		numero: number;
		planche: {
			number?: number;
			image?: string | null;
			text?: string | null;
			text_fr?: string | null;
			verifiee?: boolean;
		} | null;
	}>(sql`
		with demandes(id, numero) as (values ${paires})
		select d.id,
		       d.title as titre,
		       q.numero,
		       coalesce(
		         jsonb_path_query_first(d.pages, ('$[*] ? (@.number == ' || q.numero || ')')::jsonpath),
		         d.pages -> (q.numero - 1)
		       ) as planche
		from demandes q
		join bot.db_databooks d on d.id = q.id and d.visible = true
	`);

	const scores = new Map(refs.map((r) => [`${r.id}#${r.numero}`, r.score]));
	const parCle = new Map<string, PlanchePreuve>();
	for (const r of rows) {
		const p = r.planche;
		if (!p) continue;
		// Une planche sans image ni texte n'est pas une preuve, juste une entrée
		// d'index : on la laisse tomber plutôt que d'afficher un cadre vide.
		if (!p.image && !p.text && !p.text_fr) continue;
		const numero = Number(r.numero);
		const cle = `${r.id}#${numero}`;
		const score = scores.get(cle) ?? 0;
		parCle.set(cle, {
			databookId: r.id,
			databookTitre: r.titre,
			numero,
			image: p.image ?? null,
			texte: p.text ?? null,
			texteFr: p.text_fr ?? null,
			verifiee: p.verifiee === true,
			href: `/wiki/databooks/${r.id}#planche-${numero}`,
			score,
		});
	}
	return [...parCle.values()].toSorted((a, b) => b.score - a.score);
}

/**
 * Ramène une URL du RAG à une route réelle du site, ou `null` si elle ne
 * désigne rien de précis.
 *
 * Trois pièges, tous constatés sur la production :
 *
 *  - **L'indexeur écrit des routes historiques.** `/wiki/dragon-ball/character/264`
 *    et `/wiki/dragon-ball/planet/34` répondent encore, mais par une 308 vers
 *    `/wiki/personnages/264` et `/wiki/cosmologie/34`. Citer la forme ancienne
 *    coûte un aller-retour à chaque clic ; on la réécrit ici.
 *  - **Beaucoup de hits ne pointent qu'un index.** `/wiki/sagas` pour un arc,
 *    `/wiki/dragon-ball` pour une transformation : renvoyer le lecteur sur une
 *    grille de 200 entrées n'est pas une preuve, c'est un renvoi à lui-même.
 *  - **Les miroirs de wikis de fans.** La doctrine du wiki les interdit comme
 *    source rédactionnelle ; les afficher en preuve sur la page qui arbitre la
 *    canonicité serait exactement l'inverse de ce qu'elle promet. Ils ont été
 *    purgés du corpus, le tri par URL les refuse s'ils y revenaient.
 *
 * Le tri se fait sur l'URL et non sur `kind` : le RAG range sous
 * `kind: "source"` À LA FOIS les pages externes et nos propres passages de manga
 * (`/wiki/manga`). Filtrer sur le `kind` jetait donc les seconds avec les
 * premiers — la version précédente perdait toutes les preuves manga.
 */
function routeInterne(url: string): string | null {
	if (!url) return null;
	if (/^https?:\/\//i.test(url)) {
		// Seul notre propre domaine est admis en absolu (le RAG mélange les deux).
		const interne = /^https?:\/\/(?:www\.)?dragonballfr\.com(\/.*)$/i.exec(url);
		if (!interne) return null;
		url = interne[1]!;
	}
	url = url
		.replace(/^\/wiki\/dragon-ball\/character\//, "/wiki/personnages/")
		.replace(/^\/wiki\/dragon-ball\/planet\//, "/wiki/cosmologie/");
	// Une route qui ne descend pas sous sa rubrique ne désigne aucune fiche.
	const segments = url.split("#")[0]!.split("/").filter(Boolean);
	if (segments[0] !== "wiki" || segments.length < 3) return null;
	return url;
}

/**
 * La requête qui sert à ramener les preuves — **pas** la question telle quelle.
 *
 * Mesuré sur la production : « Broly est-il canonique ? » ne rend aucune
 * planche (le reranker remonte de la prose encyclopédique qui ressemble à la
 * question), là où « broly » en rend deux dès les douze premiers résultats. La
 * forme interrogative dilue les termes qui portent le sens.
 *
 * On repart donc des mots-clés que le moteur de canonicité a effectivement
 * reconnus : ils sont curés à la main, ils désignent le sujet, et ils ne
 * dépendent pas de la façon dont la question est tournée. Sans reconnaissance,
 * on retombe sur la question brute.
 */
function requetePreuves(question: string, motsCles: string[]): string {
	const utiles = motsCles.filter((m) => m.length > 2).slice(0, 3);
	return utiles.length > 0 ? utiles.join(" ") : question;
}

/**
 * Picture and Japanese name of the entity behind a wiki route.
 *
 * Read from our own tables, never from the RAG snippet: the snippet is prose,
 * the image is the row's. Unknown sections (episodes, films, sagas…) yield
 * nothing rather than a wrong picture. Never throws.
 */
async function illustrerFiche(href: string): Promise<{ image: string | null; nameJa: string | null }> {
	const rien = { image: null, nameJa: null };
	const mMangaVol = /^\/wiki\/manga\/volume\/(\d+)/.exec(href);
	if (mMangaVol) {
		try {
			const vol = await dbUniverse.mangaVolume(Number(mMangaVol[1]));
			return vol ? { image: vol.cover || null, nameJa: vol.title_ja ?? null } : rien;
		} catch {
			return rien;
		}
	}
	const mMangaChap = /^\/wiki\/manga\/(\d+)/.exec(href);
	if (mMangaChap) {
		try {
			const chap = await dbUniverse.mangaChapter(Number(mMangaChap[1]));
			return chap ? { image: chap.cover || null, nameJa: null } : rien;
		} catch {
			return rien;
		}
	}
	const m = /^\/wiki\/(personnages|cosmologie|techniques|transformations|races)\/([^/#?]+)/.exec(href);
	if (!m) return rien;
	const [, rubrique, slug] = m;
	try {
		switch (rubrique) {
			case "personnages": {
				const c = await getShenronCharacter(slug!);
				return c ? { image: c.image || null, nameJa: c.nameJa ?? null } : rien;
			}
			case "cosmologie": {
				const p = await getShenronPlanet(slug!);
				return p ? { image: p.image || null, nameJa: p.nameJa ?? null } : rien;
			}
			case "techniques": {
				const t = await getShenronTechnique(slug!);
				return t ? { image: t.image ?? null, nameJa: null } : rien;
			}
			case "transformations": {
				const t = await getShenronTransformation(slug!);
				return t ? { image: t.image ?? null, nameJa: null } : rien;
			}
			case "races": {
				const r = await getShenronRace(slug!);
				return r ? { image: r.characters.find((c) => c.image)?.image || null, nameJa: r.nameJa ?? null } : rien;
			}
			default:
				return rien;
		}
	} catch {
		return rien;
	}
}

export const canonPreuves = cache(async (question: string): Promise<CanonPreuves> => {
	const verdict = analyzeCanon(question, await getCanonConfig());
	const suggestions = verdict.suggestions.map((titre) => ({
		titre,
		href: `/wiki/canon?q=${encodeURIComponent(titre)}`,
	}));
	// A troll or empty input gets no evidence: searching the corpus for « Goku vs Superman »
	// would surface Goku pages and lend the question a seriousness it lacks.
	if (verdict.nature === "troll" || verdict.nature === "empty") {
		return { verdict, planches: [], fiches: [], mode: null, suggestions };
	}
	const requete = requetePreuves(question, verdict.matchedKeywords);

	// Deux recherches quand la reformulation diffère : la question sert les
	// fiches (elle porte l'intention), les mots-clés servent les planches (ils
	// portent le sujet). Une seule quand elles coïncident.
	const [parQuestion, parMotsCles] = await Promise.all([
		dbUniverse.rag(question, 14, { lexicalOnly: true }).catch(() => null),
		requete === question
			? Promise.resolve(null)
			: dbUniverse.rag(requete, 14, { lexicalOnly: true }).catch(() => null),
	]);
	const hits = [...(parMotsCles?.results ?? []), ...(parQuestion?.results ?? [])];

	const refs: { id: number; numero: number; score: number }[] = [];
	const fiches: FichePreuve[] = [];
	const vues = new Set<string>();
	for (const h of hits) {
		const href = routeInterne(h.url);
		if (!href || vues.has(href)) continue;
		vues.add(href);
		if (h.kind === "databook") {
			const ref = refPlanche(href);
			if (ref) refs.push({ ...ref, score: h.score ?? 0 });
			continue;
		}
		// Surpondération de véracité : fiches encyclopédiques canoniques et manga > épisodes dérivés
		const isCanonCore = [
			"character",
			"technique",
			"transformation",
			"planet",
			"race",
			"manga_chapter",
			"manga_volume",
			"source",
		].includes(h.kind);
		fiches.push({
			kind: h.kind,
			titre: h.title,
			extrait: h.snippet,
			href,
			score: (h.score ?? 0) * (isCanonCore ? 1.3 : 1.0),
			image: null,
			nameJa: null,
		});
	}

	const retenues = fiches.toSorted((a, b) => b.score - a.score).slice(0, 6);
	const planchesCandidats = refs.toSorted((a, b) => b.score - a.score).slice(0, 6);
	const [planches, illustrations] = await Promise.all([
		resoudrePlanches(planchesCandidats).catch(() => [] as PlanchePreuve[]),
		Promise.all(retenues.map((f) => illustrerFiche(f.href))),
	]);
	return {
		verdict,
		planches: planches.slice(0, 4),
		fiches: retenues.map((f, i) => (Object.assign(f, illustrations[i]!))),
		mode: parQuestion?.mode ?? parMotsCles?.mode ?? null,
		suggestions,
	};
});
