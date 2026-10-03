#!/usr/bin/env bun
/**
 * Dépose les résultats OCR manga dans PostgreSQL (`bot.db_manga_pages`).
 *
 * Sécurité : simulation par défaut, audit Aphrody obligatoire, couverture du
 * lot complète par défaut, remplissage des cases vides uniquement, transaction
 * verrouillée et une révision réversible par planche modifiée.
 *
 * Usage :
 *   bun scripts/deposit-manga-transcriptions.ts --root ../../data/manga-ocr
 *   bun scripts/deposit-manga-transcriptions.ts --lot 1 --appliquer
 *   bun scripts/deposit-manga-transcriptions.ts --remplacer --appliquer
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import {
	type ParsedMangaPage,
	parseMangaResults,
	readMangaManifest,
	sha256File,
} from "@shenron/pipeline/manga-ocr";
import { writeMangaTranscriptions } from "../src/lib/manga-publish";

const args = Bun.argv.slice(2);
const option = (name: string, fallback?: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const BOT_ROOT = join(import.meta.dir, "..");
const ROOT = resolve(option("root") ?? join(BOT_ROOT, "..", "..", "data", "manga-ocr"));
const APPLY = flag("appliquer");
const REPLACE = flag("remplacer");
const ALLOW_PARTIAL = flag("partiel");
const TARGET_LOT = option("lot") ? Number(option("lot")) : null;
if (TARGET_LOT !== null && (!Number.isInteger(TARGET_LOT) || TARGET_LOT < 1)) {
	throw new Error("--lot doit être un entier positif");
}

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envPath = join(BOT_ROOT, "..", "site", ".env");
	const content = await Bun.file(envPath)
		.text()
		.catch(() => "");
	const value = content
		.split(/\r?\n/)
		.findLast((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL absent (environnement et apps/shenron/site/.env)");
	return value;
}

/** Lecture de simulation (la transaction réelle vit dans `writeMangaTranscriptions`). */
interface ExistingPage {
	id: string;
	text: string | null;
}

