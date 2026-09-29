/**
 * Crée la table PG-only `bot.db_databooks` : databooks & interviews (guides
 * officiels, artbooks, daizenshuu, interviews Toriyama…). Interface site calquée
 * sur la catégorie manga, triable par date de publication.
 *
 * Table PG-ONLY (comme `db_wiki_sections`) : absente de toute liste de sync
 * (`_wiki-editorial.ts` / forward) → jamais poussée en SQLite ni écrasée. Le site
 * est seul lecteur/écrivain. `id` en IDENTITY (inserts côté site).
 *
 * Lancer sur le VPS (PG local) :
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot bun scripts/add-databooks.ts
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS bot."db_databooks" (
				id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				kind         text    NOT NULL DEFAULT 'databook',
				title        text    NOT NULL,
				title_ja     text,
				author       text,
				published_at bigint,
				cover        text,
				description  text,
				source_url   text,
				visible      boolean NOT NULL DEFAULT true
			)
		`);
		// Lecture publique : filtre kind + tri par date.
		await sql.unsafe(`
			CREATE INDEX IF NOT EXISTS db_databooks_kind_date_idx
			ON bot."db_databooks" (kind, published_at)
		`);
		console.log("✓ bot.db_databooks (+ index kind/date)");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
