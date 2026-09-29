import { describe, expect, test } from "bun:test";

import { mangaBibliographicSourceUrl, mangaSourceLabel, officialMangaSourceUrl } from "../src/lib/manga-source-registry";

describe("manga source registry", () => {
	test("exposes the publisher source declared by the spin-off manifest", () => {
		expect(officialMangaSourceUrl("DB_GAIDEN_YAMCHA")).toBe(
			"https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-881261-8",
		);
	});

	test("does not fabricate a source for an edition without one", () => {
		expect(officialMangaSourceUrl("DB")).toBeNull();
	});

	test("connects a crawled legacy edition to its bibliographic catalogue, not a reader", () => {
		expect(mangaBibliographicSourceUrl("DBKZ")).toBe("https://comic.dragonballcn.com/dragonball_jp_kanzenban.htm");
		expect(mangaSourceLabel("DBKZ")).toBe("Catalogue bibliographique");
	});
});
