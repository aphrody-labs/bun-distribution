#!/usr/bin/env bun
/**
 * Lecture des DEUX SEULES sources autorisées pour rédiger le wiki :
 * les tomes du manga (OCR français, `bot.db_manga_pages`) et les planches
 * transcrites des databooks (japonais, `bot.db_databooks.pages`).
 *
 * Ni Fandom, ni le RAG (qui mélange les deux avec du Fandom), ni la mémoire du
 * modèle : ce script est le seul robinet. Ce qu'il ne rend pas ne s'écrit pas.
 *
 * Les planches de databook que `defautDePlanche` juge mal lues sont ÉCARTÉES par
 * défaut : ~19 % du corpus est une hallucination du modèle de vision, la citer
 * reviendrait à sourcer une invention. `--avec-fautives` les montre, marquées.
 *
 * Usage :
 *   bun scripts/sources-wiki.ts manga "kaio" [--serie DB] [--limite 20] [--contexte 300]
 *   bun scripts/sources-wiki.ts databook "戦闘力" [--limite 20] [--avec-fautives]
 *   bun scripts/sources-wiki.ts planche <ficheId> <page>       # texte entier d'une planche
 *   bun scripts/sources-wiki.ts page <serie> <tome> <planche>  # texte entier d'une page manga
 *   bun scripts/sources-wiki.ts tome <serie> <tome>            # sommaire OCR d'un tome
 *   bun scripts/sources-wiki.ts fiche <table> <id>             # état actuel d'une fiche + sections
 *   bun scripts/sources-wiki.ts cherche <table> "<nom>"        # retrouver une entité par son nom (graphie de la base)
 *   bun scripts/sources-wiki.ts databooks                      # catalogue des ouvrages
 *
 * `--json` pour une sortie machine.
 */
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche, type Defaut } from "../src/lib/databooks-defauts";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.startsWith("DATABASE_URL="));
	const valeur = ligne
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/shenron/site/.env).");
		process.exit(1);
	}
	return valeur;
}

const TABLES_WIKI = new Set([
	"db_characters",
	"db_planets",
	"db_techniques",
	"db_transformations",
	"db_races",
	"db_sagas",
	"db_episodes",
	"db_movies",
	"db_games",
]);
const LIMITE = Number(opt("limite", "20"));
const CONTEXTE = Number(opt("contexte", "320"));
const JSON_OUT = flag("json");

