import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = existsSync(join(import.meta.dir, "..", "..", "..", "..", "apps", "shenron"))
	? join(import.meta.dir, "..", "..", "..", "..")
	: join(import.meta.dir, "..", "..", "..");
const migrations = [
	"apps/shenron/site/src/db/migrations/0018_media_works_and_editions.sql",
	"apps/shenron/bot/src/db/migrations/0018_refonte_media_works_editions.sql",
	"apps/shenron/site/src/db/migrations/0019_narrative_graph_and_contributors.sql",
	"apps/shenron/bot/src/db/migrations/0019_refonte_narrative_contributors.sql",
];
const publicationMigration = "apps/shenron/site/src/db/migrations/0017_wiki_media_publications.sql";

describe("migrations idempotentes de la refonte", () => {
	for (const relative of migrations) {
		test(`${relative} crée tables/index sans suppression physique`, async () => {
			const sql = await Bun.file(join(root, relative)).text();
			expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
			expect(sql).toMatch(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/i);
			expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
		});
	}
});

describe("migration de publications et redirections", () => {
	test("masque logiquement les anciennes catégories et conserve les redirections 301", async () => {
		const rawSql = await Bun.file(join(root, publicationMigration)).text();
		const sql = rawSql.replace(/\r\n/g, "\n");
		expect(sql).toContain("UPDATE bot.db_databooks SET visible = false");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.url_redirects");
		expect(sql).toContain("status_code, visible");
		expect(sql).toContain(",\n\t301,\n\ttrue");
		expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
	});
});
