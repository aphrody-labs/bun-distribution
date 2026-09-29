import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envPath = join(import.meta.dir, "..", ".env");
	const content = await readFile(envPath, "utf8").catch(() => "");
	const found = content
		.split(/\r?\n/)
		.findLast((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (!found) throw new Error("DATABASE_URL is required.");
	return found;
}

async function main() {
	const sql = postgres(await databaseUrl(), { max: 1 });
	try {
		const [stats] = await sql`
			SELECT
				count(DISTINCT d.id)::int AS total_databooks,
				count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL)::int AS transcribed_databook_pages,
				count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL)::int AS translated_databook_pages
			FROM bot.db_databooks d
			CROSS JOIN LATERAL jsonb_array_elements(d.pages) p
		`;

		const [completeBooks] = await sql`
			SELECT count(*)::int AS complete_books FROM (
				SELECT d.id
				FROM bot.db_databooks d
				CROSS JOIN LATERAL jsonb_array_elements(d.pages) p
				GROUP BY d.id
				HAVING count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL) > 0
				   AND count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL) = count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL)
			) sub
		`;

		const [mangaStats] = await sql`
			SELECT
				count(*)::int AS total_manga_pages,
				count(*) FILTER (WHERE nullif(btrim(text), '') IS NOT NULL)::int AS manga_with_text
			FROM bot.db_manga_pages
		`;

		console.log("=== STATISTIQUES GLOBALES SOUVERAINES ===");
		console.log(`Databooks officiels référencés   : ${stats.total_databooks}`);
		console.log(`Databooks complétés à 100% (FR)  : ${completeBooks.complete_books} ouvrages`);
		console.log(`Planches databooks transcrites   : ${stats.transcribed_databook_pages.toLocaleString("fr-FR")}`);
		console.log(`Planches databooks traduites FR  : ${stats.translated_databook_pages.toLocaleString("fr-FR")}`);
		console.log(`Planches manga enregistrées      : ${mangaStats.total_manga_pages.toLocaleString("fr-FR")}`);
		console.log(`Planches manga avec texte édité  : ${mangaStats.manga_with_text.toLocaleString("fr-FR")}`);
	} finally {
		await sql.end();
	}
}

main().catch(console.error);
