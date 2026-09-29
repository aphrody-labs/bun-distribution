import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text();
	const line = env.split("\n").find((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const soshuhen: Record<number, number> = { 465: 701 };
for (let id = 469; id <= 485; id++) soshuhen[id] = 702 + (id - 469);
const lightNovels: Record<number, number> = { 58: 719, 59: 720 };

const sql = postgres(await databaseUrl(), { max: 1 });
let hidden = 0;
let inserted = 0;
try {
	await sql.begin(async (tx) => {
		for (const [sourceIdText, targetId] of Object.entries(soshuhen)) {
			const sourceId = Number(sourceIdText);
			const [source] = await tx`select id,title from bot.db_databooks where id=${sourceId}`;
			const [target] = await tx`select id,title from bot.db_manga_volumes where id=${targetId} and visible is distinct from false`;
			if (!source || !target) throw new Error(`Correspondance Sōshūhen absente: ${sourceId} → ${targetId}`);
			if (source && target) {
				await tx`update bot.db_databooks set visible=false where id=${sourceId} and visible is distinct from false`;
				await tx`insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values (${crypto.randomUUID()},'db_databooks',${sourceId},'update',${`Migration Sōshūhen vers Manga — volume ${targetId}`},${tx.json({ visible: true, title: source.title })},${tx.json({ visible: false, migratedTo: `/wiki/manga/volume/${targetId}`, title: source.title, mangaTitle: target.title })},'shenron-manga-migration','Shenron — migration Sōshūhen')`;
				hidden++;
			}
		}

		for (const [sourceIdText, targetId] of Object.entries(lightNovels)) {
			const sourceId = Number(sourceIdText);
			const [source] = await tx`select id,title,title_ja,cover,published_at from bot.db_databooks where id=${sourceId}`;
			if (!source) throw new Error(`Light novel Databook absent: ${sourceId}`);
			const [existing] = await tx`select id from bot.db_manga_volumes where id=${targetId}`;
			if (!existing) {
				await tx`insert into bot.db_manga_volumes (id,series,volume_number,title,title_ja,published_at,cover,visible) values (${targetId},'DB_LIGHT_NOVELS',${targetId - 718},${source.title},${source.title_ja},${source.published_at},${source.cover},true)`;
				inserted++;
			}
			await tx`update bot.db_databooks set visible=false where id=${sourceId} and visible is distinct from false`;
			await tx`insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values (${crypto.randomUUID()},'db_databooks',${sourceId},'update',${`Migration Light Novel vers Manga — volume ${targetId}`},${tx.json({ visible: true, title: source.title })},${tx.json({ visible: false, migratedTo: `/wiki/manga/volume/${targetId}`, title: source.title })},'shenron-manga-migration','Shenron — migration Light Novels')`;
			hidden++;
		}
	});
	console.log(JSON.stringify({ soshuhen: Object.keys(soshuhen).length, lightNovels: Object.keys(lightNovels).length, hidden, inserted }));
} finally {
	await sql.end({ timeout: 5 });
}
