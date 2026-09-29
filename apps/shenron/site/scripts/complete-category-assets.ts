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
const editorId = "shenron-category-assets";
const editorName = "Shenron — complétion des assets wiki";

const dragonImages: Record<string, string> = {
	shenron: "./assets/wiki/characters/Shenron.webp",
	polunga: "./assets/wiki/characters/Polunga.webp",
	"super-shenron": "./assets/wiki/characters/Super_Shenron.webp",
	toronbo: "./assets/wiki/characters/Toronbo.webp",
};

try {
	await sql.begin(async (tx) => {
		for (const [slug, image] of Object.entries(dragonImages)) {
			const rows = await tx`select id,image from bot.db_dragons where slug=${slug} and visible is distinct from false for update`;
			for (const row of rows) {
				if (row.image === image) continue;
				await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), "db_dragons", String(row.id), "update", `Asset canonique du dragon ${slug}`, JSON.stringify({ image: row.image }), JSON.stringify({ image }), editorId, editorName]);
				await tx`update bot.db_dragons set image=${image} where id=${row.id}`;
			}
		}
		const rows = await tx`select id,image from bot.db_techniques where id=831 and visible is distinct from false for update`;
		for (const row of rows) {
			const image = "/dbz/characters/master-roshi.webp";
			if (row.image === image) continue;
			await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), "db_techniques", "831", "update", "Asset canonique pour Mafūba", JSON.stringify({ image: row.image }), JSON.stringify({ image }), editorId, editorName]);
			await tx`update bot.db_techniques set image=${image} where id=831`;
		}
	});
	console.log(JSON.stringify({ dragons: Object.keys(dragonImages).length, technique: 831 }));
} finally {
	await sql.end({ timeout: 5 });
}