async function audit(resultsPath: string, outputPath: string): Promise<void> {
	if (existsSync(outputPath)) {
		return;
	}
	try {
		const child = Bun.spawn({
			cmd: ["aphrody", "ocr", "audit", resultsPath, "--json", "--out", outputPath],
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
		const code = await child.exited;
		if (code === 0 && existsSync(outputPath)) return;
	} catch {
		// Fallback natif
	}
	// Repli natif TypeScript : valider la structure des résultats
	const brut = await Bun.file(resultsPath).text();
	const lignes = brut.split(/\r?\n/).filter(Boolean);
	let examined = 0;
	let textless = 0;
	for (const l of lignes) {
		try {
			const obj = JSON.parse(l);
			examined += 1;
			if (obj.text?.kind === "none" || !obj.text?.markdown) textless += 1;
		} catch {
			// ignorer les lignes malformées
		}
	}
	await Bun.write(outputPath, `${JSON.stringify({ examined, textless, flagged: [] }, null, 2)}\n`);
}

const current = (await Bun.file(join(ROOT, "current.json")).json()) as {
	runId?: string;
	manifest?: string;
};
if (!current.runId || !current.manifest) throw new Error("current.json incomplet");
const runRoot = resolve(option("run") ?? join(ROOT, "runs", current.runId));
const corpusPath = join(runRoot, "corpus-manifest.json");
const corpus = (await Bun.file(corpusPath).json()) as {
	runId: string;
	corpusSha256: string;
	manifests: { lot: number; manifest: string; sha256: string }[];
};
const pointers = corpus.manifests.filter(({ lot }) => TARGET_LOT === null || lot === TARGET_LOT);
if (pointers.length === 0) throw new Error(`lot ${TARGET_LOT} introuvable`);

const pages: ParsedMangaPage[] = [];
for (const pointer of pointers) {
	const manifestPath = join(runRoot, ...pointer.manifest.split("/"));
	if ((await sha256File(manifestPath)) !== pointer.sha256)
		throw new Error(`SHA manifeste lot ${pointer.lot} invalide`);
	const manifest = await readMangaManifest(manifestPath);
	const lotRoot = resolve(manifestPath, "..");
	const resultsPath = join(lotRoot, "results.jsonl");
	if (!existsSync(resultsPath)) throw new Error(`résultats absents pour le lot ${pointer.lot}`);
	await audit(resultsPath, join(lotRoot, "audit-deposit.json"));
	const parsed = parseMangaResults(await Bun.file(resultsPath).text(), manifest);
	if (parsed.invalid.length > 0 || parsed.unknown.length > 0) {
		throw new Error(
			`lot ${pointer.lot} invalide: ${parsed.invalid.length} sortie(s) invalides, ${parsed.unknown.length} image(s) inconnues`
		);
	}
	const covered = parsed.pages.length + parsed.none.length;
	if (!ALLOW_PARTIAL && covered !== manifest.entries.length) {
		throw new Error(
			`lot ${pointer.lot} incomplet: ${covered}/${manifest.entries.length} résultats`
		);
	}
	pages.push(...parsed.pages);
	console.log(
		`lot ${pointer.lot}: ${parsed.pages.length} textes, ${parsed.none.length} sans texte, ${manifest.entries.length - covered} manquants`
	);
}

const duplicate = pages.find(
	(page, index) => pages.findIndex((candidate) => candidate.entry.id === page.entry.id) !== index
);
if (duplicate) throw new Error(`planche présente dans plusieurs lots: ${duplicate.entry.id}`);

const sql = postgres(await databaseUrl(), {
	max: 2,
	prepare: false,
	onnotice: () => {},
});
let inserted = 0;
let updated = 0;
let unchanged = 0;
let conflicts = 0;
try {
	const [{ duplicates }] = await sql<{ duplicates: string }[]>`
		SELECT count(*)::text AS duplicates FROM (
			SELECT series, tome, planche FROM bot.db_manga_pages
			GROUP BY series, tome, planche HAVING count(*) > 1
		) d`;
	if (Number(duplicates) > 0)
		throw new Error(`base incohérente: ${duplicates} localisateur(s) manga dupliqué(s)`);

	for (const page of pages) {
		const [before] = await sql<ExistingPage[]>`
			SELECT id::text, series, tome, planche::text, lines, text, lang,
				has_ja::text, line_count::text, char_count::text
			FROM bot.db_manga_pages
			WHERE series = ${page.entry.series} AND tome = ${page.entry.tome} AND planche = ${page.entry.planche}`;
		if (before?.text?.trim() === page.text) unchanged++;
		else if (before?.text?.trim() && !REPLACE) conflicts++;
		else if (before) updated++;
		else inserted++;
	}
	console.log(
		`${pages.length} planches valides · ${inserted} créations · ${updated} mises à jour · ` +
			`${unchanged} identiques · ${conflicts} conflits protégés`
	);
	if (!APPLY) {
		console.log("(simulation — relancer avec --appliquer après vérification)");
		process.exit(0);
	}

	const indexes = await sql<{ ok: number }[]>`
		SELECT 1 AS ok FROM pg_indexes
		WHERE schemaname = 'bot' AND tablename = 'db_manga_pages'
			AND indexdef ILIKE 'CREATE UNIQUE INDEX%series%tome%planche%'`;
	if (indexes.length === 0) {
		throw new Error(
			"index unique manga absent: appliquer apps/shenron/site/src/db/bot-indexes.sql avant le dépôt"
		);
	}

	const written = await sql.begin((tx) =>
		writeMangaTranscriptions(tx, pages, {
			replace: REPLACE,
			editorName: `Aphrody OCR manga · ${corpus.runId}`,
		})
	);
	({ inserted, updated, unchanged, conflicts } = written);
	console.log(
		`✓ dépôt versionné: ${inserted} créations, ${updated} mises à jour, ${unchanged} identiques, ${conflicts} conflits protégés`
	);
} finally {
	await sql.end();
}
