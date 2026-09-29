/**
 * crawl-dragonballcn.ts — Relevé du CATALOGUE de comic.dragonballcn.com (鸟山明漫画资料馆).
 *
 * Ce site recense l'œuvre publiée de Toriyama édition par édition : Dragon Ball
 * japonais original (42 tomes), kanzenban (34), Full Color (42), les éditions
 * chinoises continentales / taïwanaises / hongkongaises, Arale, les anime comics,
 * les Daizenshuu et les artbooks. Chaque tome y porte ses métadonnées d'éditeur :
 * date de première édition, ISBN, numéro de magazine, prix, éditeur, titre du volume.
 *
 * CE QUE CE SCRIPT RELÈVE
 * -----------------------
 * Il relève la BIBLIOGRAPHIE : la liste des éditions, des tomes et leurs métadonnées
 * d'éditeur. Ce sont des faits d'édition, exactement ce qui manque à notre wiki
 * (cf. les tomes fantômes de `bot.db_manga_chapters`, dont le catalogue permet de
 * trancher lesquels existent vraiment, ISBN à l'appui).
 *
 * RÉCUPÉRATION
 * ------------
 * Toutes les pages passent par BXC avec une sortie HTML, afin que le transport,
 * le cache et les profils de navigation restent centralisés dans le crawler.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/crawl-dragonballcn.ts                      # tout le catalogue (~15 s)
 *   bun apps/shenron/bot/scripts/crawl-dragonballcn.ts --avec-planches      # relève aussi les fiches de tome
 *   bun apps/shenron/bot/scripts/crawl-dragonballcn.ts --collection dragonball_jp_original
 *   bun apps/shenron/bot/scripts/crawl-dragonballcn.ts --limite 5 --delai 2000
 *   bun apps/shenron/bot/scripts/crawl-dragonballcn.ts --force              # ignore le cache disque
 */

import { fileURLToPath } from "node:url";
import { scrapeWithAphrody } from "./lib/aphrody-web-scrape.ts";
import { parseGalleryListing, parseGalleryTitle } from "../src/dragonballcn-gallery.ts";

const RACINE = "https://comic.dragonballcn.com";
const DOSSIER_SORTIE = fileURLToPath(new URL("../data/catalogues/", import.meta.url));
const DOSSIER_CACHE = `${DOSSIER_SORTIE}.cache-dragonballcn/`;

/** Pages d'édition connues, dans l'ordre où le site les présente. */
const EDITIONS = [
	{ slug: "dragonball_jp_original", titre: "Dragon Ball — édition japonaise originale" },
	{ slug: "dragonball_jp_kanzenban", titre: "Dragon Ball — kanzenban japonaise" },
	{ slug: "dragonball_full_color", titre: "Dragon Ball — Full Color (édition numérique)" },
	{ slug: "dragonball_zh_cn", titre: "Dragon Ball — chinois simplifié (continent)" },
	{ slug: "dragonball_zh_tw", titre: "Dragon Ball — chinois traditionnel (Taïwan, Tong Li)" },
	{ slug: "dragonball_zh_hk_ultimate", titre: "Dragon Ball — kanzenban chinoise (Hong Kong)" },
	{ slug: "dragonball_anime_z", titre: "Dragon Ball Z — anime comics TV" },
	{ slug: "dragonball_anime_movie", titre: "Dragon Ball — anime comics films" },
	{ slug: "arale_cn", titre: "Dr Slump — édition chinoise" },
	{ slug: "arale_jp_lib", titre: "Dr Slump — bunko japonais" },
	{ slug: "arale_zh_hk", titre: "Dr Slump — édition hongkongaise" },
];

type Ouvrage = {
	did: string;
	url: string;
	libelle: string;
	couverture: string | null;
	titre_tome?: string;
	premiere_edition?: string;
	isbn?: string;
	magazine?: string;
	prix?: string;
	editeur?: string;
	lignes?: string[];
	planches?: number;
	dossier?: string;
	fichiers?: string[];
};

