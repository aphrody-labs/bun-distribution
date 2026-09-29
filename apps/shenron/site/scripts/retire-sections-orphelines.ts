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
try {
	const result = await sql.unsafe(`with doomed as (
		select s.id, s.key, to_jsonb(s) as before
		from bot.db_wiki_sections s
		left join bot.db_characters c on c.id=s.entity_id and c.visible is distinct from false
		where s.visible is distinct from false and s.entity_type='character' and c.id is null
	), updated as (
		update bot.db_wiki_sections s set visible=false
		from doomed d where s.id=d.id returning s.id
	)
	insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName")
	select gen_random_uuid(), 'db_wiki_sections', d.id::text, 'update', 'Section orpheline ' || d.key || ' — retrait logique', d.before, d.before || '{"visible":false}'::jsonb, 'shenron-integrity', 'Shenron — intégrité structurelle wiki'
	from doomed d join updated u on u.id=d.id
	returning "rowId"`);
	console.log(`sections orphelines masquées : ${result.length}`);
} finally {
	await sql.end({ timeout: 5 });
}
