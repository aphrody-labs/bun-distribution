#!/usr/bin/env bun
/**
 * reancre-sources-wiki.ts — Redonne une bibliographie licite aux fiches que la
 * purge Fandom a laissées sans aucune source.
 *
 * La purge du 2026-09-10 a retiré 2 250 citations Fandom : le texte des fiches
 * a survécu, mais 55 d'entre elles ne sont plus attestées par rien. Ce script
 * ne réécrit PAS le texte — il cherche, dans les deux seules sources autorisées
 * (tomes du manga OCR `bot.db_manga_pages`, planches transcrites des databooks
 * `bot.db_databooks.pages`), les planches où le sujet est **réellement nommé**,
 * et repose une bibliographie qui pointe ces planches.
 *
 * Garde-fous, parce qu'une fausse citation est pire qu'une absente :
 *   - correspondance sur **mot entier** (`\mnom\M`), jamais en sous-chaîne :
 *     sans ça « Ange » sort dans « change », « Cae » dans « Cacao » ;
 *   - noms de moins de 4 caractères refusés (trop d'homographes dans l'OCR) ;
 *   - **terme japonais de moins de 3 caractères refusé** : mesuré le 2026-09-10,
 *     『天使』(Ange) remontait l'auréole des morts du Daijiten et Gatchan, envoyé
 *     « comme un ange » dans Dr Slump — deux planches saines, hors sujet. Les
 *     graphies spécifiques (サイヤ人, フリーザ一族, メタモル星人) passent, les mots
 *     communs sortent, et leur fiche part en traitement manuel ;
 *   - planches de databook que `defautDePlanche` juge mal lues **écartées** ;
 *   - n'écrit que si la bibliographie est **vide** : jamais d'écrasement ;
 *   - une fiche sans correspondance reste sans source et ressort dans le
 *     rapport — c'est un résultat, pas un échec à combler ;
 *   - **`--ecris` exige des `--ids` explicites.** Aucune écriture en masse : la
 *     présence d'un mot ne prouve pas que la planche traite du sujet. Mesuré le
 *     2026-09-10 : 『天使』 remontait une planche saine du Chōzenshū 4 qui parle
 *     en réalité de Nekomajin. Le script PROPOSE avec un extrait ; on lit, puis
 *     on écrit les ids retenus. C'est la relecture qui fait la preuve, pas le
 *     nombre de correspondances.
 *
 * Usage :
 *   bun scripts/reancre-sources-wiki.ts db_characters --sans-sources          # simulation
 *   bun scripts/reancre-sources-wiki.ts db_races --sans-sources --ecris
 *   bun scripts/reancre-sources-wiki.ts db_characters --ids 66,30 --ecris
 *   bun scripts/reancre-sources-wiki.ts db_races --ids 13 --max-sources 5 --ecris
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche } from "../src/lib/databooks-defauts";
import { SITE_URL } from "../src/lib/config";
import { containsExactCjkTerm } from "../src/lib/wiki-source-reanchor";

const args = process.argv.slice(2);
const table = args[0] ?? "";
const opt = (nom: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : undefined;
};
const flag = (nom: string) => args.includes(`--${nom}`);
const ECRIS = flag("ecris");
const LIMITE_FICHES = Number(opt("limite") ?? 100);
/**
 * Nombre maximum de références posées par fiche (une bibliographie, pas un
 * index). `--max-sources N` sert à ne retenir que les N premières, quand la
 * relecture n'a validé qu'une partie des correspondances.
 */
const MAX_SOURCES = Number(opt("max-sources") ?? 6);

const TABLES = new Set([
	"db_characters",
	"db_planets",
	"db_races",
	"db_sagas",
	"db_arcs",
	"db_techniques",
	"db_transformations",
]);
if (!TABLES.has(table)) {
	console.error(`✗ table attendue parmi : ${[...TABLES].join(", ")}`);
	process.exit(1);
}
if (ECRIS && !args.includes("--ids")) {
	console.error(
		"✗ --ecris exige --ids : une correspondance n'est pas une preuve, il faut avoir lu les extraits."
	);
	process.exit(1);
}

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const ligne = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1);
	const valeur = ligne?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/site/.env).");
		process.exit(1);
	}
	return valeur;
}

const sql = postgres(await urlBase(), { max: 4, prepare: false });

type Source = { n: number; url: string; kind: string; label: string; extrait?: string };

