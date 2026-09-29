/**
 * Traduit des planches de databook du japonais vers le français.
 *
 *   bun apps/site/scripts/ja-traduire.ts --databook 19 [--planches 1,2,3] [--json f.json]
 *   bun apps/site/scripts/ja-traduire.ts --texte "孫悟空は界王拳を使った。"
 *
 * **N'écrit rien en base.** La traduction automatique d'un corpus lu
 * automatiquement empile deux sources d'erreur ; le résultat est une proposition
 * à relire, pas une donnée.
 *
 * Le modèle tourne en local (`@huggingface/transformers`, NLLB-200 distillé),
 * sans service tiers. Compter ~90 s de chargement puis ~3 s par segment : c'est
 * un traitement par lot, jamais une réponse à une requête web.
 *
 * Ce que ce script apporte par rapport à un appel direct au modèle : la
 * **protection du vocabulaire du domaine**. Sans elle, mesuré sur ce corpus,
 * `孫悟空は界王拳を使った` devient « Son-gu a utilisé le poing du roi » — la
 * grammaire est juste, les noms propres sont translittérés au son et les
 * techniques traduites littéralement.
 *
 * `@huggingface/transformers` n'est PAS déclaré par le site : il est déjà une
 * dépendance du bot (sidecar d'embeddings du RAG) et Bun le hoiste à la racine
 * du monorepo, d'où ce script le résout. Le déclarer une seconde fois créerait
 * un doublon de version hors catalogue.
 */
import postgres from "postgres";
import { protegerTermes, restaurerTermes, segmentsTraduisibles } from "../src/lib/ja/traduction";
import { trierLexique, type TermeLexique } from "../src/lib/ja/anomalies";
import { contientJaponais } from "../src/lib/ja/normalisation";

function argument(nom: string): string | undefined {
	const i = process.argv.indexOf(`--${nom}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const ID = Number(argument("databook") ?? 0) || 0;
const TEXTE = argument("texte");
const PLANCHES = argument("planches")
	?.split(",")
	.map((n) => Number(n.trim()))
	.filter(Boolean);
const SORTIE = argument("json");
const MODELE = argument("modele") ?? "Xenova/nllb-200-distilled-600M";

if (!ID && !TEXTE) {
	console.error('Indiquer --databook <id> ou --texte "…".');
	process.exit(1);
}

const url = (await Bun.file(new URL("../.env", import.meta.url)).text())
	.split("\n")
	.find((l) => l.startsWith("DATABASE_URL="))
	?.slice("DATABASE_URL=".length)
	.replace(/^"|"$/g, "")
	.trim();
if (!url) throw new Error("DATABASE_URL introuvable dans apps/site/.env");
const sql = postgres(url, { max: 2 });

// Lexique du domaine : c'est lui qui porte la forme française officielle.
const brut = await sql<{ ja: string; fr: string; kind: string }[]>`
	SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'planete'   FROM bot.db_planets    WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'race'      FROM bot.db_races      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'saga'      FROM bot.db_sagas      WHERE name_ja IS NOT NULL
	UNION ALL SELECT name_ja, name, 'technique' FROM bot.db_techniques WHERE name_ja IS NOT NULL
`;
const vus = new Set<string>();
const termes: TermeLexique[] = [];
for (const l of brut) {
	for (const v of String(l.ja).split(/[,、;]/)) {
		const ja = v
			.trim()
			.replace(/^[（(]+|[）)]+$/g, "")
			.trim();
		if (ja.length < 2 || !contientJaponais(ja) || vus.has(ja)) continue;
		vus.add(ja);
		// La désambiguïsation entre parenthèses (« Piccolo (futur) ») est utile en
		// base et parasite dans une phrase traduite.
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
console.log(`lexique : ${lex.length} termes`);

let traduire: (t: string) => Promise<string>;
try {
	const { env, pipeline } = await import("@huggingface/transformers");
	// Cache partagé avec les modèles du RAG : inutile de dupliquer des gigaoctets.
	env.cacheDir = new URL("../../bot/.models", import.meta.url).pathname;
	console.log(`chargement de ${MODELE}…`);
	const t0 = Bun.nanoseconds();
	const pipe = (await pipeline("translation", MODELE, { dtype: "q8" })) as unknown as (
		t: string,
		o: Record<string, unknown>
	) => Promise<{ translation_text: string }[]>;
	console.log(`  prêt en ${((Bun.nanoseconds() - t0) / 1e9).toFixed(0)} s`);
	traduire = async (t) =>
		(await pipe(t, { src_lang: "jpn_Jpan", tgt_lang: "fra_Latn", max_new_tokens: 220 }))[0]
			.translation_text;
} catch (e) {
	console.error(
		"@huggingface/transformers est introuvable.\n" +
			"  bun add @huggingface/transformers\n" +
			`  (${(e as Error).message})`
	);
	await sql.end();
	process.exit(1);
}

/** Traduit un texte japonais en protégeant le vocabulaire du domaine. */
async function traduireProtege(texte: string): Promise<string> {
	const morceaux: string[] = [];
	for (const segment of segmentsTraduisibles(texte)) {
		if (!contientJaponais(segment)) {
			// Un segment déjà latin (titre anglais, crédits) n'a rien à gagner à
			// passer par le modèle, et il en ressortirait déformé.
			morceaux.push(segment);
			continue;
		}
		const { masque, table, debordement } = protegerTermes(segment, lex);
		if (debordement > 0) {
			console.warn(`  ⚠ ${debordement} terme(s) non protégé(s) — segment dense`);
		}
		morceaux.push(restaurerTermes(await traduire(masque), table));
	}
	return morceaux.join(" ");
}

if (TEXTE) {
	console.log(`\nja : ${TEXTE}`);
	console.log(`fr : ${await traduireProtege(TEXTE)}`);
	await sql.end();
	process.exit(0);
}

const [fiche] = await sql<{ titre: string; pages: { number: number; text: string | null }[] }[]>`
	SELECT title AS titre, pages FROM bot.db_databooks WHERE id = ${ID}
`;
if (!fiche) {
	console.error(`Databook ${ID} introuvable.`);
	await sql.end();
	process.exit(1);
}

const aTraduire = fiche.pages.filter(
	(p) => p.text?.trim() && (!PLANCHES || PLANCHES.includes(p.number))
);
console.log(`\n${fiche.titre} — ${aTraduire.length} planche(s)\n`);

const resultats: { numero: number; ja: string; fr: string }[] = [];
for (const p of aTraduire) {
	const t0 = Bun.nanoseconds();
	const fr = await traduireProtege(p.text!);
	resultats.push({ numero: p.number, ja: p.text!, fr });
	console.log(`— planche ${p.number} (${((Bun.nanoseconds() - t0) / 1e9).toFixed(1)} s)`);
	console.log(`${fr.slice(0, 400)}${fr.length > 400 ? "…" : ""}\n`);
}

if (SORTIE) {
	await Bun.write(SORTIE, JSON.stringify({ databook: ID, titre: fiche.titre, resultats }, null, 2));
	console.log(`→ ${SORTIE}`);
}
console.log("\nRien n'a été écrit en base : ces traductions sont des propositions.");
await sql.end();
