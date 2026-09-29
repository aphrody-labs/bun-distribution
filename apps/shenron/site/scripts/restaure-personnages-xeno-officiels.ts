import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text();
	const line = env.split("\n").find((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

// Official game/side-story figures requested for the dedicated Xeno corpus.
// Short placeholder rows remain hidden until their articles are sourced.
const ids = [95, 99, 100, 143, 144, 203, 216, 264];
const sql = postgres(await databaseUrl(), { max: 1 });
let restored = 0;
try {
	await sql.begin(async (tx) => {
		for (const id of ids) {
			const [row] = await tx`select id,name,visible,length(coalesce(article,'')) as article_length,jsonb_array_length(coalesce(article_sources,'[]'::jsonb)) as source_count from bot.db_characters where id=${id}`;
			if (!row || Number(row.article_length) < 1000 || Number(row.source_count) < 1) continue;
			if (row.visible === false) {
				await tx`update bot.db_characters set visible=true where id=${id}`;
				await tx`insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values (${crypto.randomUUID()},'db_characters',${id},'update',${`Restauration corpus Xeno officiel — ${row.name}`},${tx.json({ visible: false, name: row.name })},${tx.json({ visible: true, continuity: 'official-derivative-xeno', name: row.name })},'shenron-xeno-corpus','Shenron — corpus Xeno')`;
				restored++;
			}
		}
	});
	console.log(JSON.stringify({ restored, candidates: ids.length, note: "Les fiches courtes restent masquées jusqu'à enrichissement sourcé." }));
} finally {
	await sql.end({ timeout: 5 });
}
