import { describe, expect, test } from "bun:test";

import {
	isReadableMangaPage,
	mangaCoverPath,
	publishedMangaPageCount,
	publishedMangaPages,
	readableMangaPages,
	resolveMangaPage,
} from "../src/lib/manga-assets";

describe("publication des médias manga", () => {
	test("publie les planches DragonBallCN indexées", () => {
		const crawled =
			"https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/1.jp_original/01/DB01_000.jpg";
		expect(isReadableMangaPage(crawled)).toBe(true);
		expect(readableMangaPages([crawled])).toEqual([crawled]);
	});

	test("conserve les assets auto-hébergés et les autres sources", () => {
		const local = "./assets/manga/DB/regular/vol1/001.webp";
		const external = "https://cdn.example.org/manga/001.webp";
		expect(readableMangaPages([local, external])).toEqual([local, external]);
	});

	test("conserve les URL DB crawlées avant d'utiliser le miroir local", () => {
		const crawled =
			"http://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/9.10.full_color/19/000-k30.jpg";
		expect(publishedMangaPages("DB", 19, [crawled])).toEqual([crawled]);
		expect(publishedMangaPageCount("DB", 19, [crawled], 193)).toBe(193);
	});

	test("limite l'aperçu DB sans fausser son compte publié", () => {
		const preview = publishedMangaPages("DB", 42, [], 3);
		expect(preview).toEqual([
			"./assets/manga/DB/regular/vol42/001.webp",
			"./assets/manga/DB/regular/vol42/002.webp",
			"./assets/manga/DB/regular/vol42/003.webp",
		]);
		expect(publishedMangaPageCount("DB", 42, [], 0)).toBe(237);
	});

	test("couvre exactement les 42 tomes du miroir DB régulier", () => {
		const counts = Array.from({ length: 42 }, (_, index) =>
			publishedMangaPageCount("DB", index + 1, [], 0)
		);
		expect(counts.every((count) => count > 0)).toBe(true);
		expect(counts.reduce((sum, count) => sum + count, 0)).toBe(7_965);
		expect(publishedMangaPages("DB", 43, [])).toEqual([]);
	});

	test("conserve les planches d'une édition sans miroir local", () => {
		const crawled =
			"https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/1.jp_original/01/DB01_000.jpg";
		expect(publishedMangaPages("DBJP", 1, [crawled])).toEqual([crawled]);
		expect(publishedMangaPageCount("DBJP", 1, [crawled], 221)).toBe(221);
	});

	test("préserve la source et le compte des séries auto-hébergées", () => {
		const pages = ["./assets/manga/DBS/ch1417/001.webp", "./assets/manga/DBS/ch1417/002.webp"];
		expect(publishedMangaPages("DBS", 103, pages, 1)).toEqual([pages[0]]);
		expect(publishedMangaPageCount("DBS", 103, pages.slice(0, 1), 45)).toBe(45);
	});

	test("résout les planches Full Color (DBFC) en repli local et gère le json stringifié", () => {
		const preview = publishedMangaPages("DBFC", 1, [], 3);
		expect(preview).toEqual([
			"./assets/manga/DBFC/ch1/001.jpg",
			"./assets/manga/DBFC/ch1/002.jpg",
			"./assets/manga/DBFC/ch1/003.jpg",
		]);
		expect(publishedMangaPageCount("DBFC", 1, [], 0)).toBe(33);
		expect(publishedMangaPageCount("DBFC", 0, [], 0)).toBe(19);

		// JSON stringifié
		const jsonString = JSON.stringify(["./assets/manga/DBFC/ch1/001.jpg"]);
		expect(publishedMangaPages("DBFC", 1, jsonString, 1)).toEqual(["./assets/manga/DBFC/ch1/001.jpg"]);
		expect(publishedMangaPageCount("DBFC", 1, jsonString, 33)).toBe(33);
	});

	test("résout les planches Dragon Ball Super (DBS) en repli local", () => {
		const preview = publishedMangaPages("DBS", 1, [], 3);
		expect(preview).toEqual([
			"./assets/manga/DBS/ch1315/001.webp",
			"./assets/manga/DBS/ch1315/002.webp",
			"./assets/manga/DBS/ch1315/003.webp",
		]);
		expect(publishedMangaPageCount("DBS", 1, [], 0)).toBe(16);
		expect(publishedMangaPageCount("DBS", 103, [], 0)).toBe(45);
	});

	test("substitue les couvertures japonaises par le miroir local", () => {
		expect(mangaCoverPath("DBJP", 1, "https://example.org/broken.gif")).toBe(
			"./assets/dragonballcn/dragonball_jp_original/001.webp"
		);
		expect(mangaCoverPath("DBKZ", 34, null)).toBe(
			"./assets/dragonballcn/dragonball_jp_kanzenban/034.webp"
		);
	});

	test("ne modifie pas les couvertures des séries ordinaires", () => {
		expect(mangaCoverPath("DB", 1, "./assets/manga/db-01.webp")).toBe("./assets/manga/db-01.webp");
	});

	test("adresse une planche par rang avant son numéro imprimé", () => {
		const pages = [
			{ index: 1, planche: 1 },
			{ index: 2, planche: 0 },
			{ index: 3, planche: 1 },
		];
		expect(resolveMangaPage(pages, 1)).toBe(pages[0]);
		expect(resolveMangaPage(pages, 3)).toBe(pages[2]);
	});

	test("conserve le numéro imprimé comme repli hors de la plage des rangs", () => {
		const pages = [
			{ index: 1, planche: 42 },
			{ index: 2, planche: 43 },
		];
		expect(resolveMangaPage(pages, 42)).toBe(pages[0]);
	});
});
