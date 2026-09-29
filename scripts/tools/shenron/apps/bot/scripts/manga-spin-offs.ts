import manifest from "../data/manga-spin-offs-manifest.json";

export type MangaSpinOff = {
	series: string;
	title: string;
	title_ja: string;
	author: string;
	original_creator?: string;
	isbn: string;
	published_at: string;
	publisher: string;
	source_url: string;
	catalogue_status: "metadata_only";
};

type MangaSpinOffManifest = {
	schema: "shenron-manga-spin-offs/v1";
	asset_policy: { pages: string; covers: string; ocr: string };
	source_policy: { allowed_publishers: string[]; forbidden_domains: string[] };
	works: MangaSpinOff[];
};

export const mangaSpinOffManifest = manifest as MangaSpinOffManifest;

/** Throws when the hand-maintained catalogue stops satisfying its safety contract. */
export function assertMangaSpinOffManifest(value = mangaSpinOffManifest): MangaSpinOff[] {
	if (value.schema !== "shenron-manga-spin-offs/v1")
		throw new Error("Unsupported spin-off manifest schema");
	if (value.works.length !== 8)
		throw new Error(`Expected eight spin-offs, found ${value.works.length}`);
	if (value.asset_policy.pages !== "never seeded" || value.asset_policy.covers !== "never seeded") {
		throw new Error("Spin-off manifest must not declare page or cover assets");
	}
	const seen = new Set<string>();
	for (const work of value.works) {
		if (!/^([A-Z0-9]+_)+[A-Z0-9]+$/.test(work.series) || seen.has(work.series)) {
			throw new Error(`Invalid or duplicate series key: ${work.series}`);
		}
		seen.add(work.series);
		if (work.catalogue_status !== "metadata_only") {
			throw new Error(`${work.series} must remain metadata-only`);
		}
		if (work.publisher !== "Shueisha") throw new Error(`${work.series} lacks its publisher source`);
		const url = new URL(work.source_url);
		if (url.hostname !== "www.shueisha.co.jp" || !url.pathname.startsWith("/books/")) {
			throw new Error(`${work.series} does not point to the official Shueisha catalogue`);
		}
		if (
			value.source_policy.forbidden_domains.some(
				(domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
			)
		) {
			throw new Error(`${work.series} points to a forbidden source domain`);
		}
		if (!/^978-\d-\d{2}-\d{6}-\d$/.test(work.isbn))
			throw new Error(`${work.series} has an invalid ISBN`);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(work.published_at)) {
			throw new Error(`${work.series} has an invalid publication date`);
		}
	}
	return value.works;
}

export function publicationEpochSeconds(date: string): number {
	const millis = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isSafeInteger(millis)) throw new Error(`Invalid publication date: ${date}`);
	return Math.floor(millis / 1000);
}
