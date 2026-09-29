#!/usr/bin/env bun
/**
 * Sourced illustration picking for visible wiki entries without an image, with a
 * missing file, or with a low-resolution one (< 400 px wide). Logic lives in
 * `src/lib/images/wiki-illustration.ts`; this is the batch driver + report.
 *
 * DRY-RUN BY DEFAULT.
 *   --apply          writes `image` for empty / missing entries (revision per change)
 *   --apply-low-res  also replaces images narrower than 400 px (a scan page is not
 *                    always better than a 300 px portrait made for the entry)
 *   --types=a,b      restrict to some types   --limit=N   first N rows per type
 *
 * Report: docs/wiki-illustrations-<date>.md
 */
import { join } from "node:path";
import postgres from "postgres";
import type { IllustrationSource } from "@shenron/images";
import {
	applyIllustration,
	ILLUSTRATION_TYPES,
	MIN_ILLUSTRATION_WIDTH,
	WikiIllustrator,
} from "../src/lib/images/wiki-illustration";

const APPLY = process.argv.includes("--apply");
const APPLY_LOW_RES = process.argv.includes("--apply-low-res");
// Only a strong match is written by default: XV2 portrait, or a databook plate
// whose heading carries the entity's Japanese name. Weaker matches (French word
// in an OCR bubble) are reported for a human, never applied — a blank beats a
// wrong picture.
const APPLY_MIN_CONFIDENCE = 0.85;
const argOpt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const LIMIT = Number(argOpt("limit") ?? 0) || 0;
const RACINE = join(import.meta.dir, "..", "..", "..");
const ROOTS = { bot: join(RACINE, "apps/bot"), site: join(RACINE, "apps/site") };
const DATE = new Date().toISOString().slice(0, 10);
const WANTED = (argOpt("types")?.split(",") ?? Object.keys(ILLUSTRATION_TYPES)).filter((t) => ILLUSTRATION_TYPES[t]);

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(ROOTS.site, ".env")).text().catch(() => "");
	const v = texte.split("\n").findLast((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
	if (!v) throw new Error("DATABASE_URL introuvable");
	return v;
}
const sql = postgres(await urlBase(), { max: 2, prepare: false });
const ill = new WikiIllustrator(sql, ROOTS);
console.log(`${await ill.loadInventoryCache()} dimensions lues depuis l'inventaire`);

interface Row { id: number; name: string; name_ja: string | null; image: string | null }
const stats = {
	examined: 0, emptyBefore: 0, missingBefore: 0, lowResBefore: 0, found: 0, applied: 0, stillEmpty: 0,
	bySource: { xv2: 0, databook: 0, manga: 0, anime: 0 } as Record<IllustrationSource, number>,
};
const lines: string[] = [];
const rejected: string[] = [];
for (const t of WANTED) {
	const T = ILLUSTRATION_TYPES[t]!;
	const rows = (await sql.unsafe(
		`select id, name, ${T.hasNameJa ? "name_ja" : "null as name_ja"}, image from bot.${T.table} where visible order by id ${LIMIT ? `limit ${LIMIT}` : ""}`
	)) as unknown as Row[];
	let perTypeFound = 0, perTypeNeeds = 0;
	for (const r of rows) {
		stats.examined++;
		const need = await ill.needsIllustration(r.image);
		if (!need) continue;
		if (need.reason === "vide") stats.emptyBefore++;
		else if (need.reason === "fichier absent") stats.missingBefore++;
		else stats.lowResBefore++;
		perTypeNeeds++;
		const pick = await ill.pick({ type: t, id: r.id, name: r.name, nameJa: r.name_ja }, T.sources);
		if (!pick) { stats.stillEmpty++; rejected.push(`- ${T.label} #${r.id} ${r.name} (${need.detail})`); continue; }
		stats.found++; perTypeFound++; stats.bySource[pick.source]++;
		lines.push(`| ${T.label} | ${r.id} | ${r.name} | ${need.detail} | ${pick.source} | ${pick.width}×${pick.height} | ${pick.provenance.replace(/\|/g, "/")} | \`${pick.path}\` |`);
		if (APPLY && pick.confidence >= APPLY_MIN_CONFIDENCE && (!need.lowRes || APPLY_LOW_RES)) {
			await applyIllustration(sql, T.table, r.id, r.image, pick);
			stats.applied++;
		}
	}
	console.log(`${T.label}: ${rows.length} fiches, ${perTypeNeeds} à illustrer, ${perTypeFound} candidat(s)`);
}
await sql.end();

const needs = stats.emptyBefore + stats.missingBefore + stats.lowResBefore;
const report = `# Illustrations sourcées du wiki — ${DATE}

Script : \`apps/bot/scripts/wiki-illustrer.ts\` (${APPLY ? "**appliqué**" : "simulation"}${APPLY_LOW_RES ? ", basse résolution comprise" : ""}).
Sources interrogées : xv2, databook, manga, anime. Aucune image n'est générée ; une fiche sans candidat reste vide.

## Compteurs

| Mesure | Valeur |
|---|---|
| Fiches visibles examinées | ${stats.examined} |
| Sans image avant (vide / fichier absent / < ${MIN_ILLUSTRATION_WIDTH} px) | ${needs} (${stats.emptyBefore} / ${stats.missingBefore} / ${stats.lowResBefore}) |
| Candidats trouvés | ${stats.found} |
| — xv2 / databook / manga / anime | ${stats.bySource.xv2} / ${stats.bySource.databook} / ${stats.bySource.manga} / ${stats.bySource.anime} |
| Appliqués (confiance ≥ ${APPLY_MIN_CONFIDENCE}${APPLY_LOW_RES ? "" : ", fiches vides ou fichier absent seulement"}) | ${stats.applied} |
| Sans image après | ${needs - stats.applied} (dont ${stats.stillEmpty} sans aucun candidat) |

Les frames d'animé sont absentes : \`db_episodes.frames\` est NULL partout et aucun
fichier vidéo d'épisode n'est hébergé localement (seuls quelques clips \`.web.mp4\`
de la page d'accueil, dont les posters existent déjà).

## Candidats

| Type | id | Fiche | État avant | Source | Résolution | Provenance | Chemin |
|---|---|---|---|---|---|---|---|
${lines.join("\n")}

## Restées vides (${rejected.length})

${rejected.join("\n")}
`;
const out = join(RACINE, "docs", `wiki-illustrations-${DATE}.md`);
await Bun.write(out, report);
console.log(`\n${JSON.stringify(stats)}\n→ ${out.replace(RACINE + "/", "")}`);
