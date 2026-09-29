import "reflect-metadata";
import "./wiki-write-guard";
import { container } from "tsyringe";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseService } from "~/db/index";
import { dbMovies } from "~/db/schema";
import { logger } from "~/lib/logger";

async function runMediaSeed() {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	logger.info("→ Seeding Movies from Jikan API dataset...");
	const jikanPath = join(
		import.meta.dir,
		"../../../../reference/db-recon/apis/jikan-dbz-anime.json"
	);

	if (!existsSync(jikanPath)) {
		logger.error("Dataset not found: " + jikanPath);
		return;
	}

	const fs = await import("node:fs/promises");
	const content = await fs.readFile(jikanPath, "utf-8");
	const jikanData = JSON.parse(content);

	const items = jikanData.data || [];
	let moviesInserted = 0;

	// Filter for Movies and TV Specials
	const movies = items.filter((item: any) => item.type === "Movie" || item.type === "TV Special");

	for (const movie of movies) {
		const slug = movie.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "");
		let series = "DBZ_MOVIE";
		if (movie.title.includes("Dragon Ball Super")) series = "DBS_MOVIE";
		else if (!movie.title.includes("Z") && !movie.title.includes("Super")) series = "DB_MOVIE";

		const durationMatch = movie.duration ? movie.duration.match(/(\d+)\s*hr\s*(\d+)?/) : null;
		let durationMin = 0;
		if (durationMatch) {
			durationMin = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2] || "0");
		} else if (movie.duration) {
			const minMatch = movie.duration.match(/(\d+)\s*min/);
			if (minMatch) durationMin = parseInt(minMatch[1]);
		}

		await db
			.insert(dbMovies)
			.values({
				slug,
				title: movie.title_english || movie.title,
				titleJa: movie.title_japanese,
				titleRomaji: movie.title, // using default title as romaji fallback
				series,
				releaseDate: movie.aired.from ? new Date(movie.aired.from) : null,
				durationMin: durationMin || null,
				synopsis: movie.synopsis?.replace("[Written by MAL Rewrite]", "").trim() || null,
				poster: movie.images?.webp?.large_image_url || movie.images?.jpg?.large_image_url || null,
				malId: movie.mal_id,
			})
			.onConflictDoNothing();

		moviesInserted++;
	}

	logger.info(`✓ ${moviesInserted} movies/specials inserted into db_movies.`);
}

if (import.meta.main) {
	runMediaSeed()
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