/** Le nom est-il exploitable comme terme de recherche dans un OCR bruité ? */
function nomCherchable(nom: string): boolean {
	const net = nom.replace(/\(.*?\)/g, "").trim();
	return net.length >= 4 && /^[\p{L}\p{N} '’-]+$/u.test(net);
}

const termeDeNom = (nom: string) => nom.replace(/\(.*?\)/g, "").trim();

/** Planches du manga où le nom apparaît en mot entier. Groupées par tome. */
async function planchesManga(nom: string) {
	const terme = termeDeNom(nom);
	const lignes = await sql<{ series: string; tome: string; planche: number }[]>`
		SELECT series, tome, planche FROM bot.db_manga_pages
		WHERE text IS NOT NULL
		  AND unaccent(text) ~* ('\\m' || unaccent(${terme}) || '\\M')
		ORDER BY series, lpad(regexp_replace(tome, '\\D', '', 'g'), 4, '0'), planche
		LIMIT 200`;
	const parTome = new Map<string, { series: string; tome: string; planches: number[] }>();
	for (const l of lignes) {
		const cle = `${l.series}/${l.tome}`;
		const e = parTome.get(cle) ?? { series: l.series, tome: l.tome, planches: [] };
		e.planches.push(l.planche);
		parTome.set(cle, e);
	}
	return [...parTome.values()];
}

/** Id de tome côté site, pour une URL citable (`/wiki/manga/volume/<id>`). */
async function idDeTome(series: string, tome: string): Promise<number | null> {
	const numero = Number(tome.replace(/\D/g, ""));
	if (!Number.isInteger(numero) || numero <= 0) return null;
	const [v] = await sql<{ id: number }[]>`
		SELECT id FROM bot.db_manga_volumes
		WHERE series = ${series} AND volume_number = ${numero} LIMIT 1`;
	return v?.id ?? null;
}

/**
 * Ouvrages de RÉFÉRENCE, seuls retenus par défaut. La colonne `kind` ne
 * discrimine pas (les V Jump y sont des « databook » comme les Daizenshuu), et
 * un magazine promotionnel de jeu vidéo n'atteste pas un fait de l'œuvre :
 * mesuré sur « Race de Freezer », 4 des 6 correspondances étaient des pages de
 * cartes Heroes et de création d'avatar. `--tous-ouvrages` lève le filtre.
 */
const OUVRAGES_DE_REFERENCE =
	/(daizenshuu|daizenshū|chozenshu|chōzenshū|daijiten|world guide|story guide|super exciting guide|landmark|dragon ball forever|adventure special|super history|anime illustration|complete illustration)/i;

/** Planches de databook nommant le sujet, hallucinations de l'OCR écartées. */
async function planchesDatabook(termes: string[]) {
	const estCJK = (t: string) =>
		/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t);
	// Un terme japonais court est presque toujours un mot commun (天使, 神, 王) :
	// il ramène des planches saines mais hors sujet, donc des fausses preuves.
	const utiles = termes.filter((t) => t && (estCJK(t) ? t.length >= 3 : t.length >= 4));
	if (utiles.length === 0) return [];
	const toutes = await sql<{ id: number; title: string; pages: unknown }[]>`
		SELECT id, title, pages FROM bot.db_databooks WHERE pages IS NOT NULL ORDER BY id`;
	const fiches = flag("tous-ouvrages")
		? toutes
		: toutes.filter((f) => OUVRAGES_DE_REFERENCE.test(f.title));
	const trouvees: { fiche: number; titre: string; page: number; extrait: string }[] = [];
	for (const f of fiches) {
		const pages = Array.isArray(f.pages) ? (f.pages as Record<string, unknown>[]) : [];
		for (const p of pages) {
			const texte = [p.text, p.text_fr].filter((x) => typeof x === "string").join("\n");
			if (!texte) continue;
			const nomme = utiles.some((t) =>
				estCJK(t)
					? containsExactCjkTerm(texte, t)
					: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(texte)
			);
			if (!nomme) continue;
			if (defautDePlanche(p, texte)) continue; // planche mal lue : ne pas sourcer une invention
			const terme = utiles.find((t) => texte.includes(t)) ?? utiles[0]!;
			const i = Math.max(0, texte.indexOf(terme) - 90);
			trouvees.push({
				fiche: f.id,
				titre: f.title,
				page: Number(p.number),
				extrait: texte.slice(i, i + 220).replace(/\s+/g, " "),
			});
		}
	}
	return trouvees;
}

