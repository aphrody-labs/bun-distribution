#!/usr/bin/env bun

/** Apply verified manga/databook evidence to WikiPage bodies, reversibly. */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

type Bundle = {
	candidate: { id: string; title: string; slug: string };
	status: string;
	evidence: Array<{ document: string; locator: Record<string, unknown>; sourceUrl: string; excerpt: string; textSha256: string }>;
};

const input = process.argv[2] ?? "data/ops/new-wiki-evidence-bundles.json";
const apply = process.argv.includes("--appliquer");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const bundles = (await Bun.file(input).json()) as { bundles: Bundle[] };
const sql = postgres(databaseUrl, { max: 2, prepare: false });
let updated = 0;

try {
	for (const bundle of bundles.bundles.filter((item) => item.status === "evidence_found" && item.evidence.length)) {
		const [page] = await sql<{ id: string; body: string; title: string }[]>`
			SELECT id, body, title FROM public."WikiPage" WHERE slug = ${bundle.candidate.slug} LIMIT 1
		`;
		if (!page || page.body.includes("<!-- shenron-primary-evidence:v1 -->")) continue;
		const evidence = bundle.evidence.map((item) => [
			`### ${item.document}`,
			`- Localisation : \`${JSON.stringify(item.locator)}\``,
			`- Source : <${item.sourceUrl}>`,
			`- Empreinte de la transcription : \`${item.textSha256}\``,
			`- Extrait : ${item.excerpt}`,
		].join("\n")).join("\n\n");
		const body = `${page.body}\n\n<!-- shenron-primary-evidence:v1 -->\n## Éléments vérifiés du corpus primaire\n\n${evidence}\n\n> Ces extraits sont des éléments de preuve ; ils ne constituent pas une décision de canonicité.`;
		if (!apply) { updated++; continue; }
		await sql.begin(async (tx) => {
			await tx`UPDATE public."WikiPage" SET body = ${body}, "updatedAt" = NOW() WHERE id = ${page.id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: randomUUID().replaceAll("-", "").slice(0, 24), tableName: "WikiPage", rowId: page.id,
				action: "update", label: page.title,
				before: tx.json({ body: page.body }), after: tx.json({ body }),
				editorId: "agent", editorName: "Shenron corpus enricher",
			})}`;
		});
		updated++;
	}
	console.log(JSON.stringify({ status: apply ? "APPLIED" : "SIMULATED", updated }));
} finally { await sql.end(); }
