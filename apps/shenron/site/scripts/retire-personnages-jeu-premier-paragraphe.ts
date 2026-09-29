#!/usr/bin/env bun
/** Masque les fiches dont le premier paragraphe affirme une origine exclusivement vidéoludique. */
import postgres from "postgres";

const apply = process.argv.includes("--appliquer");
const pattern = "(jeu vidéo|EX-Fusion entre|Super Dragon Ball Heroes|FighterZ)";
const firstParagraph =
	/((appara[iî]t|apparaissant|introduit|résultat|personnage|avatar|conçu).{0,120}(jeu vidéo|EX-Fusion|Dragon Ball Heroes|FighterZ))/i;
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
	const candidates = await sql.unsafe(
		"select * from bot.db_characters where visible=true and article ~* $1",
		[pattern]
	);
	const rows = (candidates as Array<Record<string, unknown>>).filter((row) =>
		firstParagraph.test(String(row.article ?? "").split(/\n\n/)[0])
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
	for (const row of rows) {
		const after = { ...row, visible: false };
		await sql.begin(async (tx) => {
			await tx.unsafe("update bot.db_characters set visible=false where id=$1 and visible=true", [
				String(row.id),
			]);
			await tx.unsafe(
				'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
				[
					`retire-personnage-jeu-premier-${row.id}-${crypto.randomUUID()}`,
					"db_characters",
					String(row.id),
					"update",
					`${String(row.name)} — retrait logique de l’origine vidéoludique non canonique`,
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
