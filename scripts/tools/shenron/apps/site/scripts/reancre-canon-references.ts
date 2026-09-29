#!/usr/bin/env bun
/** Ré-ancrage déterministe des articles personnages/techniques. Simulation par défaut. */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres from "postgres";
import { exactCanonicalMatches, toWikiSources, type CanonReferenceCandidate } from "../src/lib/wiki-source-reanchor";

const args = process.argv.slice(2);
const APPLY_EXACT = args.includes("--apply-exact");
const APPLY = args.includes("--apply") || APPLY_EXACT;
const idsArg = args.find((arg) => arg.startsWith("--ids="))?.slice(6);
const reportArg = args.find((arg) => arg.startsWith("--report="));
const reportPath = reportArg ? resolve(reportArg.slice("--report=".length)) : undefined;
const ids = idsArg?.split(",").map(Number).filter(Number.isSafeInteger) ?? [];
if (APPLY && ids.length === 0 && !APPLY_EXACT) throw new Error("--apply exige --ids=<id,...> après relecture de la simulation");
const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) throw new Error("DATABASE_URL requis");
const sql = postgres(dbUrl, { max: 2, prepare: false });
const tables = ["db_characters", "db_techniques"] as const;
const references = await sql<CanonReferenceCandidate[]>`
	SELECT id, subject, keywords, source, document, provenance, href
	FROM public.canon_references WHERE visible = true ORDER BY id`;
const report = {
	mode: APPLY ? "apply" : "simulation",
	scanned: 0,
	exact: 0,
	written: 0,
	residual: 0,
	matches: [] as object[],
	residuals: [] as object[],
};

for (const table of tables) {
	const rows = await sql.unsafe<Array<{ id: number; name: string; name_ja: string | null }>>(
		`SELECT id, name, name_ja FROM bot.${table} WHERE article IS NOT NULL AND length(trim(article)) > 0
		 AND coalesce(CASE WHEN jsonb_typeof(article_sources)='array' THEN jsonb_array_length(article_sources) END,0)=0
		 ${ids.length ? `AND id IN (${ids.join(",")})` : ""} ORDER BY id`
	);
	report.scanned += rows.length;
	for (const row of rows) {
		const matches = exactCanonicalMatches(row.name, row.name_ja, references);
		if (matches.length === 0) {
			report.residuals.push({ table, id: row.id, name: row.name, nameJa: row.name_ja });
			continue;
		}
		const sources = toWikiSources(matches.slice(0, 6));
		report.exact++;
		report.matches.push({ table, id: row.id, name: row.name, referenceIds: sources.map((source) => source.canonReferenceId) });
		if (!APPLY) continue;
		await sql.begin(async (tx) => {
			const updated = await tx.unsafe<Array<{ id: number }>>(
				`UPDATE bot.${table} SET article_sources=$1::text::jsonb, article_updated_at=extract(epoch from now())::bigint
				 WHERE id=$2 AND coalesce(CASE WHEN jsonb_typeof(article_sources)='array' THEN jsonb_array_length(article_sources) END,0)=0 RETURNING id`,
				[JSON.stringify(sources), row.id]
			);
			if (updated.length !== 1) throw new Error(`${table}#${row.id} modifié concurremment`);
			await tx.unsafe(
				`INSERT INTO public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName")
				 VALUES ($1,$2,$3,'update',$4,$5::text::jsonb,$6::text::jsonb,NULL,$7)`,
				[randomBytes(12).toString("hex"), table, String(row.id), row.name, JSON.stringify({ article_sources: [] }), JSON.stringify({ article_sources: sources }), "shenron:reancrage-canon-exact"]
			);
		});
		report.written++;
	}
}
report.residual = report.scanned - (APPLY ? report.written : report.exact);
console.log(JSON.stringify(report, null, 2));
if (reportPath) {
	await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Rapport JSON écrit : ${reportPath}`);
}
await sql.end();
