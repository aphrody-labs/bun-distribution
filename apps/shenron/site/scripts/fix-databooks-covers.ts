#!/usr/bin/env bun
/**
 * fix-databooks-covers.ts
 *
 * Aligne les couvertures (cover) des databooks 457 à 464 sur leurs planches locales
 * auto-hébergées (pages->0->>'image') et consigne chaque modification dans public.wiki_revisions.
 */

import { arretSiGel, connecte } from "./_databooks-base";

arretSiGel("fix-databooks-covers.ts");

const generateRevisionId = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

async function main() {
	const sql = await connecte();

	try {
		const targetIds = [457, 458, 459, 460, 461, 462, 463, 464];
		const rows = await sql<Array<{ id: number; title: string; cover: string; pages: any[] }>>`
			SELECT id, title, cover, pages
			FROM bot.db_databooks
			WHERE id = ANY(${targetIds})
			ORDER BY id ASC
		`;

		console.log(`Traitement des couvertures de ${rows.length} databooks...`);

		for (const book of rows) {
			const firstPage = book.pages?.[0];
			const newCover = firstPage?.image;

			if (!newCover) {
				console.warn(`[#${book.id}] Aucune première page trouvée pour ${book.title}, sauté.`);
				continue;
			}

			if (book.cover === newCover) {
				console.log(`[#${book.id}] ${book.title} : couverture déjà conforme (${newCover}).`);
				continue;
			}

			console.log(`[#${book.id}] ${book.title}`);
			console.log(`  Avant : ${book.cover}`);
			console.log(`  Après : ${newCover}`);

			await sql.begin(async (tx) => {
				await tx`
					UPDATE bot.db_databooks
					SET cover = ${newCover}
					WHERE id = ${book.id}
				`;

				const revId = generateRevisionId();
				await tx`
					INSERT INTO public.wiki_revisions (
						id,
						"tableName",
						"rowId",
						action,
						label,
						before,
						after,
						"editorId",
						"editorName",
						"createdAt"
					) VALUES (
						${revId},
						'db_databooks',
						${String(book.id)},
						'update',
						${`${book.title} — Alignement couverture locale auto-hébergée`},
						${tx.json({ cover: book.cover })},
						${tx.json({ cover: newCover })},
						'shenron-databooks-agent',
						'Shenron Databooks Ingestion Agent',
						NOW()
					)
				`;
			});

			console.log(`  ✓ Mis à jour et consigné dans wiki_revisions.`);
		}

		console.log("\nOpération terminée avec succès.");
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("Erreur fatale :", err);
	process.exit(1);
});
