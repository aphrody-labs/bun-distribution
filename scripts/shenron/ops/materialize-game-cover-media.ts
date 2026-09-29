#!/usr/bin/env bun
import postgres from "postgres";
import { getDbUrl, idRevision } from "./wiki-databooks-indexer";

const apply = process.argv.includes("--apply");
const sql = postgres(getDbUrl(), { prepare: false, max: 2 });

try {
	const rows = await sql<{ id: number; title: string; cover: string; media: unknown }[]>`
		SELECT id, title, cover, media
		FROM bot.db_games
		WHERE visible = true AND cover IS NOT NULL AND btrim(cover) <> ''
		  AND (media IS NULL OR media = '[]'::jsonb OR media = '{}'::jsonb)
		ORDER BY id
	`;
	let updated = 0;
	for (const row of rows) {
		const media = [{ type: "image", url: row.cover, role: "cover" }];
		if (!apply) continue;
		await sql.begin(async (tx) => {
			await tx`
				UPDATE bot.db_games SET media = ${tx.json(media)}
				WHERE id = ${row.id} AND (media IS NULL OR media = '[]'::jsonb OR media = '{}'::jsonb)
			`;
			await tx`
				INSERT INTO public.wiki_revisions
					(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
				VALUES
					(${idRevision()}, 'db_games', ${row.id}, 'fill_empty',
					 ${`Game media materialized from existing cover: ${row.title}`},
					 ${tx.json({ media: row.media })}, ${tx.json({ media })},
					 'shenron:game-media', 'Game media materializer', NOW())
			`;
		});
		updated++;
	}
	console.log(JSON.stringify({ apply, candidates: rows.length, updated }));
} finally {
	await sql.end();
}
