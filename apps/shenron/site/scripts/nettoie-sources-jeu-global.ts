#!/usr/bin/env bun
/** Purge les citations de jeux vidéo des bibliographies wiki et masque les fiches devenues sans preuve. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
const tables = ["db_characters", "db_planets", "db_races", "db_sagas"] as const;
const gameTerms = [
	"xenoverse",
	"dokkan",
	"fighterz",
	"dragon ball legends",
	"compétence dragon ball",
	"compétences de ",
	"répliques de ",
	"personnages jouables",
	"histoire de dragon ball",
];

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
			`select * from bot.${table} where visible=true and article_sources is not null`
		);
		for (const row of rows as Array<Record<string, unknown>>) {
			const sources = Array.isArray(row.article_sources) ? row.article_sources : [];
			const kept = sources.filter((source) => {
				const label = String((source as Record<string, unknown>).label ?? "").toLowerCase();
				return !gameTerms.some((term) => label.includes(term));
			});
			if (kept.length === sources.length) continue;
			const hide = kept.length === 0;
			console.log(
				JSON.stringify({
					mode: apply ? "APPLIQUER" : "SIMULATION",
					table,
					id: row.id,
					name: row.name,
					removed: sources.length - kept.length,
					hide,
				})
			);
			if (!apply) continue;
			const after = {
				...row,
				article_sources: hide ? null : kept,
				visible: hide ? false : row.visible,
			};
			await sql.begin(async (tx) => {
				if (hide) {
					await tx.unsafe(
						`update bot.${table} set article_sources=null, visible=false where id=$1`,
						[String(row.id)]
					);
				} else {
					await tx.unsafe(`update bot.${table} set article_sources=$2::jsonb where id=$1`, [
						String(row.id),
						JSON.stringify(kept),
					]);
				}
				await tx.unsafe(
					'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
					[
						`nettoie-sources-jeu-${table}-${row.id}-${crypto.randomUUID()}`,
						table,
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
	}
} finally {
	await sql.end();
}