/** Extrait les fenêtres de texte autour de chaque occurrence du terme. */
function extraits(texte: string, terme: string, largeur: number, max = 3): string[] {
	const hay = texte.toLowerCase();
	const needle = terme.toLowerCase();
	const out: string[] = [];
	let from = 0;
	while (out.length < max) {
		const i = hay.indexOf(needle, from);
		if (i === -1) break;
		const d = Math.max(0, i - Math.floor(largeur / 2));
		out.push(
			texte
				.slice(d, d + largeur)
				.replace(/\s+/g, " ")
				.trim()
		);
		from = i + needle.length;
	}
	return out;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const sortie = (v: unknown) => console.log(JSON.stringify(v, null, 2));

try {
	const commande = args[0];

	if (commande === "manga") {
		const terme = args[1];
		if (!terme) throw new Error("terme de recherche manquant");
		const serie = opt("serie");
		const lignes = await sql<{ series: string; tome: string; planche: number; text: string }[]>`
			SELECT series, tome, planche, text FROM bot.db_manga_pages
			WHERE text IS NOT NULL
			  AND unaccent(text) ILIKE unaccent(${"%" + terme + "%"})
			  ${serie ? sql`AND series = ${serie}` : sql``}
			ORDER BY series, (tome ~ '^[0-9]+$')::int DESC, lpad(tome, 4, '0'), planche
			LIMIT ${LIMITE}`;
		const res = lignes.map((l) => ({
			source: `Manga ${l.series} — tome ${l.tome}, planche ${l.planche}`,
			serie: l.series,
			tome: l.tome,
			planche: l.planche,
			extraits: extraits(l.text, terme, CONTEXTE),
		}));
		if (JSON_OUT) sortie(res);
		else
			for (const r of res) {
				console.log(`\n### ${r.source}`);
				for (const e of r.extraits) console.log(`  … ${e} …`);
			}
		console.log(`\n(${res.length} planche(s) — corpus manga OCR français)`);
	} else if (commande === "databook") {
		const terme = args[1];
		if (!terme) throw new Error("terme de recherche manquant");
		const avecFautives = flag("avec-fautives");
		const fiches = await sql<
			{ id: number; title: string; title_ja: string | null; kind: string | null; pages: unknown }[]
		>`
			SELECT id, title, title_ja, kind, pages FROM bot.db_databooks WHERE pages IS NOT NULL ORDER BY id`;
		const res: {
			source: string;
			fiche: number;
			page: number;
			defaut: Defaut | null;
			extraits: string[];
		}[] = [];
		for (const f of fiches) {
			const pages = Array.isArray(f.pages) ? (f.pages as Record<string, unknown>[]) : [];
			for (const p of pages) {
				const texte = typeof p.text === "string" ? p.text : "";
				if (!texte.toLowerCase().includes(terme.toLowerCase())) continue;
				const defaut = defautDePlanche(p, texte);
				if (defaut && !avecFautives) continue;
				res.push({
					source: `${f.title} — planche ${p.number}`,
					fiche: f.id,
					page: Number(p.number ?? 0),
					defaut,
					extraits: extraits(texte, terme, CONTEXTE),
				});
				if (res.length >= LIMITE) break;
			}
			if (res.length >= LIMITE) break;
		}
		if (JSON_OUT) sortie(res);
		else
			for (const r of res) {
				console.log(
					`\n### ${r.source}${r.defaut ? `  [PLANCHE JUGÉE FAUTIVE : ${r.defaut} — ne pas citer]` : ""}`
				);
				console.log(`  bun scripts/sources-wiki.ts planche ${r.fiche} ${r.page}`);
				for (const e of r.extraits) console.log(`  … ${e} …`);
			}
		console.log(
			`\n(${res.length} planche(s)${avecFautives ? "" : " saines"} — corpus databooks transcrits)`
		);
	} else if (commande === "planche") {
		const fiche = Number(args[1]);
		const page = Number(args[2]);
		const [f] = await sql<{ title: string; title_ja: string | null; pages: unknown }[]>`
			SELECT title, title_ja, pages FROM bot.db_databooks WHERE id = ${fiche}`;
		if (!f) throw new Error(`fiche databook ${fiche} introuvable`);
		const pages = Array.isArray(f.pages) ? (f.pages as Record<string, unknown>[]) : [];
		const p = pages.find((x) => Number(x.number) === page);
		if (!p) throw new Error(`planche ${page} absente de « ${f.title} »`);
		const texte = typeof p.text === "string" ? p.text : "";
		const defaut = defautDePlanche(p, texte);
		const image = typeof p.image === "string" ? p.image.split("/").pop() : null;
		if (JSON_OUT) sortie({ fiche, titre: f.title, page, defaut, image, texte });
		else {
			console.log(`# ${f.title} — planche ${page}`);
			if (defaut)
				console.log(
					`\n⚠ PLANCHE JUGÉE FAUTIVE (${defaut}) : transcription non fiable, ne rien en tirer.`
				);
			if (image) console.log(`image : apps/shenron/site/public/wiki/databooks/${image}`);
			console.log(`\n${texte}`);
		}
	} else if (commande === "page") {
		const [, serie, tome, planche] = args;
		const [l] = await sql<{ text: string | null; lines: string | null }[]>`
			SELECT text, lines FROM bot.db_manga_pages
			WHERE series = ${serie!} AND tome = ${tome!} AND planche = ${Number(planche)}`;
		if (!l) throw new Error(`planche ${serie} ${tome}/${planche} introuvable`);
		if (JSON_OUT) sortie({ serie, tome, planche: Number(planche), texte: l.text });
		else
			console.log(
				`# Manga ${serie} — tome ${tome}, planche ${planche}\n\n${l.text ?? "(aucun texte OCR)"}`
			);
	} else if (commande === "tome") {
		const [, serie, tome] = args;
		const lignes = await sql<{ planche: number; char_count: number | null; text: string | null }[]>`
			SELECT planche, char_count, text FROM bot.db_manga_pages
			WHERE series = ${serie!} AND tome = ${tome!} ORDER BY planche`;
		if (JSON_OUT)
			sortie(
				lignes.map((l) => ({
					planche: l.planche,
					signes: l.char_count,
					apercu: (l.text ?? "").replace(/\s+/g, " ").slice(0, 120),
				}))
			);
		else {
			console.log(`# Manga ${serie} — tome ${tome} (${lignes.length} planches)`);
			for (const l of lignes)
				console.log(
					`${String(l.planche).padStart(3)}  ${(l.text ?? "").replace(/\s+/g, " ").slice(0, 140)}`
				);
		}
	} else if (commande === "databooks") {
		const lignes = await sql<
			{ id: number; title: string; kind: string | null; np: number | null }[]
		>`
			SELECT id, title, kind, jsonb_array_length(pages) AS np FROM bot.db_databooks
			WHERE pages IS NOT NULL ORDER BY np DESC NULLS LAST`;
		if (JSON_OUT) sortie(lignes);
		else
			for (const l of lignes)
				console.log(
					`${String(l.id).padStart(4)}  ${String(l.np ?? 0).padStart(4)} pl.  ${l.kind ?? ""}  ${l.title}`
				);
	} else if (commande === "fiche") {
		const table = args[1]!;
		const id = Number(args[2]);
		if (!/^db_[a-z_]+$/.test(table)) throw new Error("table invalide");
		const [ligne] = (await sql.unsafe(`SELECT * FROM bot.${table} WHERE id = $1`, [
			id,
		])) as unknown as Record<string, unknown>[];
		if (!ligne) throw new Error(`${table}#${id} introuvable`);
		const type = {
			db_characters: "character",
			db_planets: "planet",
			db_techniques: "technique",
			db_sagas: "saga",
			db_races: "race",
			db_transformations: "transformation",
		}[table];
		const sections = type
			? await sql<{ key: string; label: string; sort_order: number; body: string }[]>`
				SELECT key, label, sort_order, body FROM bot.db_wiki_sections
				WHERE entity_type = ${type} AND entity_id = ${id} ORDER BY sort_order`
			: [];
		if (JSON_OUT) sortie({ ligne, sections });
		else {
			for (const [k, v] of Object.entries(ligne)) {
				const s =
					v === null
						? "∅"
						: typeof v === "string"
							? v.length > 200
								? `${v.slice(0, 200)}… (${v.length} signes)`
								: v
							: JSON.stringify(v)?.slice(0, 200);
				console.log(`${k.padEnd(20)} ${s}`);
			}
			console.log(`\n— ${sections.length} section(s) —`);
			for (const s of sections)
				console.log(`  [${s.sort_order}] ${s.key} « ${s.label} » (${s.body?.length ?? 0} signes)`);
		}
	} else if (commande === "cherche") {
		// La graphie retenue en base fait autorité sur celle des planches : sans
		// ce robinet, un agent écrit « Vegeta III » ou « Oob » au son, et la fiche
		// se retrouve à deux doigts de son propre wiki.
		const table = args[1]!;
		const terme = args[2];
		if (!TABLES_WIKI.has(table)) throw new Error(`table inconnue : ${table}`);
		if (!terme) throw new Error("terme de recherche manquant");
		const lignes = (await sql.unsafe(
			`SELECT id, name, COALESCE(name_ja, '') AS name_ja
			 FROM bot.${table}
			 WHERE unaccent(name) ILIKE unaccent($1) OR COALESCE(name_ja, '') ILIKE $1
			 ORDER BY name LIMIT $2`,
			[`%${terme}%`, LIMITE]
		)) as unknown as { id: number; name: string; name_ja: string }[];
		if (JSON_OUT) sortie(lignes);
		else
			for (const l of lignes)
				console.log(`${String(l.id).padStart(5)}  ${l.name}${l.name_ja ? `  (${l.name_ja})` : ""}`);
		console.log(`\n(${lignes.length} entrée(s) — la graphie de la base fait autorité)`);
	} else {
		console.error(
			await Bun.file(import.meta.path)
				.text()
				.then((t) => t.split("*/")[0]!.replace(/^#!.*\n/, ""))
		);
		process.exit(2);
	}
} catch (e) {
	console.error(`✗ ${(e as Error).message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}
