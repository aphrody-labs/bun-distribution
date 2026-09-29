#!/usr/bin/env bun
import postgres from "postgres";
import { getDbUrl, idRevision } from "./wiki-databooks-indexer";

type Target = {
	table: "db_characters" | "db_planets" | "db_races" | "db_sagas" | "db_techniques";
	label: string;
};

type Row = { id: number; name: string; description: string; article: string | null };
type TransformationRow = { id: number; name: string; ki: string | null; characterName: string; article: string | null };

const targets: Target[] = [
	{ table: "db_characters", label: "Personnage" },
	{ table: "db_planets", label: "Planète" },
	{ table: "db_races", label: "Race" },
	{ table: "db_sagas", label: "Saga" },
	{ table: "db_techniques", label: "Technique" },
];
const apply = process.argv.includes("--apply");
const sql = postgres(getDbUrl(), { prepare: false, max: 4 });

function articleFromDescription(description: string): string {
	return `## Aperçu\n\n${description.trim()}`;
}

try {
	let candidates = 0;
	let updated = 0;
	for (const target of targets) {
		const rows = await sql.unsafe<Row[]>(
			`SELECT id, name, description, article FROM bot.${target.table}
			 WHERE visible = true
			   AND nullif(trim(coalesce(article, '')), '') IS NULL
			   AND nullif(trim(coalesce(description, '')), '') IS NOT NULL
			 ORDER BY id`,
		);
		candidates += rows.length;
		for (const row of rows) {
			const article = articleFromDescription(row.description);
			if (!apply) continue;
			await sql.begin(async (tx) => {
				await tx.unsafe(
					`UPDATE bot.${target.table}
					 SET article = $1, article_updated_at = extract(epoch from now())::bigint
					 WHERE id = $2 AND nullif(trim(coalesce(article, '')), '') IS NULL`,
					[article, row.id],
				);
				await tx`
					INSERT INTO public.wiki_revisions
						(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
					VALUES
						(${idRevision()}, ${target.table}, ${row.id}, 'fill_empty',
						 ${`${target.label} article materialized from its existing description: ${row.name}`},
						 ${JSON.stringify({ article: row.article })}, ${JSON.stringify({ article })},
						 'shenron:article-fallback', 'Wiki article fallback', NOW())
				`;
			});
			updated++;
		}
		console.log(JSON.stringify({ table: target.table, candidates: rows.length, updated: apply ? rows.length : 0 }));
	}
	const transformations = await sql<TransformationRow[]>`
		SELECT t.id, t.name, t.ki, c.name AS "characterName", t.article
		FROM bot.db_transformations t
		JOIN bot.db_characters c ON c.id = t.character_id
		WHERE t.visible = true AND nullif(trim(coalesce(t.article, '')), '') IS NULL
		ORDER BY t.id
	`;
	candidates += transformations.length;
	for (const row of transformations) {
		const article = [
			"## Aperçu",
			"",
			`**${row.name}** est un état associé à **${row.characterName}** dans l'index du wiki.`,
			row.ki ? `Indication de puissance enregistrée : \`${row.ki}\`.` : "",
		]
			.filter(Boolean)
			.join("\n\n");
		if (!apply) continue;
		await sql.begin(async (tx) => {
			await tx`
				UPDATE bot.db_transformations
				SET article = ${article}, article_updated_at = extract(epoch from now())::bigint
				WHERE id = ${row.id} AND nullif(trim(coalesce(article, '')), '') IS NULL
			`;
			await tx`
				INSERT INTO public.wiki_revisions
					(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
				VALUES
					(${idRevision()}, 'db_transformations', ${row.id}, 'fill_empty',
					 ${`Transformation article materialized from indexed fields: ${row.name}`},
					 ${JSON.stringify({ article: row.article })}, ${JSON.stringify({ article })},
					 'shenron:article-fallback', 'Wiki article fallback', NOW())
			`;
		});
		updated++;
	}
	console.log(JSON.stringify({ table: "db_transformations", candidates: transformations.length, updated: apply ? transformations.length : 0 }));
	console.log(JSON.stringify({ apply, candidates, updated }));
} finally {
	await sql.end();
}