type Collection = {
	slug: string;
	titre: string;
	titre_site: string | null;
	url: string;
	ouvrages: Ouvrage[];
};

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const aOption = (nom: string) => args.includes(`--${nom}`);
const valeur = (nom: string, defaut: string) => {
	const i = args.indexOf(`--${nom}`);
	return i >= 0 && args[i + 1] ? (args[i + 1] as string) : defaut;
};

const AVEC_PLANCHES = aOption("avec-planches");
const FORCE = aOption("force");
const DELAI = Number(valeur("delai", "1200"));
const LIMITE = Number(valeur("limite", "0"));
const COLLECTION = valeur("collection", "");
const SORTIE = valeur("sortie", `${DOSSIER_SORTIE}dragonballcn.json`);

// ---------------------------------------------------------------- récupération

/** Le site renvoie 200 avec la page d'attente Cloudflare : c'est le titre qui trahit. */
const estChallenge = (html: string) =>
	/<title>\s*(Just a moment|Attention Required|Un instant)/i.test(html) || html.length < 2000;

let derniereRequete = 0;

/** Une requête à la fois, temporisée : on ne malmène pas un site qu'on ne possède pas. */
async function temporise() {
	const attente = DELAI - (Date.now() - derniereRequete);
	if (attente > 0) await Bun.sleep(attente);
	derniereRequete = Date.now();
}

function cheminCache(url: string) {
	return `${DOSSIER_CACHE}${Bun.hash(url).toString(36)}.html`;
}

async function viaBxc(url: string): Promise<string> {
	const result = await scrapeWithAphrody(url, { profile: "render" });
	if (estChallenge(result.content)) throw new Error(`Aphrody Web challenge pour ${url}`);
	return result.content;
}

async function recupere(url: string): Promise<string> {
	const cache = Bun.file(cheminCache(url));
	if (!FORCE && (await cache.exists())) return cache.text();

	await temporise();
	const html = await viaBxc(url);

	await Bun.write(cheminCache(url), html);
	return html;
}

// ---------------------------------------------------------------- extraction

const sansBalises = (html: string) =>
	html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.trim();

const lignesDe = (html: string) =>
	sansBalises(html)
		.split("\n")
		.map((l) => l.trim().replace(/^　+/, ""))
		.filter(Boolean);

/** Les ouvrages d'une page : chaque `<li>` qui pointe une fiche `gain_1.php`. */
function extraitOuvrages(html: string): Ouvrage[] {
	const trouves: Ouvrage[] = [];
	const vus = new Set<string>();
	const motif = /<a href="(?:list\/)?gain_1\.php\?did=([\d-]+)"[^>]*>([\s\S]*?)<\/a>/g;

	for (const m of html.matchAll(motif)) {
		const did = m[1] as string;
		if (vus.has(did)) continue;
		vus.add(did);
		const dedans = m[2] as string;
		const couverture = /<img[^>]+src="([^"]+)"/.exec(dedans)?.[1] ?? null;
		trouves.push({
			did,
			url: `${RACINE}/list/gain_1.php?did=${did}`,
			libelle: lignesDe(dedans).join(" · "),
			couverture: couverture ? new URL(couverture, `${RACINE}/`).href : null,
		});
	}
	return trouves;
}

/**
 * Métadonnées d'éditeur, présentes sur la seule page japonaise originale :
 * un bloc `<div align=left>` par tome, apparié par position (mesuré 42 = 42).
 */
