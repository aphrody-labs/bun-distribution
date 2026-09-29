/**
 * Seeds the eight missing spin-off catalogue records into PostgreSQL `bot`.
 *
 * It deliberately seeds bibliographic fields only. There are no pages, cover
 * paths, OCR records, or claims that DBFR can provide a reader for these works.
 * The default is a dry run; use `--apply` only with the authoritative database.
 */
import postgres from "postgres";
import { assertMangaSpinOffManifest, publicationEpochSeconds } from "./manga-spin-offs";

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;

async function main() {
	const works = assertMangaSpinOffManifest();
	if (!databaseUrl) {
		console.error("DATABASE_URL is required; no database connection was opened.");
		process.exit(1);
	}
	if (/neon\.tech/i.test(databaseUrl)) {
		console.error("DATABASE_URL must point to the authoritative PostgreSQL database, not Neon.");
		process.exit(1);
	}

	const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
	try {
		const existing = await sql<
			{
				series: string;
				title: string | null;
				title_ja: string | null;
				published_at: number | null;
				isbn: string | null;
				cover: string | null;
			}[]
		>`
			SELECT series, title, title_ja, published_at, isbn, cover
			FROM bot.db_manga_volumes WHERE series = ANY(${works.map((work) => work.series)})`;
		for (const record of existing) {
			const work = works.find((candidate) => candidate.series === record.series)!;
			if (
				record.title !== work.title ||
				record.title_ja !== work.title_ja ||
				record.isbn !== work.isbn ||
				Number(record.published_at) !== publicationEpochSeconds(work.published_at) ||
				record.cover !== null
			) {
				throw new Error(
					`Existing ${work.series} record differs from the authoritative metadata-only manifest`
				);
			}
		}
		const existingSeries = new Set(existing.map((row) => row.series));
		const pending = works.filter((work) => !existingSeries.has(work.series));
		console.log(
			`metadata-only catalogue: ${works.length} declared, ${existing.length} present, ${pending.length} pending`
		);
		for (const work of pending) console.log(`+ ${work.series}: ${work.title}`);
		if (!apply) {
			console.log("Dry run only. Re-run with --apply to insert the pending metadata records.");
			return;
		}

		await sql.begin(async (tx) => {
			await tx`LOCK TABLE bot.db_manga_volumes IN SHARE ROW EXCLUSIVE MODE`;
			const [{ maxId }] = await tx<{ maxId: number }[]>`
				SELECT coalesce(max(id), 0)::int AS "maxId" FROM bot.db_manga_volumes`;
			let nextId = Number(maxId);
			for (const work of works) {
				const rows = await tx<{ id: number }[]>`
					SELECT id FROM bot.db_manga_volumes
					WHERE series = ${work.series}
					LIMIT 1`;
				if (rows.length) continue;
				nextId++;
				await tx`
					INSERT INTO bot.db_manga_volumes
						(id, series, volume_number, title, title_ja, published_at, cover, isbn, visible)
					VALUES (
						${nextId}, ${work.series}, 1, ${work.title}, ${work.title_ja},
						${publicationEpochSeconds(work.published_at)}, NULL, ${work.isbn}, true
					)`;
			}
		});
		const [{ count }] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM bot.db_manga_volumes
			WHERE series = ANY(${works.map((work) => work.series)})`;
		if (Number(count) !== works.length)
			throw new Error(`Expected ${works.length} seeded records, found ${count}`);
		console.log(`Seed complete: ${count} metadata-only catalogue records present.`);
	} finally {
		await sql.end();
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
