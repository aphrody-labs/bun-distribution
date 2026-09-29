#!/usr/bin/env bun
import postgres from "postgres";
import { getDbUrl, idRevision } from "./wiki-databooks-indexer";

type Databook = {
	id: number;
	title: string;
	kind: string | null;
	category: string | null;
	author: string | null;
	pages: number;
	description: string | null;
};

const apply = process.argv.includes("--apply");
const sql = postgres(getDbUrl(), { prepare: false, max: 4 });

function descriptionFromRecord(book: Databook): string {
	const classification = book.category || book.kind || "ouvrage de référence";
	const author = book.author?.trim() ? ` Crédit éditorial enregistré : ${book.author.trim()}.` : "";
	const pages = book.pages > 0
		? ` Le fonds indexe ${book.pages} planche${book.pages > 1 ? "s" : ""} pour cette fiche.`
		: " Aucun contenu de planche n'est encore indexé pour cette fiche.";
	return `${book.title} est catalogué comme ${classification}.${author}${pages}`;
}

try {
	const books = await sql<Databook[]>`
		SELECT id, title, kind, category, author,
		       jsonb_array_length(COALESCE(pages, '[]'::jsonb))::int AS pages,
		       description
		FROM bot.db_databooks
		WHERE visible IS NOT FALSE AND nullif(trim(coalesce(description, '')), '') IS NULL
		ORDER BY id
	`;
	let updated = 0;
	for (const book of books) {
		const description = descriptionFromRecord(book);
		if (!apply) continue;
		await sql.begin(async (tx) => {
			await tx`
				UPDATE bot.db_databooks
				SET description = ${description}
				WHERE id = ${book.id} AND nullif(trim(coalesce(description, '')), '') IS NULL
			`;
			await tx`
				INSERT INTO public.wiki_revisions
					(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt")
				VALUES
					(${idRevision()}, 'db_databooks', ${book.id}, 'fill_empty',
					 ${`Databook description materialized from catalog metadata: ${book.title}`},
					 ${JSON.stringify({ description: book.description })}, ${JSON.stringify({ description })},
					 'shenron:databook-catalog', 'Databook catalog materializer', NOW())
			`;
		});
		updated++;
	}
	console.log(JSON.stringify({ apply, candidates: books.length, updated }));
} finally {
	await sql.end();
}
