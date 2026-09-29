#!/usr/bin/env bun
/** Retire les citations Xenoverse/compétences de jeu des arcs et masque l'arc sans preuve restante. */
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
		"select * from bot.db_arcs where visible=true and id in (8,9,12,19) order by id"
	);
	for (const row of rows as Array<Record<string, unknown>>) {
		const sources = Array.isArray(row.article_sources) ? row.article_sources : [];
		const kept = sources.filter((source) => {
			const label = String((source as Record<string, unknown>).label ?? "").toLowerCase();
			return !label.includes("xenoverse") && !label.includes("compétence");
		});
		const hide = String(row.id) === "19" && kept.length === 0;
		console.log(
			JSON.stringify(
				{
					mode: apply ? "APPLIQUER" : "SIMULATION",
					id: row.id,
					name: row.name,
					removed: sources.length - kept.length,
					hide,
				},
				null,
				2
			)
		);
		if (!apply) continue;
		const after = {
			...row,
			article_sources: hide ? null : kept,
			visible: hide ? false : row.visible,
		};
		await sql.begin(async (tx) => {
			if (hide) {
				await tx.unsafe("update bot.db_arcs set article_sources=null, visible=false where id=$1", [
					String(row.id),
				]);
			} else {
				await tx.unsafe("update bot.db_arcs set article_sources=$2::jsonb where id=$1", [
					String(row.id),
					JSON.stringify(kept),
				]);
			}
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`nettoie-sources-arcs-jeu-${row.id}-${crypto.randomUUID()}`,
					"db_arcs",
					String(row.id),
					"update",
					`${String(row.name)} — retrait des sources de jeu vidéo non canoniques`,
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
