/**
 * Builds `messages/glossary.json` — the vocabulary machine translation must not
 * touch — from our own tables.
 *
 *   bun apps/shenron/site/scripts/i18n-glossary-build.ts          # report only
 *   bun apps/shenron/site/scripts/i18n-glossary-build.ts --apply  # write the file
 *
 * Sources: characters, techniques, planets, transformations and races of the
 * wiki, plus the site's own brand words. Nothing is invented here: a term
 * exists because a row carries it.
 *
 * Two filters matter, and both come from what the tables actually hold:
 *
 *  - Many `name` values are descriptions, not names (« L'ami de l'homme qui
 *    tirait sur les gens »). Protecting a sentence would leave it untranslated
 *    in the middle of a translated page, so only capitalised groups of at most
 *    three words qualify.
 *  - `name_ja` is not always Japanese (see the project memory on that trap): a
 *    Latin string there would send Latin text into a Japanese page. The column
 *    is used only when it really carries kana or kanji.
 */
import postgres from "postgres";
import path from "node:path";
import type { GlossaryTerm } from "@/lib/i18n/glossary";

/**
 * The site's database URL. `@/lib/db` is server-only and throws outside Next,
 * so the script reads the env file the same way the other maintenance scripts
 * do — last `DATABASE_URL=` line wins, the earlier one is a commented leftover.
 */
async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(path.join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const valeur = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

/** Up to three capitalised words: a name, not a sentence. */
const NOM_PROPRE = /^[\p{Lu}\p{N}][\p{L}\p{M}\p{N}''\-.·]*(?:[  ][\p{Lu}\p{N}][\p{L}\p{M}\p{N}''\-.·]*){0,2}$/u;
const JAPONAIS = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
/**
 * A usable Hepburn form: Latin letters and macrons, at most four words.
 *
 * The column is not clean. Measured on the live table, `name_romaji` holds
 * « Abocado , » and « Le lutteur diabolique (nom français, AB Prod)<br » —
 * leftovers of an old import. Writing those into an English page would be
 * worse than printing the French name.
 */
const ROMAJI = /^[\p{Script=Latin}\p{M}][\p{Script=Latin}\p{M}'’\-.]*(?:[  ][\p{Script=Latin}\p{M}][\p{Script=Latin}\p{M}'’\-.]*){0,3}$/u;

/** Words a translator would happily turn into common nouns. Never do that. */
const MOTS_DE_MARQUE: GlossaryTerm[] = [
	{ fr: "Dragon Ball", ja: "ドラゴンボール" },
	{ fr: "DBFR" },
	{ fr: "Dragon Ball Z", ja: "ドラゴンボールZ" },
	{ fr: "Dragon Ball Super", ja: "ドラゴンボール超" },
	{ fr: "Dragon Ball Daima", ja: "ドラゴンボールDAIMA" },
	{ fr: "Dragon Ball GT", ja: "ドラゴンボールGT" },
	{ fr: "Akira Toriyama", ja: "鳥山明", romaji: "Akira Toriyama" },
	{ fr: "Bird Studio", ja: "バード・スタジオ" },
	{ fr: "Shūeisha", ja: "集英社" },
	{ fr: "Weekly Shōnen Jump", ja: "週刊少年ジャンプ" },
	{ fr: "Daizenshuu", ja: "大全集" },
	{ fr: "Chōzenshū", ja: "超全集" },
	{ fr: "Shenron", ja: "神龍" },
	{ fr: "Kinto-Un", ja: "筋斗雲" },
	{ fr: "Discord" },
	{ fr: "Toriyama", ja: "鳥山" },
];

/** Terms too short or too common to protect safely. */
const REFUSES = new Set(["ki", "or", "un", "une", "le", "la", "roi", "dieu", "ange", "terre", "no", "the"]);

function retenir(name: string | null, nameJa: string | null, nameRomaji: string | null): GlossaryTerm | null {
	const fr = name?.trim();
	if (!fr || fr.length < 3 || REFUSES.has(fr.toLowerCase())) return null;
	if (!NOM_PROPRE.test(fr)) return null;
	const ja = nameJa?.trim();
	const romaji = nameRomaji?.trim();
	return {
		fr,
		...(ja && JAPONAIS.test(ja) ? { ja } : {}),
		...(romaji && romaji !== fr && romaji.length <= 40 && ROMAJI.test(romaji) ? { romaji } : {}),
	};
}

