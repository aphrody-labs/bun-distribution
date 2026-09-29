/**
 * Répare les cinq défauts de la rubrique Interviews constatés dans le dump
 * du 2026-09-17 : les quatre fiches officielles n'étaient pas toutes
 * catégorisées/auteur de façon stable et leurs citations historiques
 * retombaient parfois sur /wiki/canon au lieu du document source.
 *
 * Usage : bun scripts/repair-interview-databook-links.ts --dry-run
 *         bun scripts/repair-interview-databook-links.ts --apply
 *
 * La commande est idempotente. Elle ne crée aucune citation et ne réactive
 * aucune source masquée : elle ne fait que réparer les métadonnées et les
 * liens de références déjà présents.
 */
import postgres from "postgres";
import { getDbUrl, idRevision } from "./_wiki-databooks-indexer";

const APPLY = process.argv.includes("--apply");
const sql = postgres(getDbUrl(), { max: 1, prepare: false });

const BOOKS = [
	{
		id: 7,
		title: "Interview d'Akira Toriyama — Daizenshuu 2",
		author: "Akira Toriyama",
		year: 1995,
	},
	{
		id: 8,
		title: "Entretien Toriyama × Toyotarō — Dragon Ball Super",
		author: "Toriyama & Toyotarō",
		year: 2016,
	},
	{
		id: 57,
		title: "WIRED Japan 1997 #1: “Issue 3.01”",
		author: "Akira Toriyama",
		year: 1997,
	},
	{
		id: 464,
		title: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
		author: "Akira Toriyama",
		year: 1995,
	},
] as const;

async function main() {
	const changes = await sql.begin(async (tx) => {
		const detected: string[] = [];
		for (const book of BOOKS) {
			const [before] = await tx`
			SELECT id, kind, category, author
			FROM bot.db_databooks
			WHERE id = ${book.id}
		`;
			if (!before) {
				console.log(`! db_databooks#${book.id} absent — ignoré`);
				continue;
			}

			const after = {
				...before,
				kind: "interview",
				category: "Interview",
				author: book.author,
			};
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				detected.push(`db_databooks#${book.id}: kind/category/auteur`);
				if (APPLY) {
					await tx`
					UPDATE bot.db_databooks
					SET kind = 'interview', category = 'Interview', author = ${book.author}
					WHERE id = ${book.id}
				`;
					await tx`
					INSERT INTO public.wiki_revisions
						(id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
					VALUES (
						${idRevision()}, 'db_databooks', ${String(book.id)}, 'update', ${book.title},
						${sql.json(before)}, ${sql.json(after)}, 'autogoal', 'Shenron autogoal'
					)
				`;
				}
			}

			const linked = await tx`
			SELECT count(*)::int AS n
			FROM public.canon_references
			WHERE document = ${book.title}
			  AND (href IS NULL OR href = '/wiki/canon')
		`;
			if (Number(linked[0]?.n ?? 0) > 0) {
				detected.push(`canon_references: ${linked[0].n} lien(s) → /wiki/databooks/${book.id}`);
				if (APPLY) {
					await tx`
					UPDATE public.canon_references
					SET href = ${`/wiki/databooks/${book.id}`},
						year = COALESCE(year, ${book.year}),
						updated_at = now()
					WHERE document = ${book.title}
					  AND (href IS NULL OR href = '/wiki/canon')
				`;
				}
			}
		}
		return detected;
	});

	if (APPLY) {
		for (const book of BOOKS) {
			const [badMeta] = await sql`
				SELECT count(*)::int AS n
				FROM bot.db_databooks
				WHERE id = ${book.id}
				  AND (kind <> 'interview' OR category <> 'Interview' OR author <> ${book.author})
			`;
			const [badLinks] = await sql`
				SELECT count(*)::int AS n
				FROM public.canon_references
				WHERE document = ${book.title}
				  AND (href IS NULL OR href = '/wiki/canon')
			`;
			if (Number(badMeta?.n ?? 0) !== 0 || Number(badLinks?.n ?? 0) !== 0) {
				throw new Error(
					`Vérification échouée pour db_databooks#${book.id}: meta=${badMeta?.n ?? 0}, liens=${badLinks?.n ?? 0}`
				);
			}
		}
		console.log("✓ Vérification post-transaction : métadonnées et liens cohérents.");
	}

	const [quality] = await sql`
		SELECT
			count(*) FILTER (WHERE visible IS NOT TRUE)::int AS hidden,
			count(*) FILTER (WHERE href IS NULL OR href = '/wiki/canon')::int AS generic_links
		FROM public.canon_references
		WHERE document = ANY(${BOOKS.map((book) => book.title)})
	`;
	const duplicateSubjects = await sql`
		SELECT document, subject, count(*)::int AS n
		FROM public.canon_references
		WHERE document = ANY(${BOOKS.map((book) => book.title)})
		GROUP BY document, subject
		HAVING count(*) > 1
		ORDER BY n DESC, document, subject
	`;
	if (Number(quality?.hidden ?? 0) > 0) {
		console.warn(
			`⚠ ${quality.hidden} référence(s) d'interview masquée(s) : revue canonique requise, aucune réactivation automatique.`
		);
	}
	if (Number(quality?.generic_links ?? 0) > 0) {
		console.warn(`⚠ ${quality.generic_links} lien(s) de source restent génériques.`);
	}
	if (duplicateSubjects.length > 0) {
		console.warn(`⚠ ${duplicateSubjects.length} sujet(s) d'interview dupliqué(s) détecté(s).`);
		for (const row of duplicateSubjects)
			console.warn(`  - ${row.document} · ${row.subject} ×${row.n}`);
	}

	console.log(`${APPLY ? "APPLY" : "DRY-RUN"}: ${changes.length} correction(s) détectée(s)`);
	for (const change of changes) console.log(`- ${change}`);
	await sql.end();
}

main().catch(async (error) => {
	console.error(error);
	await sql.end({ timeout: 1 }).catch(() => undefined);
	process.exit(1);
});
