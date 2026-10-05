/**
 * Analyse japonaise de TOUTES les transcriptions de databooks.
 *
 *   bun apps/shenron/site/scripts/ja-analyser.ts [--limite N] [--json fichier] [--seuil N]
 *
 * Produit la liste des fautes de lecture probables, ouvrage par ouvrage. Rien
 * n'est écrit en base : une correction automatique sur 11 775 planches de
 * japonais serait irrattrapable, et le détecteur se trompe encore. La sortie
 * sert à alimenter la relecture humaine.
 *
 * Pourquoi un script et pas une route : l'analyse charge un dictionnaire
 * morphologique, un index de 464 819 graphies et le corpus entier. C'est un
 * traitement par lot, pas une requête web.
 *
 * Prérequis : `bun apps/shenron/site/scripts/ja-preparer.ts`.
 */
import postgres from "postgres";
import { exigerRessources, graphiesJmdict, segmenter } from "../src/lib/ja/dictionnaire";
import {
	indexerLexique,
	retenirParFrequence,
	suggerer,
	trierLexique,
	type Suggestion,
	type TermeLexique,
} from "../src/lib/ja/anomalies";
import { contientJaponais, normaliserJa } from "../src/lib/ja/normalisation";

function argument(nom: string): string | undefined {
	const i = process.argv.indexOf(`--${nom}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const LIMITE = Number(argument("limite") ?? 0) || 0;
const SEUIL = Number(argument("seuil") ?? 1) || 1;
const SORTIE = argument("json");

const url = (await Bun.file(new URL("../.env", import.meta.url)).text())
	.split("\n")
	.find((l) => l.startsWith("DATABASE_URL="))
	?.slice("DATABASE_URL=".length)
	.replace(/^"|"$/g, "")
	.trim();
if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(url, { max: 2 });

// Refus de démarrer sans les ressources : mieux vaut une erreur qu'un
// rapport vide pris pour un corpus sain.
await exigerRessources();

console.log("· chargement du lexique du domaine…");
const brut = await sql<{ ja: string; fr: string; kind: string }[]>`
	SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'planete'   FROM bot.db_planets    WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'race'      FROM bot.db_races      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'saga'      FROM bot.db_sagas      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'arc'       FROM bot.db_arcs       WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'technique' FROM bot.db_techniques WHERE name_ja IS NOT NULL
`;
const vus = new Set<string>();
const termes: TermeLexique[] = [];
for (const l of brut) {
	for (const variante of String(l.ja).split(/[,、;]/)) {
		const ja = variante
			.trim()
			.replace(/^[（(]+|[）)]+$/g, "")
			.trim();
		if (ja.length < 2 || !contientJaponais(ja) || vus.has(ja)) continue;
		vus.add(ja);
		termes.push({
			ja,
			fr: String(l.fr ?? "")
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim(),
			kind: l.kind,
		});
	}
}
const lex = trierLexique(termes);
const index = indexerLexique(lex);
const jmdict = await graphiesJmdict();
console.log(`  ${lex.length} termes du domaine · ${jmdict.size} graphies JMdict`);

console.log("· lecture des transcriptions…");
const planches = await sql<{ id: number; titre: string; numero: number; texte: string }[]>`
	SELECT d.id, d.title AS titre, (p ->> 'number')::int AS numero, p ->> 'text' AS texte
	FROM bot.db_databooks d, LATERAL jsonb_array_elements(d.pages) p
	WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL
	ORDER BY d.id, numero
	${LIMITE ? sql`LIMIT ${LIMITE}` : sql``}
`;
console.log(`  ${planches.length} planches transcrites`);

// Le corpus ENTIER sert de référence de fréquence : une faute est rare, une
// graphie correcte est répétée d'un ouvrage à l'autre. Se limiter à la planche
// courante priverait l'arbitrage de presque toute son information.
const corpus = normaliserJa(planches.map((p) => p.texte).join("\n"));
const cacheOcc = new Map<string, number>();
function occurrences(graphie: string): number {
	const cle = normaliserJa(graphie);
	const vu = cacheOcc.get(cle);
	if (vu !== undefined) return vu;
	const n = cle ? corpus.split(cle).length - 1 : 0;
	cacheOcc.set(cle, n);
	return n;
}

console.log("· analyse…");
const t0 = Bun.nanoseconds();
const parGraphie = new Map<string, { s: Suggestion; n: number; ou: Set<string> }>();
let tokens = 0;
let inconnus = 0;
let absousJmdict = 0;

for (const [i, p] of planches.entries()) {
	if (i > 0 && i % 500 === 0) {
		console.log(`  ${i}/${planches.length}…`);
	}
	for (const t of await segmenter(p.texte)) {
		tokens++;
		if (!t.inconnu || !contientJaponais(t.surface)) continue;
		inconnus++;
		if (jmdict.has(t.surface)) {
			absousJmdict++;
			continue;
		}
		const deja = parGraphie.get(t.surface);
		if (deja) {
			deja.n++;
			deja.ou.add(p.titre);
			continue;
		}
		const s = suggerer(t.surface, lex, index, occurrences);
		if (s) parGraphie.set(t.surface, { s, n: 1, ou: new Set([p.titre]) });
	}
}

const retenues = [...parGraphie.values()]
	.filter((c) => retenirParFrequence(c.s, occurrences) && c.n >= SEUIL)
	.toSorted((a, b) => b.n - a.n);

const secs = (Bun.nanoseconds() - t0) / 1e9;
console.log(
	`\n${planches.length} planches · ${tokens.toLocaleString("fr-FR")} tokens · ${secs.toFixed(0)} s`
);
console.log(`inconnus du dictionnaire : ${inconnus.toLocaleString("fr-FR")}`);
console.log(`  absous par JMdict ...... ${absousJmdict.toLocaleString("fr-FR")}`);
console.log(`corrections proposées .... ${retenues.length}\n`);

for (const c of retenues.slice(0, 40)) {
	const ouvrages = c.ou.size === 1 ? [...c.ou][0].slice(0, 34) : `${c.ou.size} ouvrages`;
	console.log(
		`${String(c.n).padStart(4)}×  ${c.s.lu.padEnd(12)} → ${c.s.attendu.padEnd(12)} ` +
			`${c.s.fr.padEnd(18)} ${ouvrages}`
	);
}

if (SORTIE) {
	await Bun.write(
		SORTIE,
		JSON.stringify(
			retenues.map((c) => (Object.assign(c.s, {
	occurrences: c.n,
	ouvrages: [...c.ou]
}))),
			null,
			2
		)
	);
	console.log(`\n→ ${SORTIE}`);
}

await sql.end();
