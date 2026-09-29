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

// Target databook IDs to complete
const TARGET_IDS = [
	290, 284, 282, 78, 113, 286, 138, 52, 288, 281, 132, 299, 1, 97, 80, 131, 112
];

async function main() {
	const sql = postgres(await databaseUrl(), { max: 1 });
	try {
		const pages = await sql`
			SELECT
				d.id AS "databookId",
				d.title AS "databookTitle",
				(p.value ->> 'page')::int AS "page",
				p.value ->> 'text' AS "text"
			FROM bot.db_databooks d
			CROSS JOIN LATERAL jsonb_array_elements(d.pages) WITH ORDINALITY AS p(value, ord)
			WHERE d.id = ANY(${TARGET_IDS})
				AND nullif(btrim(p.value ->> 'text'), '') IS NOT NULL
				AND nullif(btrim(p.value ->> 'text_fr'), '') IS NULL
			ORDER BY d.id, (p.value ->> 'page')::int;
		`;

		console.log(JSON.stringify(pages, null, 2));
	} finally {
		await sql.end();
	}
}

main().catch(console.error);
