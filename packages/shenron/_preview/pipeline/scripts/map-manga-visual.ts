/**
 * map-manga-visual.ts — Mappe les PLANCHES VISUELLES du manga (images .webp) à
 * leur transcription OCR, en JSON. Sert de base aux tests/entraînements multimodaux
 * (paires image ↔ texte) — cf. scripts/test-gemma-multimodal.ts.
 *
 * Source : assets/manga/<SÉRIE>/<…>/<tome>/NNN.webp + table db_manga_pages (OCR).
 * Sortie : data/manga-visual-map.json
 *   { totalTomes, totalPages, tomes: [{ series, tome, plancheCount,
 *       pages: [{ planche, image (chemin local), url, text (OCR), hasJa, lineCount }] }] }
 *
 * Usage : bun apps/bot/scripts/map-manga-visual.ts
 */
import { Glob } from "bun";
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // apps/bot/
const MANGA = join(ROOT, "assets", "manga");
const OUT = join(ROOT, "data", "manga-visual-map.json");
const ASSET_BASE = process.env.ASSET_BASE ?? "https://bot.dragonballfr.com";

const db = new Database(join(ROOT, "data", "bot.db"), { readonly: true });
const ocr = new Map<string, { text: string; has_ja: number; line_count: number }>();
for (const r of db
	.query("SELECT series, tome, planche, text, has_ja, line_count FROM db_manga_pages")
	.all() as {
	series: string;
	tome: string;
	planche: number;
	text: string;
	has_ja: number;
	line_count: number;
}[]) {
	ocr.set(`${r.series}|${r.tome}|${r.planche}`, r);
}

interface Page {
	planche: number;
	image: string;
	url: string;
	text: string;
	hasJa: boolean;
	lineCount: number;
}
const byTome = new Map<string, { series: string; tome: string; pages: Page[] }>();

for await (const rel of new Glob("**/*.webp").scan(MANGA)) {
	const parts = rel.split(/[\\/]/); // ex: DBS/ch1348/029.webp | DB/regular/vol1/060.webp
	if (parts[0] === "transcripts") continue;
	const relativeImage = parts.join("/");
	const series = parts[0];
	const tome = parts[parts.length - 2];
	const planche = Number.parseInt(parts[parts.length - 1], 10);
	if (!Number.isFinite(planche)) continue;
	const key = `${series}/${tome}`;
	if (!byTome.has(key)) byTome.set(key, { series, tome, pages: [] });
	const o = ocr.get(`${series}|${tome}|${planche}`);
	byTome.get(key)!.pages.push({
		planche,
		image: `assets/manga/${relativeImage}`,
		url: `${ASSET_BASE}/assets/manga/${relativeImage}`,
		text: o?.text ?? "",
		hasJa: !!o?.has_ja,
		lineCount: o?.line_count ?? 0,
	});
}

const tomes = [...byTome.values()]
	.map((t) => ({
		series: t.series,
		tome: t.tome,
		plancheCount: t.pages.length,
		pages: t.pages.toSorted((a, b) => a.planche - b.planche),
	}))
	.toSorted((a, b) => a.series.localeCompare(b.series) || a.tome.localeCompare(b.tome));

const totalPages = tomes.reduce((s, t) => s + t.plancheCount, 0);
const withOcr = tomes.reduce((s, t) => s + t.pages.filter((p) => p.text).length, 0);
writeFileSync(OUT, JSON.stringify({ totalTomes: tomes.length, totalPages, withOcr, tomes }));
console.log(
	`✓ manga-visual-map.json : ${tomes.length} tomes, ${totalPages} planches (${withOcr} avec OCR) → ${OUT}`
);
db.close();
