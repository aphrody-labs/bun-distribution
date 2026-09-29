import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const rows: Record<number, { article: string; sources: unknown[]; volumes: string }> = {
	1: {
		article: "Le 21e Tenkaichi Budōkai est le premier championnat mondial montré dans le manga. Son Gokū et Krilin y affrontent notamment Jackie Chun, l'identité adoptée par Kamé Sennin ; Jackie Chun remporte la finale contre Gokū.",
		sources: [{ n: 1, url: "/wiki/manga/volume/84", kind: "manga_volume", label: "Manga Dragon Ball — Tome 3, début du 21e Tenkaichi Budōkai" }, { n: 2, url: "/wiki/manga/volume/86", kind: "manga_volume", label: "Manga Dragon Ball — Tome 5, finale du 21e Tenkaichi Budōkai" }],
		volumes: "84,86",
	},
	2: {
		article: "Le 22e Tenkaichi Budōkai oppose les artistes martiaux de l'école de la Tortue à Tenshinhan, Chaozu et leurs compagnons de la Grue. Tenshinhan bat Son Gokū en finale après un combat remporté d'une fraction de seconde.",
		sources: [{ n: 1, url: "/wiki/manga/volume/90", kind: "manga_volume", label: "Manga Dragon Ball — Tome 9, 22e Tenkaichi Budōkai" }, { n: 2, url: "/wiki/manga/volume/92", kind: "manga_volume", label: "Manga Dragon Ball — Tome 11, finale du 22e Tenkaichi Budōkai" }],
		volumes: "90,92",
	},
	3: {
		article: "Le 23e Tenkaichi Budōkai se déroule trois ans après la défaite de Piccolo Daimaō. Son Gokū remporte la finale contre Ma Junior, la réincarnation de Piccolo, puis quitte l'arène avec Chi-Chi.",
		sources: [{ n: 1, url: "/wiki/manga/volume/95", kind: "manga_volume", label: "Manga Dragon Ball — Tome 14, ouverture du 23e Tenkaichi Budōkai" }, { n: 2, url: "/wiki/manga/volume/97", kind: "manga_volume", label: "Manga Dragon Ball — Tome 16, finale du 23e Tenkaichi Budōkai" }],
		volumes: "95,97",
	},
	4: {
		article: "Le Cell Game est le tournoi imposé par Cell après la construction de son arène. Son Gohan atteint le Super Saiyan 2 et vainc Cell au terme du Kaméhaméha père-fils.",
		sources: [{ n: 1, url: "/wiki/manga/volume/109", kind: "manga_volume", label: "Manga Dragon Ball — Tome 28, annonce du Cell Game" }, { n: 2, url: "/wiki/manga/volume/113", kind: "manga_volume", label: "Manga Dragon Ball — Tome 32, dénouement du Cell Game" }],
		volumes: "109,113",
	},
	5: {
		article: "Le 25e Tenkaichi Budōkai introduit une division junior et voit le retour de Son Gokū pour une seule journée. Le tournoi adulte est interrompu par la fuite de l'énergie de Gohan vers Babidi ; C-18 obtient finalement un arrangement avec Mr. Satan.",
		sources: [{ n: 1, url: "/wiki/manga/volume/114", kind: "manga_volume", label: "Manga Dragon Ball — Tome 33, début du 25e Tenkaichi Budōkai" }, { n: 2, url: "/wiki/manga/volume/116", kind: "manga_volume", label: "Manga Dragon Ball — Tome 35, interruption du tournoi" }],
		volumes: "114,116",
	},
	6: {
		article: "Le Tournoi du Pouvoir réunit les guerriers de huit univers dans le Monde du Vide. Les éliminations se font par sortie de l'arène ; l'Univers 7 survit jusqu'à la fin et C-17 formule le vœu de restaurer les univers effacés.",
		sources: [{ n: 1, url: "/wiki/manga/volume/132", kind: "manga_volume", label: "Dragon Ball Super — Tome 9, Tournoi du Pouvoir" }, { n: 2, url: "/wiki/manga/volume/133", kind: "manga_volume", label: "Dragon Ball Super — Tome 10, conclusion du Tournoi du Pouvoir" }],
		volumes: "132,133",
	},
};

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	for (const [id, data] of Object.entries(rows)) {
		await sql.begin(async (tx) => {
			const old = (await tx`select * from bot.db_tournaments where id=${id} for update`)[0];
			if (!old) return;
			const after = { ...old, article: data.article, article_sources: JSON.stringify(data.sources), participants_count: null, notable_matches: null, visible: true };
			await tx.unsafe('update bot.db_tournaments set article=$1,"article_sources"=$2,participants_count=null,notable_matches=null,visible=true,article_updated_at=$3 where id=$4', [data.article, JSON.stringify(data.sources), Date.now(), id]);
			await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), "db_tournaments", id, "update", `${old.name} — restauration sourcée manga`, JSON.stringify(old), JSON.stringify(after), "shenron-manga-evidence", "Shenron — restauration canonique manga"]);
		});
	}
	console.log(`tournois restaurés : ${Object.keys(rows).length}`);
} finally {
	await sql.end({ timeout: 5 });
}
