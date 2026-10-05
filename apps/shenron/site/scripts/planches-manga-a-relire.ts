#!/usr/bin/env bun
/**
 * Qualité des transcriptions MANGA, jugée par le juge du corpus databooks.
 *
 * Le manga affiche 12 577 planches transcrites sur 12 577, soit 100 %. Ce
 * chiffre ne dit rien de la QUALITÉ : il compte les cases non vides. La campagne
 * databooks a coûté assez cher pour établir qu'une transcription présente peut
 * être une hallucination — un alphabet sans rapport, un segment bouclé jusqu'à
 * la limite de tokens, une sortie coupée en plein caractère UTF-8.
 *
 * `classerDefaut` est justement un module pur dont les signatures ne dépendent
 * pas de la langue attendue (cf. son en-tête). On peut donc le braquer tel quel
 * sur le manga francophone : `remplacement`, `etranger`, `boucle` et `courte` y
 * gardent tout leur sens. Seul `han-sans-kana` est écarté, parce qu'il juge une
 * page JAPONAISE privée de kana — sur une planche VF il ne veut rien dire.
 *
 * Lecture seule, sur le réplica SQLite : le script ne corrige rien, il constate.
 *
 *   bun apps/shenron/site/scripts/planches-manga-a-relire.ts
 *   bun apps/shenron/site/scripts/planches-manga-a-relire.ts --json
 *   bun apps/shenron/site/scripts/planches-manga-a-relire.ts --serie DB --exemples 5
 *   bun apps/shenron/site/scripts/planches-manga-a-relire.ts --ids /tmp/a-reprendre.txt
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { classerDefaut, type Defaut } from "../src/lib/databooks-defauts";
import { urlBase } from "./_databooks-base";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, defaut?: string) => {
	const i = args.indexOf(`--${n}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : defaut;
};

const RACINE = join(fileURLToPath(new URL("../../../..", import.meta.url)));
const BASE = opt("base", join(RACINE, "apps", "bot", "data", "bot.db"))!;
const SERIE = opt("serie");
const EXEMPLES = Number(opt("exemples", "3"));
const USE_PG = flag("pg");

/**
 * `han-sans-kana` juge une page japonaise privée de kana. Une planche VF n'a pas
 * de kana par construction : la signature y serait un faux positif systématique.
 */
const NON_PERTINENTS = new Set<Defaut>(["han-sans-kana"]);

type Ligne = { series: string; tome: string; planche: number; text: string | null; lang: string | null };

let lignes: Ligne[] = [];

if (USE_PG) {
	const pgUrl = await urlBase();
	const sql = postgres(pgUrl, { max: 1 });
	try {
		const rows = SERIE
			? await sql`SELECT series, tome, planche, text, lang FROM bot.db_manga_pages WHERE series = ${SERIE} ORDER BY series, tome, planche`
			: await sql`SELECT series, tome, planche, text, lang FROM bot.db_manga_pages ORDER BY series, tome, planche`;
		lignes = rows as unknown as Ligne[];
	} finally {
		await sql.end();
	}
} else {
	const db = new Database(BASE, { readonly: true });
	lignes = (
		SERIE
			? db.query("select series, tome, planche, text, lang from db_manga_pages where series = ?").all(SERIE)
			: db.query("select series, tome, planche, text, lang from db_manga_pages").all()
	) as Ligne[];
}

const parDefaut = new Map<Defaut, Ligne[]>();
const parTome = new Map<string, { total: number; fautives: number }>();
let saines = 0;

for (const l of lignes) {
	const cle = `${l.series} ${l.tome}`;
	const t = parTome.get(cle) ?? { total: 0, fautives: 0 };
	t.total += 1;

	// Une planche japonaise garde le juge complet ; une planche VF perd la
	// seule signature qui suppose des kana.
	const defaut = classerDefaut(l.text ?? "");
	const retenu = defaut && !(l.lang !== "ja" && NON_PERTINENTS.has(defaut)) ? defaut : null;

	if (retenu) {
		t.fautives += 1;
		const liste = parDefaut.get(retenu) ?? [];
		liste.push(l);
		parDefaut.set(retenu, liste);
	} else {
		saines += 1;
	}
	parTome.set(cle, t);
}

const total = lignes.length;
const fautives = total - saines;

if (flag("ids")) {
	// Une identité par ligne, au format que `export-manga-ocr.ts` consomme.
	// C'est la sortie que l'on branche sur une campagne de reprise.
	const sortie: string[] = [];
	for (const [, liste] of parDefaut) for (const l of liste) sortie.push(`${l.series}:${l.tome}:${l.planche}`);
	sortie.sort();
	const fichier = opt("ids");
	if (fichier) {
		await Bun.write(fichier, `${sortie.join("\n")}\n`);
		console.log(`${sortie.length} identité(s) écrite(s) dans ${fichier}`);
	} else {
		console.log(sortie.join("\n"));
	}
} else if (flag("json")) {
	console.log(
		JSON.stringify(
			{
				base: BASE,
				serie: SERIE ?? "toutes",
				total,
				saines,
				fautives,
				parDefaut: Object.fromEntries([...parDefaut].map(([d, l]) => [d, l.length])),
				tomes: [...parTome]
					.filter(([, t]) => t.fautives > 0)
					.toSorted((a, b) => b[1].fautives - a[1].fautives)
					.map(([tome, t]) => ({ tome, ...t })),
			},
			null,
			2
		)
	);
} else {
	console.log(`${total} planche(s) jugée(s) — ${saines} saine(s), ${fautives} fautive(s)`);
	if (fautives === 0) {
		console.log("\nAucune signature d'échec du modèle sur le corpus manga.");
	} else {
		console.log("");
		for (const [defaut, liste] of [...parDefaut].toSorted((a, b) => b[1].length - a[1].length)) {
			console.log(`${defaut.padEnd(14)} ${String(liste.length).padStart(6)}`);
			for (const l of liste.slice(0, EXEMPLES)) {
				console.log(`   ${l.series}:${l.tome}:${l.planche} (${(l.text ?? "").length} signes)`);
			}
		}
		const pires = [...parTome].filter(([, t]) => t.fautives > 0).toSorted((a, b) => b[1].fautives - a[1].fautives);
		if (pires.length > 0) {
			console.log(`\ntomes les plus touchés :`);
			for (const [tome, t] of pires.slice(0, 12)) {
				console.log(`   ${tome.padEnd(12)} ${String(t.fautives).padStart(4)} / ${t.total}`);
			}
		}
	}
}
