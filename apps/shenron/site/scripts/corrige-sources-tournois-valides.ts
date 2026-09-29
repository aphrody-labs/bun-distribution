import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const replacements: Record<number, unknown[]> = {
	7: [{ n: 1, url: "/wiki/manga/volume/90", kind: "manga_volume", label: "Manga Dragon Ball — Tome 9, chapitres 98-108" }],
	8: [{ n: 1, url: "/wiki/manga/volume/123", kind: "manga_volume", label: "Manga Dragon Ball — Tome 42, chapitres 518-519" }],
	9: [{ n: 1, url: "/wiki/manga/volume/124", kind: "manga_volume", label: "Dragon Ball Super — Tome 1, début du tournoi Univers 6 contre Univers 7" }, { n: 2, url: "/wiki/manga/volume/125", kind: "manga_volume", label: "Dragon Ball Super — Tome 2, conclusion du tournoi Univers 6 contre Univers 7" }],
	10: [{ n: 1, url: "/wiki/manga/volume/127", kind: "manga_volume", label: "Dragon Ball Super — Tome 4, chapitres 28-29" }],
};

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	for (const [id, sources] of Object.entries(replacements)) {
		await sql.begin(async (tx) => {
			const old = (await tx`select * from bot.db_tournaments where id=${id} for update`)[0];
			if (!old) return;
			const after = { ...old, article_sources: JSON.stringify(sources) };
			await tx.unsafe('update bot.db_tournaments set "article_sources"=$1,article_updated_at=$2 where id=$3', [JSON.stringify(sources), Date.now(), id]);
			await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), "db_tournaments", id, "update", `${old.name} — correction des liens de sources manga`, JSON.stringify(old), JSON.stringify(after), "shenron-source-integrity", "Shenron — intégrité des sources canon"]);
		});
	}
	console.log("sources de tournois normalisées : 4");
} finally {
	await sql.end({ timeout: 5 });
}