function extraitMetadonnees(html: string): Partial<Ouvrage>[] {
	const blocs = [...html.matchAll(/<div align=left>([\s\S]*?)<\/div>/g)];
	return blocs.map((b) => {
		const lignes = lignesDe(b[1] as string);
		const champ = (prefixe: RegExp) =>
			lignes
				.find((l) => prefixe.test(l))
				?.replace(prefixe, "")
				.trim();
		return {
			titre_tome: lignes[0],
			premiere_edition: champ(/^初版\s*/),
			isbn: champ(/^ISBN\s*/),
			magazine: champ(/^雜誌\s*/),
			prix: champ(/^定価\s*/),
			editeur: champ(/^出版\s*/),
			lignes,
		};
	});
}

/**
 * Seconde mise en page du site : une table où les couvertures occupent une rangée
 * et leurs métadonnées la rangée SUIVANTE, colonne par colonne
 * (« [1993-08-20] 04 <titre><br>ISBN 962-585-004-X »).
 * Les deux éditions hongkongaises l'emploient ; les lire au seul motif
 * `<div align=left>` y perdait 6 ISBN.
 */
function extraitMetadonneesTable(html: string): Map<string, Partial<Ouvrage>> {
	const trouve = new Map<string, Partial<Ouvrage>>();
	const rangees = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] as string);

	for (let i = 0; i < rangees.length - 1; i++) {
		const cellules = (r: string) =>
			[...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] as string);
		const liens = cellules(rangees[i] as string);
		const dids = liens.map((c) => /gain_1\.php\?did=([\d-]+)/.exec(c)?.[1] ?? null);
		if (!dids.some(Boolean)) continue;

		const metas = cellules(rangees[i + 1] as string);
		if (metas.length !== liens.length) continue;

		for (const [colonne, did] of dids.entries()) {
			if (!did) continue;
			const texte = lignesDe(metas[colonne] as string);
			if (!texte.length) continue;

			const entete = texte[0] ?? "";
			const date = /\[(\d{4})-(\d{2})-(\d{2})\]/.exec(entete);
			// Un « ISBN ? » signale une référence que le site lui-même ne connaît pas :
			// l'absence se conserve telle quelle, on ne la comble pas.
			const isbn = /ISBN\s+([\dX-]{8,})/i.exec(texte.join(" "))?.[1];
			const titre = entete.replace(/^\[[\d-]+\]\s*/, "").trim();

			const partiel: Partial<Ouvrage> = { lignes: texte };
			if (titre) partiel.titre_tome = titre;
			if (isbn) partiel.isbn = isbn;
			if (date) partiel.premiere_edition = `${date[1]}/${date[2]}/${date[3]}`;
			trouve.set(did, partiel);
		}
	}
	return trouve;
}

// ---------------------------------------------------------------- relevé

async function relevePage(slug: string, titre: string): Promise<Collection> {
	const url = `${RACINE}/${slug}.htm`;
	console.log(`\n▸ ${titre}`);
	const html = await recupere(url);

	const ouvrages = extraitOuvrages(html);
	const metas = extraitMetadonnees(html);
	// L'appariement par position n'est fiable que si le site a posé un bloc par tome.
	if (metas.length === ouvrages.length) {
		ouvrages.forEach((o, i) => Object.assign(o, metas[i]));
		console.log(`  ${ouvrages.length} tomes, métadonnées d'éditeur incluses`);
	} else {
		console.log(
			`  ${ouvrages.length} tomes${metas.length ? ` (${metas.length} blocs meta ignorés : appariement incertain)` : ""}`
		);
	}

	// Complément, jamais écrasement : ce que la première passe a lu fait foi.
	const parTable = extraitMetadonneesTable(html);
	let complements = 0;
	for (const ouvrage of ouvrages) {
		const extra = parTable.get(ouvrage.did);
		if (!extra || ouvrage.isbn) continue;
		Object.assign(ouvrage, extra);
		complements++;
	}
	if (complements)
		console.log(`  + ${complements} tome(s) complété(s) depuis la mise en page tableau`);

	return { slug, titre, titre_site: parseGalleryTitle(html), url, ouvrages };
}

