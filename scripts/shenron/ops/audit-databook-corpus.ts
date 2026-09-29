import postgres from "postgres";
import { readFileSync, existsSync } from "node:fs";

function getDbUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	for (const path of ["apps/site/.env", "apps/bot/.env", ".env"]) {
		if (existsSync(path)) {
			const txt = readFileSync(path, "utf-8");
			const m = txt.match(/^DATABASE_URL=([^\n]+)/m);
			if (m) return m[1].trim().replace(/^["']|["']$/g, "");
		}
	}
	throw new Error("DATABASE_URL non configuré.");
}

const sql = postgres(getDbUrl());

async function main() {
	console.log("=== AUDIT DÉTAILLÉ DU CORPUS DATABOOKS TRANSCRIT ===");

	const books = await sql`
		SELECT id, title, title_ja, category, kind,
		       jsonb_array_length(pages) as total_pages,
		       (SELECT count(*) FROM jsonb_array_elements(pages) AS p(elem) WHERE p.elem->>'text' IS NOT NULL AND length(trim(p.elem->>'text')) > 0) as ja_pages,
		       (SELECT count(*) FROM jsonb_array_elements(pages) AS p(elem) WHERE p.elem->>'text_fr' IS NOT NULL AND length(trim(p.elem->>'text_fr')) > 0) as fr_pages
		FROM bot.db_databooks
		WHERE pages IS NOT NULL AND jsonb_array_length(pages) > 0
		ORDER BY total_pages DESC
		LIMIT 25;
	`;

	console.log(`\nTop 25 Databooks transcrits :`);
	for (const b of books) {
		console.log(`- [#${b.id}] "${b.title}" (${b.title_ja ?? "—"})`);
		console.log(`    Catégorie: ${b.category ?? b.kind} | Total: ${b.total_pages} | JA: ${b.ja_pages} | FR: ${b.fr_pages}`);
	}

	// Regardons les Daizenshuu et guides officiels majeurs spécifiquement
	const keyGuides = await sql`
		SELECT id, title, title_ja, jsonb_array_length(pages) as total_pages
		FROM bot.db_databooks
		WHERE title ILIKE '%daizenshuu%' OR title ILIKE '%chōzenshū%' OR title ILIKE '%chozenshu%' 
		   OR title ILIKE '%exciting%' OR title ILIKE '%landmark%' OR title ILIKE '%forever%'
		ORDER BY id;
	`;
	console.log(`\nGuides de Référence Majeurs (Daizenshuu, Chozenshu, SEG, Landmark/Forever) :`);
	for (const g of keyGuides) {
		console.log(`  - ID #${g.id}: ${g.title} (${g.total_pages} pages)`);
	}

	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
