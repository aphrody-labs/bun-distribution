import postgres from "postgres";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text();
	const line = env.split("\n").find((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const article = `**La Planète de Maître Kaïô** (界王星, *Kaiō-sei*) est une petite planète de l'Autre Monde située au bout de la route du Serpent. Elle sert de lieu d'entraînement à Son Goku après sa mort face à Raditz : Goku y apprend auprès de Maître Kaïô le Kaïô-ken et le Genki-dama avant de revenir affronter les Saïyens. [1]

Après l'affrontement contre Cell, Goku se téléporte sur cette planète avec Cell au moment de l'explosion, ce qui entraîne la mort de Maître Kaïô et la destruction de l'astre. [2]`;

const sources = [
	{ n: 1, url: "/wiki/manga/volume/99", kind: "source", label: "Dragon Ball — Tome 18" },
	{ n: 2, url: "/wiki/manga/volume/108", kind: "source", label: "Dragon Ball — Tome 27" },
];

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	const [row] = await sql.unsafe("select id,article,article_sources from bot.db_planets where id=33 and visible is distinct from false");
	if (!row) throw new Error("Planète de Maître Kaïô introuvable");
	await sql.begin(async (tx) => {
		await tx`update bot.db_planets set article=${article}, article_sources=${tx.json(sources as Parameters<typeof tx.json>[0])}, article_updated_at=${Date.now()} where id=33 and visible is distinct from false`;
		await tx.unsafe(
			'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
			[
				crypto.randomUUID(),
				"db_planets",
				"33",
				"update",
				"Correction canonique de la Planète de Maître Kaïô",
				JSON.stringify({ article: row.article, article_sources: row.article_sources }),
				JSON.stringify({ article, article_sources: sources }),
				"shenron-canon-cleanup",
				"Shenron — nettoyage canonique",
			],
		);
	});
	console.log(JSON.stringify({ updated: 1, id: 33 }));
} finally {
	await sql.end({ timeout: 5 });
}
