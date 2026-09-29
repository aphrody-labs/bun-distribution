#!/usr/bin/env bun
/**
 * Retire logiquement une fiche personnage dont les attributs éditoriaux ne
 * disposent d'aucune preuve primaire. La ligne reste récupérable via
 * `wiki_revisions`; aucune suppression physique n'est permise.
 */
import postgres from "postgres";

const id = Number(process.argv[2]);
if (!Number.isInteger(id) || id < 1) {
	console.error("Usage: bun retire-unsupported-character.ts <id> [--appliquer]");
	process.exit(2);
}
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
		"select id,name,race,affiliation,description,article,article_sources,visible from bot.db_characters where id=$1",
		[id]
	);
	const before = rows[0] as Record<string, unknown> | undefined;
	if (!before) throw new Error(`personnage #${id} introuvable`);
	const after = {
		...before,
		race: null,
		affiliation: null,
		description: null,
		article: null,
		article_sources: null,
		visible: false,
	};
	console.log(
		JSON.stringify({ mode: appliquer ? "APPLIQUER" : "SIMULATION", before, after }, null, 2)
	);
	if (!appliquer) process.exit(0);
	await sql.begin(async (tx) => {
		await tx.unsafe(
			"update bot.db_characters set race=null, affiliation=null, description=null, article=null, article_sources=null, visible=false where id=$1",
			[id]
		);
		await tx.unsafe(
			'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
			[
				`retire-unsupported-${id}-${crypto.randomUUID()}`,
				"db_characters",
				String(id),
				"update",
				`${String(before.name)} — retrait logique faute de preuve primaire`,
				JSON.stringify(before),
				JSON.stringify(after),
				"agent-shenron",
				"Shenron — assainissement canonique",
			]
		);
	});
	console.log(`✔ personnage #${id} retiré logiquement et versionné`);
} finally {
	await sql.end();
}
