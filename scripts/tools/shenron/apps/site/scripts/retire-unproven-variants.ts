#!/usr/bin/env bun
/** Retire les variantes sans preuve manga/databook (synopsis seuls). */
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
	const all = await sql.unsafe(
		"select id,character_id,slug,form,power_level,evidence from bot.db_character_variants where visible=true order by id"
	);
	const rows = all.filter(
		(row) =>
			row.evidence?.methode === "synopsis-episodes" &&
			(!Array.isArray(row.evidence?.tomes) || row.evidence.tomes.length === 0)
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
					`retire-unproven-variant-${row.id}-${crypto.randomUUID()}`,
					"db_character_variants",
					String(row.id),
					"update",
					`${row.slug} — retrait faute de preuve manga/databook`,
					JSON.stringify({ visible: true, evidence: row.evidence }),
					JSON.stringify({ visible: false }),
					"agent-shenron",
					"Shenron — doctrine canonique",
				]
			);
		}
	});
	console.log(
		`✔ ${rows.length} variante(s) sans preuve primaire retirée(s) logiquement et versionnée(s)`
	);
} finally {
	await sql.end();
}
