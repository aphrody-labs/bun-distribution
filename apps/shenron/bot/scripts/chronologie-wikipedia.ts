#!/usr/bin/env bun
/**
 * chronologie-wikipedia.ts — Comble les trous de la chronologie des épisodes
 * (date de première diffusion, titre japonais, rōmaji, synopsis) à partir de
 * Wikipédia.
 *
 * Méthode reprise de `packages/ietv/src/wiki.ts` (bxc 0.8.0), qui a résolu le
 * même problème sur un autre catalogue : **on lit l'API MediaWiki
 * (`action=parse`), pas la page**. C'est une interface publique et documentée,
 * là où gratter l'habillage de `fr.wikipedia.org` casse au premier changement de
 * thème. MediaWiki rend le HTML déjà assemblé, sans les gabarits.
 *
 * Ce que ça répare, mesuré le 2026-09-02 sur `bot.db_episodes` :
 *
 *   DBGT           64 épisodes — 64 sans date, 64 sans titre japonais
 *   DBS           131 épisodes — 31 sans date, 54 sans synopsis
 *   DBZ_KAI        97 épisodes — 97 sans date, 97 sans synopsis
 *   DBZ_KAI_FINAL  70 épisodes — 70 sans date, 70 sans synopsis
 *   DB_DAIMA       20 épisodes — 1 sans date, 8 sans rōmaji
 *
 * Deux garde-fous :
 *   - **On ne remplit que ce qui est vide.** Un champ déjà renseigné en base
 *     (souvent d'une meilleure source, ou relu à la main) n'est jamais écrasé.
 *   - **Simulation par défaut.** `--appliquer` pour écrire.
 *
 *   bun apps/shenron/bot/scripts/chronologie-wikipedia.ts [--serie DBGT] [--appliquer]
 */

import { SQL } from "bun";

const API_WIKI = "https://fr.wikipedia.org/w/api.php";

interface Cible {
	readonly serie: string;
	readonly page: string;
	/** Décalage à retrancher au numéro de Wikipédia (numérotation absolue). */
	readonly decalage: number;
	/** Bornes du numéro Wikipédia retenues pour cette série. */
	readonly de: number;
	readonly a: number;
}

/**
 * Une même page peut porter deux séries de notre base : Wikipédia range Kai et
 * ses « chapitres finaux » sous une seule liste, numérotée d'une traite.
 */
const CIBLES: readonly Cible[] = [
	{ serie: "DBGT", page: "Liste des épisodes de Dragon Ball GT", decalage: 0, de: 1, a: 64 },
	{ serie: "DBS", page: "Liste des épisodes de Dragon Ball Super", decalage: 0, de: 1, a: 131 },
	{ serie: "DBZ_KAI", page: "Liste des épisodes de Dragon Ball Z Kai", decalage: 0, de: 1, a: 97 },
	{
		serie: "DBZ_KAI_FINAL",
		page: "Liste des épisodes de Dragon Ball Z Kai",
		decalage: 97,
		de: 98,
		a: 167,
	},
	{ serie: "DB_DAIMA", page: "Dragon Ball Daima", decalage: 0, de: 1, a: 20 },
];

interface EpisodeWiki {
	readonly numero: number;
	readonly titreFr: string | null;
	readonly kanji: string | null;
	readonly romaji: string | null;
	/** Epoch en secondes, UTC — le format de `db_episodes.air_date`. */
	readonly diffusion: number | null;
	readonly synopsis: string | null;
}

const MOIS: Readonly<Record<string, number>> = {
	janvier: 1,
	février: 2,
	fevrier: 2,
	mars: 3,
	avril: 4,
	mai: 5,
	juin: 6,
	juillet: 7,
	août: 8,
	aout: 8,
	septembre: 9,
	octobre: 10,
	novembre: 11,
	décembre: 12,
	decembre: 12,
};

