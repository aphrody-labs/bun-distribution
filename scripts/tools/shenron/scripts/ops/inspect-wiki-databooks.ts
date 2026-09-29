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
	console.log("=== INSPECTION DES RELATIONS WIKI <-> DATABOOKS ===");

	// Structure de bot.db_databooks
	const databookCols = await sql`
		SELECT column_name, data_type 
		FROM information_schema.columns 
		WHERE table_schema = 'bot' AND table_name = 'db_databooks'
		ORDER BY ordinal_position;
	`;
	console.log("\nColonnes bot.db_databooks :");
	for (const c of databookCols) console.log(`  - ${c.column_name} (${c.data_type})`);

	// Structure des tables wiki et leurs colonnes textuelles / sources / databooks
	const wikiTables = [
		"db_characters",
		"db_techniques",
		"db_planets",
		"db_races",
		"db_transformations",
		"db_sagas"
	];

	for (const t of wikiTables) {
		const cols = await sql`
			SELECT column_name, data_type 
			FROM information_schema.columns 
			WHERE table_schema = 'bot' AND table_name = ${t}
			ORDER BY ordinal_position;
		`;
		console.log(`\nColonnes bot.${t} :`);
		console.log(cols.map((c) => c.column_name).join(", "));
	}

	// Existe-t-il des tables de liaison ou de citations ?
	const relationTables = await sql`
		SELECT table_schema, table_name 
		FROM information_schema.tables 
		WHERE table_schema IN ('bot', 'public')
		  AND (table_name LIKE '%databook%' OR table_name LIKE '%reference%' OR table_name LIKE '%citation%' OR table_name LIKE '%source%')
		ORDER BY table_schema, table_name;
	`;
	console.log("\nTables liées aux sources/databooks/references :");
	for (const r of relationTables) console.log(`  - ${r.table_schema}.${r.table_name}`);

	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
