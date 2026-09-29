import "reflect-metadata";
import "~/db/wiki-write-guard";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacters, dbTransformations } from "~/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "~/lib/logger";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ANIME_IDS = [
	223, // Dragon Ball
	813, // Dragon Ball Z
	12095, // Dragon Ball GT
	30694, // Dragon Ball Super
	54900, // Dragon Ball Daima
];

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const r = await fetch(url, { headers: { "User-Agent": "DBFR-bot/1.0" } });
		if (!r.ok) {
			if (r.status === 429) {
				logger.warn("Rate limited, sleeping 5s...");
				await SLEEP(5000);
				return fetchJson(url);
			}
			return null;
		}
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

async function runCharacterIngest() {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	logger.info("→ Ingesting characters from Jikan API...");

	let totalInserted = 0;

	for (const animeId of ANIME_IDS) {
		logger.info(`Fetching characters for anime ${animeId}...`);
		const data = await fetchJson<{
			data: Array<{
				character: {
					mal_id: number;
					url: string;
					name: string;
					images: { webp: { image_url: string } };
				};
				role: string;
			}>;
		}>(`https://api.jikan.moe/v4/anime/${animeId}/characters`);

		if (!data?.data) {
			logger.error(`Failed to fetch characters for anime ${animeId}`);
			continue;
		}

		for (const item of data.data) {
			const char = item.character;
			// Jikan names are "Last, First"
			const parts = char.name.split(", ");
			const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : char.name;

			// Check if already exists (by name or malId)
			const exists = await db.query.dbCharacters.findFirst({
				where: eq(dbCharacters.name, name),
			});

			if (!exists) {
				await db.insert(dbCharacters).values({
					name,
					description: `Character from Dragon Ball (MAL ID: ${char.mal_id})`,
					image: char.images.webp.image_url,
					race: "Unknown",
					gender: "Unknown",
					ki: "Unknown",
					maxKi: "Unknown",
					affiliation: "Unknown",
				});
				totalInserted++;
			}
		}
		await SLEEP(1000); // Respect rate limit
	}

	logger.info(`✓ ${totalInserted} new characters inserted.`);
}

if (import.meta.main) {
	runCharacterIngest()
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
