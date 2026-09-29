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
		const books = await sql`
			SELECT id, title,
				jsonb_array_length(pages) AS total_pages,
				count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL) AS transcribed_pages,
				count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL) AS translated_pages
			FROM bot.db_databooks
			CROSS JOIN LATERAL jsonb_array_elements(pages) p
			GROUP BY id, title, pages
			HAVING count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL) > count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL)
			ORDER BY (count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL) - count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL)) ASC
			LIMIT 30;
		`;

		console.log("=== LIVRES AVEC LE MOINS DE PLANCHES RESTANTES ===");
		for (const b of books) {
			const remaining = Number(b.transcribed_pages) - Number(b.translated_pages);
			console.log(
				`#${String(b.id).padEnd(4)} (${String(remaining).padStart(2)} restantes / ${String(b.transcribed_pages).padStart(3)} transcrites) : ${b.title}`
			);
		}
	} finally {
		await sql.end();
	}
}

main().catch(console.error);