async function main() {
	const conds = [`article IS NOT NULL AND length(article) > 0`];
	if (flag("sans-sources")) {
		conds.push(
			`coalesce(CASE WHEN jsonb_typeof(article_sources) = 'array' THEN jsonb_array_length(article_sources) END, 0) = 0`
		);
	}
	const ids = opt("ids")
		?.split(",")
		.map((x) => Number(x.trim()))
		.filter((n) => Number.isInteger(n));
	if (ids?.length) conds.push(`id IN (${ids.join(",")})`);
	const colonneNom = table === "db_characters" || table === "db_planets" ? "name" : "name";

	const colNameJa = table === "db_transformations" ? "NULL AS name_ja" : "name_ja";
	const fiches = (await sql.unsafe(
		`SELECT id, "${colonneNom}" AS nom, ${colNameJa} FROM bot.${table}
		 WHERE ${conds.join(" AND ")} ORDER BY id LIMIT ${LIMITE_FICHES}`
	)) as unknown as { id: number; nom: string; name_ja: string | null }[];

	console.log(`${fiches.length} fiche(s) ${table} à ré-ancrer${ECRIS ? "" : " (simulation)"}\n`);

	let ancrees = 0;
	const sansPreuve: string[] = [];

	for (const f of fiches) {
		if (!nomCherchable(f.nom)) {
			sansPreuve.push(`${f.nom} (nom trop court/ambigu pour une recherche plein texte)`);
			continue;
		}
		const sources: Source[] = [];
		for (const t of await planchesManga(f.nom)) {
			const idTome = await idDeTome(t.series, t.tome);
			if (!idTome) continue;
			const planches = t.planches.slice(0, 3).join(", ");
			sources.push({
				n: sources.length + 1,
				url: `${SITE_URL}/wiki/manga/volume/${idTome}`,
				kind: "manga_volume",
				label: `Manga ${t.series} — tome ${t.tome.replace(/\D/g, "")}, planche${t.planches.length > 1 ? "s" : ""} ${planches}`,
			});
			if (sources.length >= MAX_SOURCES) break;
		}
		if (sources.length < MAX_SOURCES) {
			const db = await planchesDatabook([termeDeNom(f.nom), f.name_ja ?? ""]);
			for (const d of db) {
				sources.push({
					n: sources.length + 1,
					url: `${SITE_URL}/wiki/databooks/${d.fiche}#planche-${d.page}`,
					kind: "databook",
					label: `${d.titre} — planche ${d.page}`,
					extrait: d.extrait,
				});
				if (sources.length >= MAX_SOURCES) break;
			}
		}

		if (sources.length === 0) {
			sansPreuve.push(`${f.nom} (aucune planche ne le nomme)`);
			continue;
		}
		ancrees++;
		console.log(`· ${f.nom} (#${f.id}) → ${sources.length} source(s)`);
		for (const s of sources) {
			console.log(`    [${s.n}] ${s.label}`);
			if (s.extrait) console.log(`        « …${s.extrait}… »`);
		}

		if (ECRIS) {
			await sql.begin(async (tx) => {
				const sourcesNettoyees = sources.map((s) => ({
					n: s.n,
					url: s.url,
					kind: s.kind,
					label: s.label,
				}));
				await tx.unsafe(
					`UPDATE bot.${table} SET article_sources = $1::jsonb, article_updated_at = (extract(epoch from now())::bigint) WHERE id = $2
					   AND coalesce(CASE WHEN jsonb_typeof(article_sources) = 'array'
					       THEN jsonb_array_length(article_sources) END, 0) = 0`,
					[tx.json(sourcesNettoyees) as never, f.id]
				);
				await tx.unsafe(
					`INSERT INTO public.wiki_revisions
					   (id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
					 VALUES ($1, $2, $3, 'update', $4, $5::jsonb, $6::jsonb, NULL, $7)`,
					[
						randomBytes(12).toString("hex"),
						table,
						String(f.id),
						f.nom,
						tx.json({ article_sources: [] }) as never,
						tx.json({ article_sources: sourcesNettoyees }) as never,
						"Antigravity (ré-ancrage manga/databooks)",
					]
				);
			});
		}
	}

	console.log(
		`\n${ECRIS ? "Écrit" : "Simulation"} — ${ancrees} fiche(s) ré-ancrée(s), ${sansPreuve.length} sans preuve.`
	);
	if (sansPreuve.length) {
		console.log(`\nÀ traiter à la main (le corpus ne les nomme pas) :`);
		for (const s of sansPreuve) console.log(`  · ${s}`);
	}
	await sql.end();
}

await main();
