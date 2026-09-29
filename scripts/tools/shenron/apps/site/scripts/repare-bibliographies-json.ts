import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text();
	const line = env.split("\n").find((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const tables = [
	"db_arcs", "db_battles", "db_characters", "db_dragons", "db_items", "db_locations", "db_planets",
	"db_power_levels", "db_races", "db_sagas", "db_soundtracks", "db_techniques", "db_timeline_events",
	"db_tournaments", "db_transformations", "db_voice_actors", "db_wishes",
];

const sql = postgres(await databaseUrl(), { max: 1 });
let changed = 0;
try {
	for (const table of tables) {
		const [column] = await sql.unsafe(
			"select data_type from information_schema.columns where table_schema='bot' and table_name=$1 and column_name='article_sources'",
			[table],
		);
		if (!column) continue;
		const isJsonb = column.data_type === "jsonb";
		const rows = await sql.unsafe(`select id,article_sources from bot.${table} where visible is distinct from false and article_sources is not null`);
		for (const row of rows) {
			const raw = row.article_sources;
			let parsed: unknown = raw;
			if (typeof raw === "string") {
				try { parsed = JSON.parse(raw); } catch { continue; }
			}
			if (!Array.isArray(parsed)) continue;
			if (isJsonb && Array.isArray(raw)) continue;
			const before = { article_sources: raw };
			const after = { article_sources: parsed };
			await sql.begin(async (tx) => {
				if (isJsonb) {
					await tx`update bot.${sql(table)} set article_sources=${tx.json(parsed as Parameters<typeof tx.json>[0])} where id=${String(row.id)} and visible is distinct from false`;
				} else {
					await tx`update bot.${sql(table)} set article_sources=${JSON.stringify(parsed)} where id=${String(row.id)} and visible is distinct from false`;
				}
				await tx`insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values (${crypto.randomUUID()},${table},${String(row.id)},'update','Normalisation du format des bibliographies',${tx.json(before as Parameters<typeof tx.json>[0])},${tx.json(after as Parameters<typeof tx.json>[0])},'shenron-json-integrity','Shenron — intégrité JSON')`;
			});
			changed++;
		}
	}
	console.log(JSON.stringify({ changed }));
} finally {
	await sql.end({ timeout: 5 });
}
