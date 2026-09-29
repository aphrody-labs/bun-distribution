#!/usr/bin/env bun
/**
 * audit-wiki-couverture.ts — Audit complet champ par champ et médias
 * sur l'ensemble des tables éditoriales du wiki (Goal #20).
 *
 * Usage :
 *   bun apps/site/scripts/audit-wiki-couverture.ts
 *   bun apps/site/scripts/audit-wiki-couverture.ts --json
 */
import { join } from "node:path";
import postgres from "postgres";
import { nonEmptySql } from "../src/lib/wiki-coverage";

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const readValue = async (path: string, key: string) => {
		const text = await Bun.file(path)
			.text()
			.catch(() => "");
		return text
			.split("\n")
			.filter((line) => line.startsWith(`${key}=`))
			.at(-1)
			?.slice(key.length + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
	};
	// La réplique distante est la source éditoriale. `apps/site/.env` peut
	// délibérément viser un PostgreSQL local, souvent absent sur les machines
	// d'audit ; la préférer produisait un faux audit en échec d'authentification.
	const remote = await readValue(
		join(import.meta.dir, "..", "..", "..", ".env.remote-db"),
		"REMOTE_DATABASE_URL"
	);
	if (remote) return remote;
	const site = await readValue(join(import.meta.dir, "..", ".env"), "DATABASE_URL");
	if (site) return site;
	throw new Error("DATABASE_URL introuvable.");
}

const TABLES = [
	{ name: "db_characters", label: "Personnages" },
	{ name: "db_planets", label: "Planètes" },
	{ name: "db_races", label: "Races" },
	{ name: "db_sagas", label: "Sagas" },
	{ name: "db_techniques", label: "Techniques" },
	{ name: "db_transformations", label: "Transformations" },
	{ name: "db_episodes", label: "Épisodes" },
	{ name: "db_movies", label: "Films" },
	{ name: "db_games", label: "Jeux" },
	{ name: "db_databooks", label: "Databooks" },
	{ name: "db_manga_volumes", label: "Tomes Manga" },
	{ name: "db_manga_chapters", label: "Chapitres Manga" },
];

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const jsonArg = process.argv.find((arg) => arg.startsWith("--json="));
const jsonPath = jsonArg?.slice("--json=".length);

try {
	console.log("===============================================================================");
	console.log("AUDIT DE COUVERTURE ÉDITORIALE & MÉDIAS DU WIKI (SHENRON)");
	console.log("===============================================================================\n");

	const resultats: Record<string, unknown> = {};
	const generatedAt = new Date().toISOString();

	for (const { name, label } of TABLES) {
		const cols = await sql<{ column_name: string; data_type: string }[]>`
			SELECT column_name, data_type 
			FROM information_schema.columns 
			WHERE table_schema = 'bot' AND table_name = ${name}
			ORDER BY ordinal_position
		`;
		// La base de production peut être une réplique partielle : l'absence d'une
		// table est elle-même un résultat d'audit, pas une raison d'abandonner les
		// autres familles de fiches.
		if (cols.length === 0) {
			console.log(`▶ ${label} (bot.${name}) — table absente de cette réplique\n`);
			resultats[name] = { total: 0, state: "missing_table", colonnes: {} };
			continue;
		}
		const hasVisible = cols.some((c) => c.column_name === "visible");
		const countRes = await sql.unsafe(
			// Les répliques historiques n'ont pas toutes la colonne de suppression
			// logique. L'audit est alors exhaustif plutôt que de planter avant de
			// signaler les fiches incomplètes ; les schémas qui l'ont gardée restent
			// filtrés sur les seules entrées publiées.
			`SELECT COUNT(*) as cnt FROM bot.${name}${hasVisible ? " WHERE visible = true" : ""}`
		);
		const count = Number(countRes[0].cnt);

		console.log(
			`▶ ${label} (bot.${name}) — ${count} entrées${hasVisible ? " visibles" : " (réplique sans filtre visible)"}`
		);

		const colReport: Record<string, { filled: number; total: number; pct: number }> = {};

		for (const c of cols) {
			const colName = c.column_name;
			const predicate = nonEmptySql(colName, c.data_type);
			const filledRes = await sql.unsafe(
				`SELECT COUNT(*) as cnt FROM bot.${name}${hasVisible ? " WHERE visible = true AND" : " WHERE"} ${predicate}`
			);
			const filled = Number(filledRes[0].cnt);
			const pct = count > 0 ? Number(((filled / count) * 100).toFixed(1)) : 100;
			colReport[colName] = { filled, total: count, pct };

			// Affiche les colonnes clés
			const isKey = [
				"name",
				"title",
				"title_ja",
				"name_ja",
				"image",
				"poster",
				"cover",
				"description",
				"synopsis",
				"synopsis_fr",
				"article",
				"article_sources",
				"subtitles",
				"players",
				"stream_url",
				"frames",
			].includes(colName);

			if (isKey || pct < 100) {
				const bar = pct === 100 ? "✓" : pct >= 70 ? "●" : pct > 0 ? "◐" : "○";
				console.log(
					`  ${bar} ${colName.padEnd(24)} : ${String(filled).padStart(5)} / ${String(count).padStart(5)} (${String(pct).padStart(5)}%)`
				);
			}
		}
		console.log("");
		resultats[name] = {
			total: count,
			visibilityFilter: hasVisible,
			colonnes: colReport,
		};
	}

	const report = {
		schema: "shenron-wiki-coverage/v1",
		generatedAt,
		database: "shenron_site",
		tables: resultats,
	};
	if (process.argv.includes("--json")) {
		console.log(JSON.stringify(report, null, 2));
	}
	if (jsonPath) {
		await Bun.write(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`Rapport JSON écrit : ${jsonPath}`);
	}
} finally {
	await sql.end();
}
