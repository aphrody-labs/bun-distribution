#!/usr/bin/env bun
/** Retire les variantes de puissance qui ne contiennent qu'un placeholder. */
import postgres from "postgres";

const appliquer = process.argv.includes("--appliquer");
const PLACEHOLDER = "Niveau canonique de l'époque";
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
		"select id,character_id,slug,form,power_level,visible from bot.db_character_variants where visible=true and power_level=$1 order by id",
		[PLACEHOLDER]
	);
	console.log(
		JSON.stringify(
			{
				mode: appliquer ? "APPLIQUER" : "SIMULATION",
				count: rows.length,
				sample: rows.slice(0, 10),
			},
			null,
			2
		)
	);
	if (!appliquer) process.exit(0);
	await sql.begin(async (tx) => {
		for (const row of rows) {
			await tx.unsafe("update bot.db_character_variants set visible=false where id=$1", [row.id]);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`retire-variant-${row.id}-${crypto.randomUUID()}`,
					"db_character_variants",
					String(row.id),
					"update",
					`${row.slug} — retrait du placeholder de puissance`,
					JSON.stringify({ visible: true, power_level: row.power_level }),
					JSON.stringify({ visible: false }),
					"agent-shenron",
					"Shenron — assainissement des variantes",
				]
			);
		}
	});
	console.log(`✔ ${rows.length} variante(s) placeholder retirée(s) logiquement et versionnée(s)`);
} finally {
	await sql.end();
}
