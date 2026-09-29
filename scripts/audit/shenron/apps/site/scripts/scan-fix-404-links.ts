import postgres from "postgres";
import {
	CHARACTER_CANONICAL_SLUGS,
	CHARACTER_SLUG_ALIASES,
	PLANET_CANONICAL_SLUGS,
	PLANET_SLUG_ALIASES,
	TRANSFORMATION_CANONICAL_SLUGS,
	TRANSFORMATION_SLUG_ALIASES,
} from "../src/lib/wiki-slugs";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sql = postgres(connectionString);

async function main() {
	console.log("=== SCAN DES LIENS 404 ET REFERENCES DANS LA DB ===");

	const tables = [
		{ name: "bot.db_characters", col: "article", idCol: "id", nameCol: "name" },
		{ name: "bot.db_characters", col: "description", idCol: "id", nameCol: "name" },
		{ name: "bot.db_planets", col: "article", idCol: "id", nameCol: "name" },
		{ name: "bot.db_planets", col: "description", idCol: "id", nameCol: "name" },
		{ name: "bot.db_techniques", col: "article", idCol: "id", nameCol: "name" },
		{ name: "bot.db_transformations", col: "article", idCol: "id", nameCol: "name" },
		{ name: "bot.db_sagas", col: "article", idCol: "id", nameCol: "name" },
		{ name: "bot.db_movies", col: "synopsis", idCol: "id", nameCol: "title" },
		{ name: "bot.db_movies", col: "synopsis_fr", idCol: "id", nameCol: "title" },
	];

	let totalLinksFixed = 0;

	for (const t of tables) {
		const rows = (await sql.unsafe(`
			SELECT ${t.idCol} AS id, ${t.nameCol} AS name, ${t.col} AS content
			FROM ${t.name}
			WHERE ${t.col} IS NOT NULL AND ${t.col} LIKE '%/wiki/%'
		`)) as unknown as Array<{ id: number; name: string; content: string }>;

		for (const row of rows) {
			let content = row.content;
			let changed = false;

			// Remplacement des anciens liens numériques vers les slugs canoniques
			for (const [idStr, canonicalSlug] of Object.entries(CHARACTER_CANONICAL_SLUGS)) {
				const regexNum = new RegExp(`/wiki/personnages/${idStr}(?![0-9])`, "g");
				if (regexNum.test(content)) {
					content = content.replace(regexNum, `/wiki/personnages/${canonicalSlug}`);
					changed = true;
				}
			}
			for (const [alias, canonicalSlug] of Object.entries(CHARACTER_SLUG_ALIASES)) {
				const regexAlias = new RegExp(`/wiki/personnages/${alias}(?![a-zA-Z0-9_-])`, "g");
				if (regexAlias.test(content)) {
					content = content.replace(regexAlias, `/wiki/personnages/${canonicalSlug}`);
					changed = true;
				}
			}

			// Cosmologie / Planetes
			for (const [idStr, canonicalSlug] of Object.entries(PLANET_CANONICAL_SLUGS)) {
				const regexNum = new RegExp(`/wiki/cosmologie/${idStr}(?![0-9])`, "g");
				const regexOldPlanet = new RegExp(`/wiki/planetes/${idStr}(?![0-9])`, "g");
				if (regexNum.test(content)) {
					content = content.replace(regexNum, `/wiki/cosmologie/${canonicalSlug}`);
					changed = true;
				}
				if (regexOldPlanet.test(content)) {
					content = content.replace(regexOldPlanet, `/wiki/cosmologie/${canonicalSlug}`);
					changed = true;
				}
			}
			for (const [alias, canonicalSlug] of Object.entries(PLANET_SLUG_ALIASES)) {
				const regexAlias = new RegExp(`/wiki/(?:cosmologie|planetes)/${alias}(?![a-zA-Z0-9_-])`, "g");
				if (regexAlias.test(content)) {
					content = content.replace(regexAlias, `/wiki/cosmologie/${canonicalSlug}`);
					changed = true;
				}
			}

			// Transformations
			for (const [idStr, canonicalSlug] of Object.entries(TRANSFORMATION_CANONICAL_SLUGS)) {
				const regexNum = new RegExp(`/wiki/transformations/${idStr}(?![0-9])`, "g");
				if (regexNum.test(content)) {
					content = content.replace(regexNum, `/wiki/transformations/${canonicalSlug}`);
					changed = true;
				}
			}
			for (const [alias, canonicalSlug] of Object.entries(TRANSFORMATION_SLUG_ALIASES)) {
				const regexAlias = new RegExp(`/wiki/transformations/${alias}(?![a-zA-Z0-9_-])`, "g");
				if (regexAlias.test(content)) {
					content = content.replace(regexAlias, `/wiki/transformations/${canonicalSlug}`);
					changed = true;
				}
			}

			// Remplacement des préfixes obsolètes
			const legacyReplacements: Array<[RegExp, string]> = [
				[/\/wiki\/dragon-ball\/character\//g, "/wiki/personnages/"],
				[/\/wiki\/dragon-ball\/planet\//g, "/wiki/cosmologie/"],
				[/\/wiki\/planetes\//g, "/wiki/cosmologie/"],
				[/\/wiki\/dragon-ball\/games\//g, "/wiki/jeux/"],
				[/\/wiki\/dragon-ball\/techniques\//g, "/wiki/techniques/"],
				[/\/wiki\/dragon-ball\/?$/g, "/wiki"],
			];
			for (const [pattern, rep] of legacyReplacements) {
				if (pattern.test(content)) {
					content = content.replace(pattern, rep);
					changed = true;
				}
			}

			if (changed) {
				totalLinksFixed++;
				await sql.unsafe(`
					UPDATE ${t.name}
					SET ${t.col} = '${content.replaceAll("'", "''")}'
					WHERE ${t.idCol} = ${row.id}
				`);
				console.log(`[FIX 404] ${t.name} ID ${row.id} (${row.name}) -> liens mis a jour`);
			}
		}
	}

	console.log(`=== SCAN TERMINE : ${totalLinksFixed} enregistrements mis a jour ===`);
	await sql.end();
}

main().catch((err) => {
	console.error("Erreur scan:", err);
	process.exit(1);
});
