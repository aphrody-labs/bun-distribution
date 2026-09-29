import { describe, expect, test } from "bun:test";
import {
	assertMangaSpinOffManifest,
	mangaSpinOffManifest,
	publicationEpochSeconds,
} from "../scripts/manga-spin-offs";

describe("manga spin-off catalogue", () => {
	test("contains the two named spin-offs and all six SDBH series", () => {
		const works = assertMangaSpinOffManifest();
		expect(works).toHaveLength(8);
		expect(works.map((work) => work.series)).toEqual([
			"DB_SD",
			"DB_GAIDEN_YAMCHA",
			"SDBH_DARK_DEMON_REALM",
			"SDBH_UNIVERSE",
			"SDBH_BIG_BANG",
			"SDBH_ULTRA_GOD",
			"SDBH_METEOR",
			"SDBH_AVATARS",
		]);
	});

	test("is bibliography only, with primary publisher sources and no invented assets", () => {
		expect(mangaSpinOffManifest.asset_policy).toMatchObject({
			pages: "never seeded",
			covers: "never seeded",
			ocr: "never seeded",
		});
		for (const work of mangaSpinOffManifest.works) {
			expect(work.catalogue_status).toBe("metadata_only");
			expect(work.publisher).toBe("Shueisha");
			expect(work.source_url).toStartWith("https://www.shueisha.co.jp/books/");
			expect(publicationEpochSeconds(work.published_at)).toBeGreaterThan(0);
		}
		expect(mangaSpinOffManifest.source_policy.forbidden_domains).toContain("fandom.com");
		expect(JSON.stringify(mangaSpinOffManifest)).not.toContain("fandom.com/");
	});
});
