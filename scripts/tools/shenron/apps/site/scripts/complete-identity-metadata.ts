#!/usr/bin/env bun
/** Complète uniquement des identités japonaises attestées par les fiches liées. */
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
const edits = [
	{ table: "db_planets", id: "48", fields: { name_ja: "ナメック星", name_romaji: "Namekku-sei" } },
	{ table: "db_planets", id: "45", fields: { name_romaji: "Moro" } },
];
try {
	for (const edit of edits) {
		const beforeRows = await sql.unsafe(
			`select * from bot.${edit.table} where id=$1 and visible=true`,
			[edit.id]
		);
		const before = beforeRows[0] as Record<string, unknown> | undefined;
		if (!before) throw new Error(`${edit.table}#${edit.id} introuvable`);
		const after = { ...before, ...edit.fields };
		console.log(
			JSON.stringify(
				{ mode: apply ? "APPLIQUER" : "SIMULATION", table: edit.table, id: edit.id, before, after },
				null,
				2
			)
		);
		if (!apply) continue;
		await sql.begin(async (tx) => {
			await tx.unsafe(
				`update bot.${edit.table} set ${Object.keys(edit.fields)
					.map((key, index) => `${key}=$${index + 2}`)
					.join(", ")} where id=$1`,
				[edit.id, ...Object.values(edit.fields)]
			);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`complete-identity-${edit.table}-${edit.id}-${crypto.randomUUID()}`,
					edit.table,
					edit.id,
					"update",
					`${String(before.name)} — identité japonaise attestée`,
					JSON.stringify(before),
					JSON.stringify(after),
					"agent-shenron",
					"Shenron — complétion canonique",
				]
			);
		});
	}
} finally {
	await sql.end();
}