/** Tout `did` que les pages d'édition n'ont pas déjà : databooks, artbooks, séries courtes. */
async function releveDivers(dejaVus: Set<string>): Promise<Collection> {
	console.log(`\n▸ Ouvrages hors édition principale (databooks, artbooks, hors-séries)`);
	const ouvrages: Ouvrage[] = [];

	for (const page of ["", "update.htm"]) {
		const html = await recupere(`${RACINE}/${page}`);
		for (const o of extraitOuvrages(html)) {
			if (dejaVus.has(o.did) || ouvrages.some((x) => x.did === o.did)) continue;
			ouvrages.push(o);
		}
	}
	console.log(`  ${ouvrages.length} ouvrages`);
	return {
		slug: "divers",
		titre: "Databooks, artbooks et hors-séries",
		titre_site: null,
		url: `${RACINE}/`,
		ouvrages,
	};
}

async function relevePlanches(collections: Collection[]) {
	const tous = collections.flatMap((c) => c.ouvrages);
	const cible = LIMITE > 0 ? tous.slice(0, LIMITE) : tous;
	console.log(`\n▸ Fiches de tome : ${cible.length} à relever`);

	let n = 0;
	let refuses = 0;
	for (const ouvrage of cible) {
		n++;
		try {
			const html = await recupere(ouvrage.url);
			const { directory: dossier, files: fichiers } = parseGalleryListing(html);
			ouvrage.dossier = dossier;
			ouvrage.fichiers = fichiers;
			ouvrage.planches = fichiers.length;
			console.log(`  [${n}/${cible.length}] ${ouvrage.did} — ${fichiers.length} planches`);
		} catch (erreur) {
			refuses++;
			console.warn(
				`  [${n}/${cible.length}] ${ouvrage.did} — refusé : ${(erreur as Error).message}`
			);
		}
	}

	if (refuses === cible.length) {
		console.warn(
			`\n  ⚠ Les ${refuses} fiches de tome ont été refusées (403). C'est le comportement\n` +
				`    attendu : le site ouvre son catalogue et ferme ses pages de lecture. Le relevé\n` +
				`    bibliographique ci-dessus, lui, est complet.`
		);
	}
}

// ---------------------------------------------------------------- entrée

const debut = Bun.nanoseconds();
const collections: Collection[] = [];

for (const edition of EDITIONS) {
	if (COLLECTION && edition.slug !== COLLECTION) continue;
	collections.push(await relevePage(edition.slug, edition.titre));
}

if (!COLLECTION) {
	const vus = new Set(collections.flatMap((c) => c.ouvrages.map((o) => o.did)));
	collections.push(await releveDivers(vus));
}

if (AVEC_PLANCHES) await relevePlanches(collections);

const ouvrages = collections.flatMap((c) => c.ouvrages);
const catalogue = {
	source: RACINE,
	releve_le: new Date().toISOString(),
	avertissement:
		"Relevé bibliographique uniquement (éditions, tomes, ISBN, dates, index des planches). " +
		"Aucune planche n'est copiée dans ce relevé : les pages restent référencées par leur " +
		"source DragonballCN publique et le catalogue conserve les métadonnées éditoriales.",
	totaux: {
		collections: collections.length,
		ouvrages: ouvrages.length,
		planches: ouvrages.reduce((s, o) => s + (o.planches ?? 0), 0),
		avec_isbn: ouvrages.filter((o) => o.isbn).length,
	},
	collections,
};

await Bun.write(SORTIE, `${JSON.stringify(catalogue, null, 2)}\n`);

const secondes = ((Bun.nanoseconds() - debut) / 1e9).toFixed(1);
console.log(`\n✓ Catalogue écrit : ${SORTIE}`);
console.log(
	`  ${catalogue.totaux.collections} collections · ${catalogue.totaux.ouvrages} ouvrages · ` +
		`${catalogue.totaux.planches} planches indexées · ${catalogue.totaux.avec_isbn} ISBN · ${secondes}s`
);
