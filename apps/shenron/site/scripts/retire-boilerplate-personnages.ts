#!/usr/bin/env bun
/** Masque les fiches contenant le boilerplate biographique non factuel du générateur. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
const marker = "personnage du vaste univers Dragon Ball créé par Akira Toriyama";
async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	const rows = await sql.unsafe("select * from bot.db_characters where visible=true and article ilike $1 order by id", [`%${marker}%`]);
	console.log(JSON.stringify({ mode: apply ? "APPLIQUER" : "SIMULATION", count: rows.length, ids: rows.map((row) => row.id) }, null, 2));
	if (!apply) process.exit(0);
	for (const row of rows as Array<Record<string, unknown>>) {
		const after = { ...row, visible: false };
		await sql.begin(async (tx) => {
			await tx.unsafe("update bot.db_characters set visible=false where id=$1 and visible=true", [String(row.id)]);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`retire-boilerplate-personnage-${row.id}-${crypto.randomUUID()}`,
					"db_characters",
					String(row.id),
					"update",
					`${String(row.name)} — retrait logique du boilerplate biographique non factuel`,
					JSON.stringify(row),
					JSON.stringify(after),
					"agent-shenron",
					"Shenron — assainissement canonique",
				]
			);
		});
	}
} finally {
	await sql.end();
}
