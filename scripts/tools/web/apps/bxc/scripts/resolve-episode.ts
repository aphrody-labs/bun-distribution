import { VoiranimeScraper } from "@aphrody/bxc/scrapers/voiranime";

type MediaLanguage = "vf" | "vostfr";

const SERIES: Record<
	string,
	{
		slugs: Partial<Record<MediaLanguage, string>>;
		offset?: number;
		vostfrNumbers?: Record<number, number>;
	}
> = {
	DB: { slugs: { vostfr: "dragon-ball", vf: "dragon-ball-vf" } },
	DBZ: { slugs: { vostfr: "dragon-ball-z", vf: "dragon-ball-z-vf" } },
	DBGT: { slugs: { vostfr: "dragon-ball-gt", vf: "dragon-ball-gt-vf" } },
	DBS: { slugs: { vostfr: "dragon-ball-super", vf: "dragon-ball-super-vf" } },
	DB_DAIMA: { slugs: { vostfr: "dragon-ball-daima" } },
	DBZ_KAI: { slugs: { vostfr: "dragon-ball-kai", vf: "dragon-ball-kai-vf" } },
	DBZ_KAI_FINAL: {
		slugs: { vostfr: "dragon-ball-kai", vf: "dragon-ball-kai-vf" },
		offset: 97,
		// VOSTFR : voir-anime numérote la VOSTFR de Kai selon la diffusion japonaise
		// (1→159) et la VF selon le découpage international (1→167). « 97 + n » n'est
		// donc juste que pour la VF ; en VOSTFR il désignait un autre épisode que la
		// fiche (trace.moe, 2026-09-13 : fiches 12/18/40 → ép. 11/17/39 au lieu de
		// 6/10/32). Table fiche → épisode VOSTFR générée par
		// shenron apps/bot/scripts/kai-final-correspondance.ts ; une fiche absente
		// de la table (épisode japonais scindé par le découpage international) n'a
		// pas de VOSTFR.
		vostfrNumbers: { 1: 98, 2: 99, 3: 100, 7: 101, 12: 104, 13: 105, 15: 106, 18: 108, 19: 109, 20: 110, 21: 111, 22: 112, 23: 113, 24: 114, 25: 115, 26: 116, 27: 117, 28: 118, 29: 119, 30: 120, 31: 121, 32: 122, 33: 123, 34: 124, 35: 125, 36: 126, 37: 127, 38: 128, 39: 129, 40: 130, 41: 131, 42: 132, 43: 133, 44: 134, 45: 135, 46: 136, 47: 137, 48: 138, 49: 139, 50: 140, 51: 141, 52: 142, 53: 143, 54: 144, 55: 145, 56: 146, 57: 147, 58: 148, 59: 149, 60: 150, 61: 151, 62: 152, 63: 153, 64: 154, 65: 155, 66: 156, 67: 157, 69: 158, 70: 159 },
	},
};

type Candidate = {
	type: "hls" | "mp4";
	url: string;
	headers: Record<string, string>;
	provider: string;
	lang: MediaLanguage;
};

async function reachable(candidate: Candidate): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8_000);
	try {
		const response = await fetch(candidate.url, {
			signal: controller.signal,
			headers: { ...candidate.headers, Range: "bytes=0-1024" },
		});
		return response.ok || response.status === 206;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

const [seriesName, numberRaw] = Bun.argv.slice(2);
const number = Number(numberRaw);
const series = SERIES[seriesName ?? ""];
if (!series || !Number.isFinite(number)) {
	console.log(JSON.stringify({ error: "usage: <SERIES> <NUMBER>" }));
	process.exit(0);
}

async function resolveLanguage(
	lang: MediaLanguage,
	slug: string,
	sourceNumber: number,
): Promise<Candidate | null> {
	const scraper = new VoiranimeScraper();
	try {
		const anime = await scraper.getAnime(slug);
		const episode = anime.episodes.find((item) => item.number === sourceNumber);
		if (!episode) return null;
		const info = await scraper.getEpisode(episode.url);
		for (const player of info.players) {
			try {
				const source = await scraper.resolveSource(player);
				if ((source.type !== "hls" && source.type !== "mp4") || !source.url)
					continue;
				const candidate: Candidate = {
					type: source.type,
					url: source.url,
					headers: source.headers ?? {},
					provider: player.provider,
					lang,
				};
				if (await reachable(candidate)) return candidate;
			} catch (error) {
				console.error(`[RESOLVER] ${player.provider}: ${String(error)}`);
			}
		}
		return null;
	} catch (error) {
		console.error(`[RESOLVER] ${slug}: ${String(error)}`);
		return null;
	} finally {
		await scraper.close();
	}
}

const sourceNumberFor = (lang: MediaLanguage): number | undefined =>
	lang === "vostfr" && series.vostfrNumbers
		? series.vostfrNumbers[number]
		: number + (series.offset ?? 0);
const resolved = await Promise.all(
	(Object.entries(series.slugs) as [MediaLanguage, string][]).map(async ([lang, slug]) => {
		const sourceNumber = sourceNumberFor(lang);
		return [
			lang,
			sourceNumber === undefined ? null : await resolveLanguage(lang, slug, sourceNumber),
		] as const;
	}),
);
const variants = Object.fromEntries(
	resolved.filter(
		(entry): entry is readonly [MediaLanguage, Candidate] => entry[1] !== null,
	),
);
const selected = variants.vostfr ?? variants.vf;
console.log(
	JSON.stringify(
		selected
			? { ...selected, variants }
			: { error: `no playable stream for ${seriesName} ${number}`, variants },
	),
);
