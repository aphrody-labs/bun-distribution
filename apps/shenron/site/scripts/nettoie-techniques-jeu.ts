#!/usr/bin/env bun
/** Retire les articles de techniques générés depuis des fiches de jeu, sans supprimer la technique. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
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
	const rows = await sql.unsafe(
		"select * from bot.db_techniques where visible=true and article like '%## Aperçu%' order by id"
	);
	console.log(
		JSON.stringify(
			{
				mode: apply ? "APPLIQUER" : "SIMULATION",
				count: rows.length,
				ids: rows.map((row) => row.id),
			},
			null,
			2
		)
	);
	if (!apply) process.exit(0);
	for (const row of rows as Array<Record<string, unknown>>) {
		const after = { ...row, description: null, article: null, article_sources: null };
		await sql.begin(async (tx) => {
			await tx.unsafe(
				"update bot.db_techniques set description=null, article=null, article_sources=null where id=$1 and visible=true",
				[String(row.id)]
			);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`nettoie-technique-jeu-${row.id}-${crypto.randomUUID()}`,
					"db_techniques",
					String(row.id),
					"update",
					`${String(row.name)} — retrait de la prose générée depuis un jeu vidéo`,
					JSON.stringify(row),
					JSON.stringify(after),
					"agent-shenron",
					"Shenron — assainissement canonique",
				]
			);
		});
	}
	console.log(`✔ ${rows.length} articles techniques nettoyés et versionnés`);
} finally {
	await sql.end();
}
