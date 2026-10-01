/**
 * ingest-databooks-rag.ts — Convertit les transcriptions des planches de
 * databooks (Postgres `bot.db_databooks.pages`) en corpus RAG
 * (`data/rag/corpus-databooks.json`).
 *
 * Pourquoi ce script existe : `rag-build.ts` ne lit que le SQLite du bot, où la
 * table `db_databooks` n'existe pas (elle est PG-only). Les 11 928 planches
 * transcrites — le seul corpus japonais que le projet possède en propre —
 * étaient donc absentes du RAG, alors que le manga y est.
 *
 * Un doc par PLANCHE (et non par ouvrage) : une citation RAG doit pointer la
 * planche exacte, sinon elle renvoie le lecteur à un ouvrage de 300 pages. Une
 * fiche par ouvrage est ajoutée en tête pour que la recherche trouve aussi
 * l'ouvrage lui-même (titre, titre japonais, auteur, description).
 *
 * **Règle dure du corpus** : une planche que `defautDePlanche` juge fautive n'est
 * PAS indexée. Indexer une hallucination du modèle de vision reviendrait à la
 * faire ressortir comme une source — exactement ce que l'avertissement public
 * de `TranscriptionTexte.tsx` cherche à éviter, en pire (le RAG, lui, ne montre
 * pas de bandeau). Le juge est importé du site : c'est le module pur qui fait
 * déjà autorité pour la file de relecture, le back-office et l'affichage.
 *
 * Les traductions françaises déjà déposées (`text_fr`) donnent un doc séparé en
 * `fr` : la même planche devient alors atteignable par une requête française,
 * sans que le japonais ne soit dénaturé.
 *
 * Idempotent : réécrit intégralement corpus-databooks.json à chaque run.
 * Usage : bun apps/shenron/bot/scripts/ingest-databooks-rag.ts
 */
import postgres from "postgres";
import { defautDePlanche } from "@shenron/config/databooks-defauts";
import { urlPostgres } from "./_rag-sources-pg";

const BOT_ROOT = new URL("../../../../apps/shenron/bot/", import.meta.url);
const OUT = new URL("data/rag/corpus-databooks.json", BOT_ROOT);
const BASE_URL = "https://dragonballfr.com/wiki/databooks";


/**
 * Le corpus porte DEUX formes de transcription, héritées de deux passes de
 * dépôt : la chaîne nue, et `{ kind, markdown }`. Toute lecture doit accepter
 * les deux — c'est ce que fait `_databooks-base.ts` côté site.
 */
function texteDePlanche(valeur: unknown): string {
	if (typeof valeur === "string") return valeur;
	if (valeur && typeof valeur === "object" && "markdown" in valeur) {
		const md = (valeur as { markdown?: unknown }).markdown;
		if (typeof md === "string") return md;
	}
	return "";
}

interface Planche {
	number?: number | string | null;
	text?: unknown;
	text_fr?: unknown;
}

interface Doc {
	id: string;
	name: string;
	url: string;
	markdown: string;
	lang: string;
}

const sql = postgres(await urlPostgres(), { max: 2, prepare: false });

const ouvrages = (await sql`
	select id, kind, title, title_ja, author, published_at, description, category, pages
	from bot.db_databooks
	where visible
	order by id
`) as unknown as {
	id: string;
	kind: string | null;
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: string | null;
	description: string | null;
	category: string | null;
	pages: unknown;
}[];

const docs: Doc[] = [];
let planches = 0;
let ecartees = 0;
let traduites = 0;

for (const o of ouvrages) {
	const id = Number(o.id);
	const url = `${BASE_URL}/${id}`;

	// Fiche de l'ouvrage : sans elle, « Daizenshuu 7 » ne ramène que des
	// planches, jamais l'ouvrage qui les porte.
	const fiche = [
		o.title_ja ? `Titre japonais : ${o.title_ja}` : "",
		o.author ? `Auteur / éditeur : ${o.author}` : "",
		o.published_at ? `Publication : ${o.published_at}` : "",
		o.kind ? `Type : ${o.kind}` : "",
		o.category ? `Catégorie : ${o.category}` : "",
		(o.description ?? "").trim(),
	]
		.filter(Boolean)
		.join("\n");
	if (fiche.trim().length > 12) {
		docs.push({ id: `databook-${id}`, name: o.title, url, markdown: fiche, lang: "fr" });
	}

	const liste = Array.isArray(o.pages) ? (o.pages as Planche[]) : [];
	for (const p of liste) {
		const numero = Number(p.number);
		if (!Number.isSafeInteger(numero) || numero <= 0) continue;

		const ja = texteDePlanche(p.text).trim();
		if (ja) {
			planches++;
			if (defautDePlanche(p, ja) !== null) {
				ecartees++;
			} else {
				docs.push({
					id: `databook-${id}-p${numero}`,
					name: `${o.title} — planche ${numero}`,
					url: `${url}#planche-${numero}`,
					markdown: ja,
					lang: "ja",
				});
			}
		}

		const fr = texteDePlanche(p.text_fr).trim();
		// La traduction n'est déposée que sur une planche saine (cf. la règle
		// « ne jamais traduire une planche fautive ») : on n'a pas à la rejuger,
		// mais on ne la garde pas si sa source vient d'être écartée.
		if (fr && ja && defautDePlanche(p, ja) === null) {
			traduites++;
			docs.push({
				id: `databook-${id}-p${numero}-fr`,
				name: `${o.title} — planche ${numero} (traduction)`,
				url: `${url}#planche-${numero}`,
				markdown: fr,
				lang: "fr",
			});
		}
	}
}

await Bun.write(OUT, JSON.stringify({ docs }, null, 0));
await sql.end();

const octets = Bun.file(OUT).size;
console.log(
	`✓ corpus-databooks.json : ${docs.length} docs (${ouvrages.length} ouvrages, ` +
		`${planches - ecartees}/${planches} planches retenues, ${ecartees} écartées comme fautives, ` +
		`${traduites} traductions) — ${(octets / 1024 / 1024).toFixed(1)} Mo`
);