const termes = new Map<string, GlossaryTerm>();
let ambigus = 0;

/**
 * Merges the spellings of a name carried by several tables — and refuses to
 * choose when they disagree.
 *
 * « Vegeta » is both a prince and his planet. The planet's Hepburn form is
 * `Bejiita-sei`, « planet Vegeta »; pasting it over the character turned « les
 * techniques de Vegeta » into *Bejiita-sei techniques*. When two rows claim the
 * same name with different foreign spellings, neither is trustworthy here, so
 * the term keeps only its French form — which is the spelling the site prints
 * anyway.
 */
function ajouter(terme: GlossaryTerm): void {
	const cle = terme.fr.toLowerCase();
	const existant = termes.get(cle);
	if (!existant) {
		termes.set(cle, terme);
		return;
	}
	const conflit =
		(existant.ja && terme.ja && existant.ja !== terme.ja) ||
		(existant.romaji && terme.romaji && existant.romaji !== terme.romaji);
	if (conflit) {
		ambigus++;
		termes.set(cle, { fr: existant.fr });
		return;
	}
	termes.set(cle, { ...existant, ...terme });
}

for (const t of MOTS_DE_MARQUE) ajouter(t);

type Ligne = { name: string | null; ja: string | null; romaji: string | null };

/**
 * Every row's naming columns, hidden rows included.
 *
 * `visible = false` is the wiki's logical delete: the page stops being
 * published. The NAME does not stop existing — « Son Goku » lives on a hidden
 * duplicate row while « Goku » is the published one, and prose still writes
 * both. A glossary that skipped hidden rows would hand « Son Goku » to Google,
 * which is how a hero becomes *Mr. Goku's Son*.
 */
async function lignes(table: string, colonnes: { ja: boolean; romaji: boolean }): Promise<Ligne[]> {
	const ja = colonnes.ja ? "name_ja" : "null::text";
	const romaji = colonnes.romaji ? "name_romaji" : "null::text";
	return (await sql.unsafe(
		`select name, ${ja} as ja, ${romaji} as romaji from bot.${table} where name is not null and name <> ''`
	)) as unknown as Ligne[];
}

const TABLES: { table: string; etiquette: string; ja: boolean; romaji: boolean }[] = [
	{ table: "db_characters", etiquette: "personnages", ja: true, romaji: true },
	{ table: "db_techniques", etiquette: "techniques", ja: true, romaji: true },
	{ table: "db_planets", etiquette: "planètes", ja: true, romaji: true },
	{ table: "db_transformations", etiquette: "transformations", ja: false, romaji: false },
	{ table: "db_races", etiquette: "races", ja: true, romaji: false },
];

const parTable = new Map<string, number>();
for (const t of TABLES) {
	for (const r of await lignes(t.table, t)) {
		const terme = retenir(r.name, r.ja, r.romaji);
		if (!terme) continue;
		ajouter(terme);
		parTable.set(t.etiquette, (parTable.get(t.etiquette) ?? 0) + 1);
	}
}

const liste = [...termes.values()].toSorted((a, b) => a.fr.localeCompare(b.fr, "fr"));
const avecJa = liste.filter((t) => t.ja).length;
console.log(
	`${liste.length} termes protégés — ${avecJa} avec graphie japonaise, ${ambigus} ramené(s) au seul français (graphies en conflit)\n` +
		[...parTable].map(([k, v]) => `  ${k} : ${v}`).join("\n")
);

if (process.argv.includes("--apply")) {
	const cible = path.resolve(import.meta.dir, "../messages/glossary.json");
	await Bun.write(cible, `${JSON.stringify(liste, null, "\t")}\n`);
	console.log(`→ ${path.relative(process.cwd(), cible)}`);
} else {
	console.log("(lecture seule — relancer avec --apply pour écrire)");
}
process.exit(0);
