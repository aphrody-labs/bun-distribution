/**
 * ingest-manga-rag.ts — Convertit les transcriptions OCR des planches manga
 * (assets/manga/transcripts/*.md) en corpus RAG (data/rag/corpus-manga.json).
 *
 * Un doc par tome ; chaque planche devient une section markdown (## Planche NNN)
 * dont le contenu = les bulles OCR (ordre de lecture) jointes en texte continu,
 * après un nettoyage léger (suppression du bruit : lignes vides, mono-caractère
 * non alphanumérique, suites de symboles). Les ids "manga-…" → source_id="manga"
 * dans rag-build (resolveSourceId), donc retrievables comme une source à part.
 *
 * Idempotent : réécrit intégralement corpus-manga.json à chaque run.
 * Usage : bun apps/bot/scripts/ingest-manga-rag.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname; // apps/bot/
const TDIR = `${ROOT}assets/manga/transcripts`;
const OUT = `${ROOT}data/rag/corpus-manga.json`;

// Métadonnées de série à partir du préfixe de fichier.
function seriesOf(file: string): { series: string; label: string } {
	const base = file.replace(/\.md$/, "");
	const [prefix, rest] = [base.split("-")[0], base.split("-").slice(1).join("-")];
	if (prefix === "DB") {
		const m = rest.match(/vol(\d+)/i);
		return { series: "Dragon Ball", label: m ? `Tome ${Number(m[1])}` : rest };
	}
	if (prefix === "DBS") {
		const m = rest.match(/ch(\d+)/i);
		return { series: "Dragon Ball Super", label: m ? `Chapitre ${m[1]}` : rest };
	}
	return { series: prefix, label: rest };
}

// Nettoyage léger d'une ligne de bulle OCR. RAG BILINGUE JP+FR : le japonais
// n'est PAS du bruit — un kanji isolé est un mot. On garde donc dès 1 caractère
// CJK (kana/kanji) ; on ne droppe que le bruit pur (symboles, mono-lettre latine).
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function cleanLine(l: string): string | null {
	const t = l
		.replace(/^[-*]\s*/, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!t) return null;
	if (CJK.test(t)) return t; // toute ligne contenant du JP est conservée
	const alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length;
	if (alnum < 2) return null;
	return t;
}

const files = readdirSync(TDIR)
	.filter((f) => f.endsWith(".md"))
	.toSorted();
const docs: { id: string; name: string; url: string; markdown: string }[] = [];

let totalPlanches = 0;
let totalLines = 0;

for (const file of files) {
	const raw = readFileSync(`${TDIR}/${file}`, "utf-8");
	const { series, label } = seriesOf(file);

	// Parse les sections "## Planche NNN" + leurs bulles.
	const planches: { num: string; lines: string[] }[] = [];
	let cur: { num: string; lines: string[] } | null = null;
	for (const line of raw.split("\n")) {
		const h = line.match(/^##\s+Planche\s+(\d+)/i);
		if (h) {
			if (cur && cur.lines.length) planches.push(cur);
			cur = { num: h[1], lines: [] };
			continue;
		}
		if (cur && line.startsWith("-")) {
			const c = cleanLine(line);
			if (c) cur.lines.push(c);
		}
	}
	if (cur && cur.lines.length) planches.push(cur);
	if (!planches.length) continue;

	// Markdown : une section par planche, bulles jointes en texte continu.
	const md = [`# ${series} — ${label} (transcription des planches)`];
	for (const p of planches) {
		md.push(`\n## Planche ${p.num}\n`);
		md.push(p.lines.join(" "));
		totalLines += p.lines.length;
	}
	totalPlanches += planches.length;

	docs.push({
		id: `manga-${file.replace(/\.md$/, "")}`,
		name: `${series} — ${label}`,
		url: "/wiki/manga",
		markdown: md.join("\n"),
	});
}

writeFileSync(OUT, JSON.stringify({ docs }, null, 0));
console.log(
	`✓ corpus-manga.json : ${docs.length} tomes, ${totalPlanches} planches, ${totalLines} lignes nettoyées → ${OUT}`
);
