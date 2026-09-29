// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

async function main() {
	console.log("=== AUDIT DE COUVERTURE DES DATABOOKS DANS LE WIKI ===");

	const categories = [
		{ name: "Personnages", table: "db_characters" },
		{ name: "Techniques", table: "db_techniques" },
		{ name: "Planètes & Lieux", table: "db_planets" },
		{ name: "Races", table: "db_races" },
		{ name: "Transformations", table: "db_transformations" },
		{ name: "Sagas", table: "db_sagas" },
	];

	for (const cat of categories) {
		const res = await sql.unsafe(`
			SELECT count(*) as total,
			       count(*) filter (where coalesce(CASE WHEN jsonb_typeof(article_sources) = 'array' THEN jsonb_array_length(article_sources) END, 0) > 0) as with_sources,
			       count(*) filter (where article_sources::text ILIKE '%databook%') as with_databooks
			FROM bot.${cat.table};
		`);

		const revs = await sql`
			SELECT count(*) as rev_count
			FROM public.wiki_revisions
			WHERE "tableName" = ${cat.table};
		`;

		console.log(`\n📂 ${cat.name} (bot.${cat.table}) :`);
		console.log(`   - Total entités : ${res[0].total}`);
		console.log(`   - Avec sources : ${res[0].with_sources}`);
		console.log(`   - Citant des Databooks : ${res[0].with_databooks}`);
		console.log(`   - Révisions totales : ${revs[0].rev_count}`);
	}

	// Échantillon de révisions récentes
	const sampleRevs = await sql`
		SELECT "tableName", "rowId", label, "editorName", "createdAt"
		FROM public.wiki_revisions
		ORDER BY id DESC
		LIMIT 8;
	`;
	console.log("\n📜 Dernières révisions dans wiki_revisions :");
	for (const r of sampleRevs) {
		console.log(`  - [${r.tableName} #${r.rowId}] ${r.label ?? "Sans label"} par ${r.editorName} (${new Date(r.createdAt).toLocaleTimeString()})`);
	}

	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
