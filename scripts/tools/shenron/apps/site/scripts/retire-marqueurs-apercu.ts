#!/usr/bin/env bun
/** Retire l'en-tête de gabarit « ## Aperçu » des articles éditoriaux sourcés. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
const tables = ["db_characters", "db_sagas"] as const;
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
			`select * from bot.${table} where visible=true and article like '## Aperçu%'`
		);
		for (const row of rows as Array<Record<string, unknown>>) {
			const article = String(row.article ?? "")
				.replace(/^## Aperçu\s*(?:\r?\n)+/u, "")
				.trimStart();
			if (article === row.article) continue;
			console.log(
				JSON.stringify({
					mode: apply ? "APPLIQUER" : "SIMULATION",
					table,
					id: row.id,
					name: row.name,
				})
			);
			if (!apply) continue;
			const before = { ...row };
			const after = { ...row, article };
			await sql.begin(async (tx) => {
				await tx.unsafe(`update bot.${table} set article=$2 where id=$1 and visible=true`, [
					String(row.id),
					article,
				]);
				await tx.unsafe(
					'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
					[
						`retire-marqueur-apercu-${table}-${row.id}-${crypto.randomUUID()}`,
						table,
						String(row.id),
						"update",
						`${String(row.name)} — retrait du marqueur de gabarit Aperçu`,
						JSON.stringify(before),
						JSON.stringify(after),
						"agent-shenron",
						"Shenron — nettoyage éditorial",
					]
				);
			});
		}
	}
} finally {
	await sql.end();
}
