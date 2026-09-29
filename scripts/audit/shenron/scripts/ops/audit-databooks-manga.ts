import postgres from "postgres";
import { readFileSync, existsSync } from "node:fs";

function getDbUrl(): string {
	if (process.env.DATABASE_URL?.trim()) {
		try {
			const u = new URL(process.env.DATABASE_URL.trim());
			u.hostname = "127.0.0.1";
			u.port = "15433";
			return u.toString();
		} catch {}
	}
	for (const path of ["apps/site/.env.local", "apps/bot/.env.local", "apps/site/.env", "apps/bot/.env", ".env"]) {
		if (existsSync(path)) {
			const txt = readFileSync(path, "utf-8");
			const m = txt.match(/^DATABASE_URL=([^\r\n]+)/m);
			if (m) {
				const u = new URL(m[1].trim().replace(/^["']|["']$/g, ""));
				u.hostname = "127.0.0.1";
				u.port = "15433";
				return u.toString();
			}
		}
	}
	throw new Error("DATABASE_URL introuvable.");
}

const sql = postgres(getDbUrl(), { max: 5 });

async function main() {
	console.log("=== 1. AUDIT DE BOT.DB_DATABOOKS ===");
	const databooksCount = await sql`SELECT count(*)::int AS total FROM bot.db_databooks`;
	const databooksWithTitleJa = await sql`
		SELECT count(*)::int AS count 
		FROM bot.db_databooks 
		WHERE title_ja IS NOT NULL AND TRIM(title_ja) != ''
	`;
	const databooksMissingTitleJa = await sql`
		SELECT id, kind, title, title_ja, category, published_at, author, isbn
		FROM bot.db_databooks 
		WHERE title_ja IS NULL OR TRIM(title_ja) = ''
		ORDER BY id ASC
	`;
	console.log(`Total databooks : ${databooksCount[0].total}`);
	console.log(`Avec title_ja   : ${databooksWithTitleJa[0].count}`);
	console.log(`Manquants       : ${databooksMissingTitleJa.length}`);

	console.log("\nListe des databooks sans title_ja :");
	for (const row of databooksMissingTitleJa) {
		console.log(`[ID ${row.id}] [${row.category || row.kind}] ${row.title} (date: ${row.published_at})`);
	}

	console.log("\n=== 2. AUDIT DE BOT.DB_MANGA_VOLUMES ===");
	const volumesCount = await sql`SELECT count(*)::int AS total FROM bot.db_manga_volumes`;
	console.log(`Total volumes : ${volumesCount[0].total}`);

	console.log("\n=== 3. AUDIT DE BOT.DB_MANGA_CHAPTERS ===");
	const chaptersCount = await sql`SELECT count(*)::int AS total FROM bot.db_manga_chapters`;
	const chaptersMissingVolume = await sql`
		SELECT id, series, chapter_number, title, title_ja, volume_id, published_at 
		FROM bot.db_manga_chapters 
		WHERE volume_id IS NULL
	`;
	const chaptersMissingPublishedAt = await sql`
		SELECT id, series, chapter_number, title, title_ja, volume_id, published_at 
		FROM bot.db_manga_chapters 
		WHERE published_at IS NULL
	`;
	console.log(`Total chapitres : ${chaptersCount[0].total}`);
	console.log(`Chapitres sans volume_id    : ${chaptersMissingVolume.length}`);
	for (const c of chaptersMissingVolume) {
		console.log(`  - ID ${c.id}: ${c.series} ch.${c.chapter_number} "${c.title}"`);
	}
	console.log(`Chapitres sans published_at : ${chaptersMissingPublishedAt.length}`);
	for (const c of chaptersMissingPublishedAt) {
		console.log(`  - ID ${c.id}: ${c.series} ch.${c.chapter_number} "${c.title}"`);
	}

	console.log("\n=== 4. AUDIT DE PUBLIC.WIKI_REVISIONS ===");
	const revisionsCount = await sql`SELECT count(*)::int AS total FROM public.wiki_revisions`;
	console.log(`Total révisions existantes : ${revisionsCount[0].total}`);

	await sql.end();
}

main().catch((err) => {
	console.error("Erreur:", err);
	process.exit(1);
});