/** Retire le balisage, décode les entités, efface les appels de note. */
export function texteCellule(html: string): string {
	return html
		.replace(/<sup[\s\S]*?<\/sup>/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&#160;|&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/\[\s*(source insuffisante|réf\.[^\]]*|\d+)\s*\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** « 7 février 1996 » → epoch UTC. Une date illisible vaut mieux qu'une date fausse. */
export function dateEnEpoch(texte: string): number | null {
	const m = /(\d{1,2})\s*(?:er)?\s+([a-zéûôA-Z]+)\s+(\d{4})/.exec(texte.normalize("NFC"));
	if (!m) return null;
	const mois = MOIS[(m[2] ?? "").toLowerCase()];
	if (!mois) return null;
	const d = Date.UTC(Number(m[3]), mois - 1, Number(m[1]));
	return Number.isFinite(d) ? Math.trunc(d / 1000) : null;
}

/**
 * Le rōmaji de Wikipédia porte souvent sa traduction française entre
 * parenthèses, sur la même cellule (« Nazo no… (Les Mystérieux…) »).
 */
function romajiSeul(cellule: string): string | null {
	const sansTraduction = cellule.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return sansTraduction || null;
}

/**
 * Les épisodes d'une page, toutes tables confondues.
 *
 * Une ligne d'épisode porte au moins cinq cellules (numéro, titre français,
 * kanji, rōmaji, date) ; la ligne à cellule unique qui la SUIT est son résumé.
 * Se fier au nombre de cellules plutôt qu'à une classe CSS est ce qui rend le
 * parseur insensible à l'habillage.
 */
export function parserEpisodes(html: string): EpisodeWiki[] {
	const episodes: EpisodeWiki[] = [];
	for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
		if (!/Titre\s*(français|japonais)/i.test(table)) continue;
		const lignes = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
		let dernier: { numero: number; index: number } | null = null;
		for (const ligne of lignes) {
			const cellules = [...ligne.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
				texteCellule(m[1] ?? "")
			);
			if (cellules.length === 1 && dernier) {
				const resume = cellules[0] ?? "";
				// Un résumé fait des phrases ; une cellule de service, non.
				if (resume.length > 80) {
					const precedent = episodes[dernier.index];
					if (precedent) episodes[dernier.index] = { ...precedent, synopsis: resume };
				}
				dernier = null;
				continue;
			}
			if (cellules.length < 5) continue;
			// Le PREMIER groupe de chiffres, jamais « tous les chiffres de la cellule » :
			// à partir de l'épisode 101, la cellule porte le numéro ET un appel de note,
			// et les coller donnait des numéros fantômes (« 104101 », « 10191293 »).
			const numero = Number(/(\d+)/.exec(cellules[0] ?? "")?.[1] ?? Number.NaN);
			if (!Number.isFinite(numero) || numero <= 0) continue;
			const diffusion = dateEnEpoch(cellules[4] ?? "") ?? dateEnEpoch(cellules.at(-1) ?? "");
			episodes.push({
				numero,
				titreFr: cellules[1] || null,
				kanji: cellules[2] || null,
				romaji: romajiSeul(cellules[3] ?? ""),
				diffusion,
				synopsis: null,
			});
			dernier = { numero, index: episodes.length - 1 };
		}
	}
	return episodes;
}

async function pageWiki(titre: string): Promise<string> {
	const url = `${API_WIKI}?action=parse&page=${encodeURIComponent(titre)}&prop=text&format=json&formatversion=2`;
	const reponse = await fetch(url, { headers: { "User-Agent": "shenron-bot (dragonballfr.com)" } });
	if (!reponse.ok) throw new Error(`Wikipédia « ${titre} » → HTTP ${reponse.status}`);
	const corps = (await reponse.json()) as { parse?: { text?: string }; error?: { info?: string } };
	if (!corps.parse?.text)
		throw new Error(`Wikipédia « ${titre} » → ${corps.error?.info ?? "page vide"}`);
	return corps.parse.text;
}

async function connexion(): Promise<SQL> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return new SQL(direct);
	const texte = await Bun.file(`${process.env.HOME}/.shenron-neon.env`)
		.text()
		.catch(() => "");
	// La DERNIÈRE ligne fait foi : l'ancienne URL Neon dort au-dessus, en commentaire.
	const lignes = texte.split("\n").filter((l) => l.trim().startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.split("=")
		.slice(1)
		.join("=")
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable (env ou ~/.shenron-neon.env)");
	return new SQL(valeur);
}

interface LigneBase {
	readonly id: string;
	readonly number_in_series: string;
	readonly title: string | null;
	readonly title_ja: string | null;
	readonly title_romaji: string | null;
	readonly air_date: string | null;
	readonly synopsis: string | null;
	readonly synopsis_fr: string | null;
}

const args: readonly string[] = process.argv.slice(2);
const APPLIQUER = args.includes("--appliquer");
const serieDemandee = args[args.indexOf("--serie") + 1];

const sql = await connexion();
const pagesLues = new Map<string, string>();
let totalRemplis = 0;

for (const cible of CIBLES) {
	if (args.includes("--serie") && cible.serie !== serieDemandee) continue;

	const html = pagesLues.get(cible.page) ?? (await pageWiki(cible.page));
	pagesLues.set(cible.page, html);
	const tous = parserEpisodes(html);
	const retenus = tous.filter((e) => e.numero >= cible.de && e.numero <= cible.a);
	const parNumero = new Map(retenus.map((e) => [e.numero - cible.decalage, e]));

	const lignes = (await sql`
		select id, number_in_series, title, title_ja, title_romaji, air_date, synopsis, synopsis_fr
		from bot.db_episodes
		where series = ${cible.serie}
		order by number_in_series
	`) as unknown as LigneBase[];

	let titres = 0;
	let dates = 0;
	let kanji = 0;
	let romaji = 0;
	let synopsis = 0;
	let manquants = 0;

	for (const ligne of lignes) {
		const wiki = parNumero.get(Number(ligne.number_in_series));
		if (!wiki) {
			manquants++;
			continue;
		}
		const maj: string[] = [];
		// Les 167 épisodes de Kai ne portent PAS de titre : la base a « Épisode 42 »,
		// un gabarit d'import. Un gabarit n'est pas une donnée — il se remplace,
		// contrairement à un titre réel, qu'on ne touche jamais.
		if (/^\s*[ÉE]pisode\s+\d+\s*$/i.test(ligne.title ?? "") && wiki.titreFr) {
			if (APPLIQUER)
				await sql`update bot.db_episodes set title = ${wiki.titreFr} where id = ${ligne.id}`;
			titres++;
			maj.push("titre");
		}
		if (ligne.air_date === null && wiki.diffusion !== null) {
			if (APPLIQUER)
				await sql`update bot.db_episodes set air_date = ${wiki.diffusion} where id = ${ligne.id}`;
			dates++;
			maj.push("date");
		}
		if (ligne.title_ja === null && wiki.kanji) {
			if (APPLIQUER)
				await sql`update bot.db_episodes set title_ja = ${wiki.kanji} where id = ${ligne.id}`;
			kanji++;
			maj.push("ja");
		}
		if (ligne.title_romaji === null && wiki.romaji) {
			if (APPLIQUER)
				await sql`update bot.db_episodes set title_romaji = ${wiki.romaji} where id = ${ligne.id}`;
			romaji++;
			maj.push("romaji");
		}
		if (ligne.synopsis === null && ligne.synopsis_fr === null && wiki.synopsis) {
			if (APPLIQUER)
				await sql`update bot.db_episodes set synopsis_fr = ${wiki.synopsis} where id = ${ligne.id}`;
			synopsis++;
			maj.push("synopsis");
		}
		totalRemplis += maj.length;
	}

	console.log(
		`[${cible.serie}] ${lignes.length} épisodes en base · ${retenus.length} lus sur Wikipédia · ` +
			`+${titres} titres fr, +${dates} dates, +${kanji} titres ja, +${romaji} rōmaji, +${synopsis} synopsis` +
			(manquants > 0 ? ` · ${manquants} sans correspondance` : "")
	);
}

await sql.end();
console.log(
	APPLIQUER
		? `✓ ${totalRemplis} champs remplis (aucun champ existant écrasé).`
		: `SIMULATION — ${totalRemplis} champs seraient remplis. Relancer avec --appliquer.`
);
