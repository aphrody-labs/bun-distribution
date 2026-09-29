import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const sql = postgres(await databaseUrl(), { max: 1 });
const tables = [
	["db_items", "name"],
	["db_locations", "name"],
	["db_tournaments", "name"],
	["db_battles", "title"],
	["db_voice_actors", "name"],
	["db_soundtracks", "title"],
] as const;
let hidden = 0;

try {
	for (const [table, labelColumn] of tables) {
		const rows = await sql.unsafe(
			`select id,"${labelColumn}" as label,article,"article_sources" as sources from bot.${table} where visible is distinct from false and (article is null or btrim(article)='') and ("article_sources" is null or btrim("article_sources")='')`
		);
		for (const row of rows) {
			await sql.begin(async (tx) => {
				const before = { id: row.id, [labelColumn]: row.label, article: row.article, article_sources: row.sources, visible: true };
				const after = { ...before, visible: false };
				await tx.unsafe(`update bot.${table} set visible=false where id=$1 and visible is distinct from false`, [String(row.id)]);
				await tx.unsafe(
					'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
					[
						`retire-sans-preuves-${table}-${row.id}-${crypto.randomUUID()}`,
						table,
						String(row.id),
						"update",
						`${String(row.label)} — retrait logique faute d'article et de preuve`,
						JSON.stringify(before),
						JSON.stringify(after),
						"shenron-evidence-gate",
						"Shenron — garde canonique des pages wiki",
					]
				);
			});
			hidden++;
		}
		console.log(`${table}: ${rows.length} page(s) masquée(s)`);
	}
	console.log(JSON.stringify({ hidden }));
} finally {
	await sql.end({ timeout: 5 });
}
