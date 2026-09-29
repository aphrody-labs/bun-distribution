#!/usr/bin/env bun
/** Matérialise PostgreSQL en Markdown par tome pour le RAG et l'archivage local. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { atomicWriteText, MANGA_SERIES, type MangaSeries, mangaTomeMarkdown } from "../src/manga-ocr";

const args = Bun.argv.slice(2);
const option = (name: string, fallback?: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BOT_ROOT = join(import.meta.dir, "..");
const OUTPUT = resolve(option("sortie") ?? join(BOT_ROOT, "assets", "manga", "transcripts"));
const PLAN = args.includes("--plan");
const requested = (option("series", "DB,DBS") ?? "")
	.split(",")
	.map((value) => value.trim().toUpperCase())
	.filter(Boolean);
if (
	requested.length === 0 ||
	requested.some((value) => !MANGA_SERIES.includes(value as MangaSeries))
) {
	throw new Error("--series accepte uniquement DB, DBS ou DB,DBS");
}
const series = [...new Set(requested)] as MangaSeries[];

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const content = await Bun.file(join(BOT_ROOT, "..", "site", ".env"))
		.text()
		.catch(() => "");
	const value = content
		.split(/\r?\n/)
		.findLast((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL absent");
	return value;
}

interface Row {
	series: MangaSeries;
	tome: string;
	planche: string;
	lines: string | null;
	text: string;
}

function parseLines(value: string | null, fallback: string): string[] {
	if (value) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (Array.isArray(parsed)) {
				const lines = parsed.filter(
					(line): line is string => typeof line === "string" && line.trim().length > 0
				);
				if (lines.length > 0) return lines;
			}
		} catch {
			// Les anciens imports ont parfois une ligne brute : le texte joint reste la récupération sûre.
		}
	}
	return fallback.trim() ? [fallback.trim()] : [];
}

const sql = postgres(await databaseUrl(), {
	max: 2,
	prepare: false,
	onnotice: () => {},
});
try {
	const rows = await sql<Row[]>`
		SELECT series, tome, planche::text, lines, text
		FROM bot.db_manga_pages
		WHERE series IN ${sql(series)} AND text IS NOT NULL AND length(trim(text)) > 0
		ORDER BY series, tome, planche`;
	const groups = new Map<
		string,
		{
			series: MangaSeries;
			tome: string;
			pages: Array<{ planche: number; lines: string[]; text: string }>;
		}
	>();
	for (const row of rows) {
		const key = `${row.series}:${row.tome}`;
		const group = groups.get(key) ?? {
			series: row.series,
			tome: row.tome,
			pages: [],
		};
		group.pages.push({
			planche: Number(row.planche),
			lines: parseLines(row.lines, row.text),
			text: row.text,
		});
		groups.set(key, group);
	}
	console.log(`${rows.length} planches · ${groups.size} tomes/chapitres → ${OUTPUT}`);
	if (!PLAN) {
		await mkdir(OUTPUT, { recursive: true });
		for (const group of groups.values()) {
			await atomicWriteText(
				join(OUTPUT, `${group.series}-${group.tome}.md`),
				mangaTomeMarkdown(group.series, group.tome, group.pages)
			);
		}
		console.log(`✓ ${groups.size} fichiers Markdown matérialisés atomiquement`);
	}
} finally {
	await sql.end();
}
