#!/usr/bin/env bun
/** Convertit les bibliographies JSON encodées comme chaînes en tableaux JSON réels. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
const tables = [
	"db_characters",
	"db_planets",
	"db_techniques",
	"db_sagas",
	"db_races",
	"db_arcs",
] as const;
async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db")
		.text()
		.catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	for (const table of tables) {
		const rows = await sql.unsafe(
			`select id,name,article_sources from bot.${table} where visible=true and jsonb_typeof(article_sources)='string'`
		);
		for (const row of rows as Array<Record<string, unknown>>) {
			const raw = String(row.article_sources ?? "");
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				console.log(JSON.stringify({ mode: "IGNORÉ", table, id: row.id, reason: "JSON invalide" }));
				continue;
			}
			if (!Array.isArray(parsed)) {
				console.log(
					JSON.stringify({ mode: "IGNORÉ", table, id: row.id, reason: "valeur non-tableau" })
				);
				continue;
			}
			console.log(
				JSON.stringify({
					mode: apply ? "APPLIQUER" : "SIMULATION",
					table,
					id: row.id,
					entries: parsed.length,
				})
			);
			if (!apply) continue;
			const before = { ...row };
			const after = { ...row, article_sources: parsed };
			await sql.begin(async (tx) => {
				await tx.unsafe(
					`update bot.${table} set article_sources=$2::jsonb where id=$1 and visible=true`,
					[String(row.id), sql.json(parsed)]
				);
				await tx.unsafe(
					'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
					[
						`normalise-bibliographie-${table}-${row.id}-${crypto.randomUUID()}`,
						table,
						String(row.id),
						"update",
						`${String(row.name)} — normalisation JSON de la bibliographie`,
						JSON.stringify(before),
						JSON.stringify(after),
						"agent-shenron",
						"Shenron — correction structurelle",
					]
				);
			});
		}
	}
} finally {
	await sql.end();
}
