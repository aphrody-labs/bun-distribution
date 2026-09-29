import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const data: Record<number, { article: string; sources: unknown[]; image?: string }> = {
	1: { article: "Le Dragon Radar est l'appareil conçu par Bulma pour repérer les Dragon Balls. Il permet au groupe de suivre les sphères pendant la quête qui commence au premier chapitre.", sources: [{ n: 1, url: "/wiki/manga/volume/82", kind: "manga_volume", label: "Manga Dragon Ball — Tome 1, chapitre 1" }] },
	2: { article: "Les capsules Hoi-Poi sont la technologie de Capsule Corporation qui permet de transporter sous un faible volume des objets et des véhicules. Bulma en emporte dès sa rencontre avec Son Gokū.", sources: [{ n: 1, url: "/wiki/manga/volume/82", kind: "manga_volume", label: "Manga Dragon Ball — Tome 1, chapitres 1-2" }] },
	3: { article: "Le haricot magique, ou senzu, est cultivé par Karin. Un haricot permet à un combattant blessé de récupérer rapidement ses forces ; Gokū en reçoit après son ascension de la tour.", sources: [{ n: 1, url: "/wiki/manga/volume/88", kind: "manga_volume", label: "Manga Dragon Ball — Tome 7, chapitres 85-90" }] },
	4: { article: "Le Nyoï-bō est le bâton extensible de Son Gokū. Il sert notamment de lien entre la Tour Karin et le Sanctuaire de Dieu, conformément à l'histoire racontée dans le manga.", sources: [{ n: 1, url: "/wiki/manga/volume/93", kind: "manga_volume", label: "Manga Dragon Ball — Tome 12, chapitres 161-163" }] },
	5: { article: "Kinto-Un est le nuage magique offert à Son Gokū par Kamé Sennin. Seule une personne au cœur suffisamment pur peut y prendre place.", sources: [{ n: 1, url: "/wiki/manga/volume/82", kind: "manga_volume", label: "Manga Dragon Ball — Tome 1, chapitres 3-4" }], image: "/dbz/kinto-un.svg" },
};

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	for (const [id, item] of Object.entries(data)) {
		await sql.begin(async (tx) => {
			const old = (await tx`select * from bot.db_items where id=${id} for update`)[0];
			if (!old) return;
			const after = { ...old, article: item.article, article_sources: JSON.stringify(item.sources), image: item.image ?? old.image, visible: true };
			await tx.unsafe('update bot.db_items set article=$1,"article_sources"=$2,image=coalesce($3,image),visible=true,"article_updated_at"=$4 where id=$5', [item.article, JSON.stringify(item.sources), item.image ?? null, Date.now(), id]);
			await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), "db_items", id, "update", `${old.name} — restauration sourcée manga`, JSON.stringify(old), JSON.stringify(after), "shenron-manga-evidence", "Shenron — restauration canonique manga"]);
		});
	}
	console.log(`objets restaurés : ${Object.keys(data).length}`);
} finally {
	await sql.end({ timeout: 5 });
}
