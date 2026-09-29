#!/usr/bin/env bun
/** Retire logiquement les sections PWS non sourcées, sans supprimer leur historique. */
import postgres from "postgres";

const appliquer = process.argv.includes("--appliquer");
async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db")
		.text()
		.catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	const rows = await sql.unsafe(
		"select id,key,label,body,visible from bot.db_wiki_sections where entity_type=$1 and entity_id=$2 and group_label=$3 and visible=true order by id",
		["character", 1, "PWS"]
	);
	console.log(
		JSON.stringify(
			{
				mode: appliquer ? "APPLIQUER" : "SIMULATION",
				count: rows.length,
				keys: rows.map((r) => r.key),
			},
			null,
			2
		)
	);
	if (!appliquer) process.exit(0);
	await sql.begin(async (tx) => {
		for (const row of rows) {
			await tx.unsafe("update bot.db_wiki_sections set visible=false where id=$1", [row.id]);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`retire-pws-${row.id}-${crypto.randomUUID()}`,
					"db_wiki_sections",
					String(row.id),
					"update",
					`${row.label} — retrait des données PWS spéculatives`,
					JSON.stringify({ visible: true, body: row.body }),
					JSON.stringify({ visible: false }),
					"agent-shenron",
					"Shenron — assainissement canonique PWS",
				]
			);
		}
	});
	console.log(`✔ ${rows.length} section(s) PWS retirée(s) logiquement et versionnée(s)`);
} finally {
	await sql.end();
}
