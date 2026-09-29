import "reflect-metadata";
import "./wiki-write-guard";
import { container } from "tsyringe";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseService } from "~/db/index";
import { dbMangaVolumes } from "~/db/schema";
import { logger } from "~/lib/logger";
import { and, eq } from "drizzle-orm";

async function runMangaSeed() {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	logger.info("→ Seeding Manga from AniList dataset...");
	const mangaPath = join(
		import.meta.dir,
		"../../../../reference/db-recon/datasets/anilist/manga.json"
	);

	if (!existsSync(mangaPath)) {
		logger.error("Dataset not found: " + mangaPath);
		return;
	}

	const content = readFileSync(mangaPath, "utf-8");
	const mangaData = JSON.parse(content);

	const items = mangaData.data?.Page?.media || [];
	let volumesInserted = 0;

	for (const item of items) {
		// Classification par titre. « Super » seul est TROP LARGE : il capturait les
		// spin-offs (Super Dragon Ball Heroes, Dragon Ball Super: Broly / Super Hero,
		// Dragon Ball Super Divers…) et les rangeait à tort en DBS → 29 volumes +
		// 290 chapitres fantômes (pages=NULL) polluant la série DBS (nettoyés le
		// 2026-07-04). On teste donc les spin-offs AVANT le fallback « Super », qui
		// ne doit capturer que la sérialisation canonique « Dragon Ball Super ».
		const romaji: string = item.title.romaji ?? "";
		let series = "DB";
		if (/Heroes/i.test(romaji)) series = "DB_HEROES";
		else if (/\bSD\b|Super Deformed/i.test(romaji)) series = "DB_SD";
		else if (/Broly|Super Hero|Divers|Gaiden|Super Dive/i.test(romaji)) series = "DB_SPINOFF";
		else if (/Super/i.test(romaji)) series = "DBS";

		const volumeCount = item.volumes || 1;

		for (let v = 1; v <= volumeCount; v++) {
			const exists = await db
				.select()
				.from(dbMangaVolumes)
				.where(and(eq(dbMangaVolumes.series, series), eq(dbMangaVolumes.volumeNumber, v)))
				.limit(1);

			if (exists.length === 0) {
				await db
					.insert(dbMangaVolumes)
					.values({
						series,
						volumeNumber: v,
						title: `${item.title.english || item.title.romaji} — Volume ${v}`,
						titleJa: item.title.native,
						publishedAt: null,
						cover: v === 1 ? item.coverImage?.large || null : null,
					})
					.onConflictDoNothing();

				volumesInserted++;
			}
		}
	}

	logger.info(`✓ ${volumesInserted} manga volumes inserted into db_manga_volumes.`);
}

if (import.meta.main) {
	runMangaSeed()
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
