import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text();
	const line = env.split("\n").find((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

/** Databook IDs whose exact anime-comic content already exists in Manga. */
const targets: Record<string, number> = {
	"32": 417,
	"33": 416,
	"48": 420,
	"312": 418,
	"443": 404,
	"444": 405,
	"445": 406,
	"446": 407,
	"447": 408,
	"448": 409,
	"449": 410,
	"450": 411,
	"451": 412,
	"452": 413,
	"453": 414,
	"454": 415,
	"455": 416,
	"456": 417,
};

const sql = postgres(await databaseUrl(), { max: 1 });
let changed = 0;
try {
	for (const [databookId, mangaId] of Object.entries(targets)) {
		const [row] = await sql.unsafe("select id,title,visible from bot.db_databooks where id=$1", [databookId]);
		if (!row || row.visible === false) continue;
		const [manga] = await sql.unsafe("select id,title from bot.db_manga_volumes where id=$1 and visible is distinct from false", [String(mangaId)]);
		if (!manga) throw new Error(`Volume manga cible absente: ${mangaId}`);
		await sql.begin(async (tx) => {
			await tx`update bot.db_databooks set visible=false where id=${databookId} and visible is distinct from false`;
			await tx`insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values (${crypto.randomUUID()},'db_databooks',${databookId},'update',${`Migration Anime Comics vers Manga — volume ${mangaId}`},${tx.json({ visible: true, title: row.title } as Parameters<typeof tx.json>[0])},${tx.json({ visible: false, migratedTo: `/wiki/manga/volume/${mangaId}`, title: row.title, mangaTitle: manga.title } as Parameters<typeof tx.json>[0])},'shenron-manga-migration','Shenron — migration Anime Comics')`;
		});
		changed++;
	}
	console.log(JSON.stringify({ changed, targets: Object.keys(targets).length }));
} finally {
	await sql.end({ timeout: 5 });
}
