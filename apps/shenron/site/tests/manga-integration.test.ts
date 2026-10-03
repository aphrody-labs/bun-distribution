import { beforeAll, describe, expect, mock, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";

// Mock server-only before importing server files
mock.module("server-only", () => ({}));

// Real preconfigured Shenron PostgreSQL + fully preloaded RAG; never skipped.
loadLiveRagEnv();
delete (globalThis as Record<string, unknown>).pgClient;
beforeAll(async () => {
	await requireLiveRag();
}, 120_000);

const { dbUniverse } = await import("../src/lib/db-universe");
const { assetUrl } = await import("../src/lib/assets");

describe("Intégration du catalogue Manga et du lecteur", () => {
	test("mangaCatalogVolumes expose chaque série visible sans doublon", async () => {
		const catalog = await dbUniverse.mangaCatalogVolumes();
		expect(catalog).not.toBeNull();
		if (!catalog) throw new Error("mangaCatalogVolumes returned null");

		const keys = catalog.volumes.map((volume) => `${volume.series}:${volume.id}`);
		expect(new Set(keys).size).toBe(catalog.volumes.length);
		expect(catalog.volumes.some((volume) => volume.series === "DB_GAIDEN_YAMCHA")).toBe(true);
		expect(catalog.volumes.some((volume) => volume.series === "SDBH_METEOR")).toBe(true);
		expect(catalog.volumes.find((volume) => volume.series === "SDBH_METEOR")?.source_url).toStartWith(
			"https://www.shueisha.co.jp/books/",
		);
	});

	test("readableMangaChapters résout les chapitres DB, DBFC et DBS", async () => {
		const res = await dbUniverse.readableMangaChapters();
		expect(res).not.toBeNull();
		if (!res) throw new Error("readableMangaChapters returned null");
		expect(res.chapters.length).toBeGreaterThan(600);

		const dbChapters = res.chapters.filter((c) => c.series === "DB");
		const dbfcChapters = res.chapters.filter((c) => c.series === "DBFC");
		const dbsChapters = res.chapters.filter((c) => c.series === "DBS");

		expect(dbChapters.length).toBe(42);
		expect(dbfcChapters.length).toBe(520);
		expect(dbsChapters.length).toBe(103);

		// Vérifie qu'aucun chapitre n'a 0 planche
		for (const ch of res.chapters) {
			expect(ch.pages.length).toBeGreaterThan(0);
			expect(ch.page_count).toBeGreaterThan(0);
		}
	});

	test("mangaChapter résout DBFC ch1 (id 20001) avec ses 33 planches couleur", async () => {
		const ch1 = await dbUniverse.mangaChapter(20001);
		expect(ch1).not.toBeNull();
		expect(ch1!.series).toBe("DBFC");
		expect(ch1!.chapter_number).toBe(1);
		expect(ch1!.pages.length).toBe(33);
		expect(ch1!.pages[0]).toBe("./assets/manga/DBFC/ch1/001.jpg");
		expect(ch1!.pages[32]).toBe("./assets/manga/DBFC/ch1/033.jpg");

		// Vérifie l'URL CDN générée
		const fullUrl = assetUrl(ch1!.pages[0]);
		expect(fullUrl).toContain("/assets/manga/DBFC/ch1/001.jpg");

		// Navigation prev/next
		expect(ch1!.prev).toBe(20999); // Chapitre 0
		expect(ch1!.next).toBe(20002); // Chapitre 2
		expect(ch1!.nextPages).not.toBeNull();
		expect(ch1!.nextPages!.length).toBeGreaterThan(0);
	});

	test("mangaChapter résout DBS ch1 (id 1315) avec ses 16 planches", async () => {
		const dbs1 = await dbUniverse.mangaChapter(1315);
		expect(dbs1).not.toBeNull();
		expect(dbs1!.series).toBe("DBS");
		expect(dbs1!.chapter_number).toBe(1);
		expect(dbs1!.pages.length).toBe(16);
		expect(dbs1!.pages[0]).toBe("./assets/manga/DBS/ch1315/001.webp");

		// Navigation next
		expect(dbs1!.next).toBe(1316);
		expect(dbs1!.nextPages).not.toBeNull();
	});

	test("mangaChapter résout DB tome 1 (id 1420) avec ses 221 planches régulières", async () => {
		const db1 = await dbUniverse.mangaChapter(1420);
		expect(db1).not.toBeNull();
		expect(db1!.series).toBe("DB");
		expect(db1!.chapter_number).toBe(1);
		expect(db1!.pages.length).toBe(221);
		expect(db1!.pages[0]).toBe("./assets/manga/DB/regular/vol1/001.webp");

		// Navigation next
		expect(db1!.next).toBe(1421); // Tome 2
	});

	test("mangaVolume résout le tome 1 (id 82) avec chapitres NB et Full Color", async () => {
		const vol = await dbUniverse.mangaVolume(82);
		expect(vol).not.toBeNull();
		expect(vol!.series).toBe("DB");
		expect(vol!.volume_number).toBe(1);

		const nbChapters = vol!.chapters.filter((c) => c.series === "DB");
		const colorChapters = vol!.chapters.filter((c) => c.series === "DBFC");

		expect(nbChapters.length).toBe(1);
		expect(nbChapters[0]?.pages?.length).toBe(221);

		expect(colorChapters.length).toBe(13); // Chapitres 1 à 13
		for (const ch of colorChapters) {
			expect((ch.pages?.length ?? 0)).toBeGreaterThan(0);
		}
	});

	test("mangaVolume résout les chapitres avec leurs planches complétées", async () => {
		const catalog = await dbUniverse.mangaVolumes("DBJP");
		const first = catalog?.volumes[0];
		expect(first).toBeDefined();
		if (!first) throw new Error("DBJP catalog is empty");

		const volume = await dbUniverse.mangaVolume(first.id);
		expect(volume).not.toBeNull();
		expect(volume!.chapters.length).toBeGreaterThan(0);
		expect(volume!.chapters.every((chapter) => (chapter.pages?.length ?? 0) > 0)).toBe(true);

		const readable = await dbUniverse.mangaVolume(82);
		expect(readable).not.toBeNull();
		expect(readable!.chapters.every((chapter) => (chapter.pages?.length ?? 0) > 0)).toBe(true);
	});
});
