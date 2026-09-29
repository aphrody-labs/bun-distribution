import { describe, expect, test } from "bun:test";
import {
	assertMangaManifest,
	coverageAuditedMangaResult,
	identifyMangaAsset,
	type MangaOcrManifest,
	type MangaOcrVisualReview,
	MANGA_REVIEW_PROMPT_VERSION,
	mangaPageId,
	mangaTomeMarkdown,
	normalizeMangaMarkdown,
	parseMangaResults,
	reviewedMangaResult,
} from "../../../../packages/shenron/pipeline/src/manga-ocr";

const hash = "a".repeat(64);

function manifest(): MangaOcrManifest {
	return {
		schemaVersion: 1,
		lot: 1,
		lots: 1,
		generatedAt: "2026-09-06T00:00:00.000Z",
		generator: "apps/shenron/bot/scripts/export-manga-ocr.ts",
		selection: "missing",
		series: ["DB", "DBS"],
		imagePipeline: { width: 1800, quality: 86, format: "jpeg" },
		entries: [
			{
				id: "DB:vol1:3",
				series: "DB",
				collection: "regular",
				tome: "vol1",
				planche: 3,
				source: "assets/manga/DB/regular/vol1/003.webp",
				sourceSha256: hash,
				sourceBytes: 10,
				image: "images/DB-vol1-0003.jpg",
				imageSha256: hash,
				imageBytes: 9,
				alreadyTranscribed: false,
			},
		],
		responseExpected: {
			format: "aphrody-ocr-jsonl",
			result: { image: "image.jpg", text: { kind: "text", markdown: "texte" } },
		},
	};
}

describe("identité des planches manga", () => {
	test("reconnaît Dragon Ball régulier", () => {
		expect(identifyMangaAsset("DB/regular/vol12/007.webp")).toEqual({
			id: "DB:vol12:7",
			series: "DB",
			collection: "regular",
			tome: "vol12",
			planche: 7,
			source: "assets/manga/DB/regular/vol12/007.webp",
		});
	});

	test("reconnaît Dragon Ball Super avec séparateurs Windows", () => {
		expect(identifyMangaAsset("DBS\\ch1315\\029.webp")?.id).toBe("DBS:ch1315:29");
	});

	test("rejette couvertures et autres séries", () => {
		expect(identifyMangaAsset("DB/regular/vol1/cover.webp")).toBeNull();
		expect(identifyMangaAsset("DBZ/ch1/001.webp")).toBeNull();
	});

	test("fabrique une clé stable", () => {
		expect(mangaPageId("DBS", "ch1400", 42)).toBe("DBS:ch1400:42");
	});

	test("matérialise les planches dans un ordre déterministe", () => {
		const markdown = mangaTomeMarkdown("DB", "vol1", [
			{ planche: 2, lines: ["Deux"], text: "Deux" },
			{ planche: 1, lines: ["Un", "Suite"], text: "Un Suite" },
		]);
		expect(markdown).toContain("## Planche 001\n\n- Un\n- Suite");
		expect(markdown.indexOf("Planche 001")).toBeLessThan(markdown.indexOf("Planche 002"));
	});
});

describe("manifestes et sorties OCR", () => {
	test("valide un manifeste v1", () => {
		const value: unknown = manifest();
		expect(() => assertMangaManifest(value)).not.toThrow();
	});

	test("refuse deux identités identiques", () => {
		const value = manifest();
		const first = value.entries[0];
		expect(first).toBeDefined();
		if (!first) throw new Error("fixture absente");
		value.entries.push({ ...first, image: "images/autre.jpg" });
		expect(() => assertMangaManifest(value)).toThrow("planche dupliquée");
	});

	test("normalise le Markdown sans perdre les accents", () => {
		const result = normalizeMangaMarkdown("## Case 1\n\n- Ça alors !\n- かめはめ波");
		expect(result.lines).toEqual(["Case 1", "Ça alors !", "かめはめ波"]);
		expect(result.hasJa).toBe(true);
		expect(result.lang).toBe("fr");
	});

	test("refuse les jetons de contrôle d'un modèle", () => {
		expect(() => normalizeMangaMarkdown("<|end_of_text|>")).toThrow("balisage");
	});

	test("le manifeste, pas le chemin absolu, donne l'identité", () => {
		const line = JSON.stringify({
			image: "C:\\tmp\\DB-vol1-0003.jpg",
			text: { kind: "text", markdown: "- Bonjour !\n- Bulma ?" },
			engine: "hybrid-luna-ppocr",
			model: "gpt-5.6-luna",
			promptVersion: MANGA_REVIEW_PROMPT_VERSION,
			review: {
				schemaVersion: 1,
				pageId: "DB:vol1:3",
				decision: "accept",
				regions: [
					{ order: 1, kind: "dialogue", text: "Bonjour !", confidence: "high" },
					{ order: 2, kind: "dialogue", text: "Bulma ?", confidence: "medium" },
				],
				notes: "",
			},
			coverageAudit: {
				schemaVersion: 1,
				pageId: "DB:vol1:3",
				verdict: "confirm",
				issues: [],
				notes: "",
			},
			coverageModel: "gpt-5.6-luna",
			coverageReasoning: "low",
		});
		const parsed = parseMangaResults(`${line}\n`, manifest());
		expect(parsed.pages).toHaveLength(1);
		expect(parsed.pages[0]?.entry.id).toBe("DB:vol1:3");
		expect(parsed.pages[0]?.text).toBe("Bonjour ! Bulma ?");
		expect(parsed.invalid).toEqual([]);
		expect(parsed.unknown).toEqual([]);
	});

	test("isole les lignes inconnues et le JSON tronqué", () => {
		const parsed = parseMangaResults(
			'{"image":"ailleurs.jpg","text":{"kind":"none"}}\n{"image":',
			manifest()
		);
		expect(parsed.unknown).toEqual(["ailleurs.jpg"]);
		expect(parsed.invalid).toEqual(["ligne 2: JSON invalide"]);
	});

	test("exclut filigrane et numéro d'une revue visuelle acceptée", () => {
		const review: MangaOcrVisualReview = {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			decision: "accept",
			regions: [
				{ order: 1, kind: "watermark", text: "DB-Z.com", confidence: "high" },
				{
					order: 2,
					kind: "dialogue",
					text: "ÇA ALORS !",
					confidence: "medium",
				},
				{ order: 3, kind: "page_number", text: "3", confidence: "high" },
			],
			notes: "",
		};
		const result = reviewedMangaResult("image.jpg", "DB:vol1:3", review);
		expect(result.text).toEqual({ kind: "text", markdown: "- ÇA ALORS !" });
		expect(result.engine).toBe("hybrid-luna-ppocr");
		expect(result.promptVersion).toBe(MANGA_REVIEW_PROMPT_VERSION);
	});

	test("refuse accept si une région éditoriale reste incertaine", () => {
		const review: MangaOcrVisualReview = {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			decision: "accept",
			regions: [{ order: 1, kind: "sfx", text: "K…", confidence: "low" }],
			notes: "onomatopée illisible",
		};
		expect(() => reviewedMangaResult("image.jpg", "DB:vol1:3", review)).toThrow("complète");
	});

	test("neutralise une première revue qui a omis un SFX", () => {
		const review: MangaOcrVisualReview = {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			decision: "accept",
			regions: [{ order: 1, kind: "sfx", text: "CRAAK", confidence: "high" }],
			notes: "",
		};
		const primary = reviewedMangaResult("DB-vol1-0003.jpg", "DB:vol1:3", review);
		const result = coverageAuditedMangaResult(primary, "DB:vol1:3", {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			verdict: "needs_human",
			issues: [
				{
					kind: "omitted_region",
					detail: "grands glyphes japonais à droite",
					confidence: "high",
				},
			],
			notes: "",
		});
		expect(result.text).toEqual({ kind: "none" });
		const parsed = parseMangaResults(`${JSON.stringify(result)}\n`, manifest());
		expect(parsed.pages).toEqual([]);
		expect(parsed.invalid[0]).toContain("deux lectures");
	});

	test("refuse une acceptation Luna sans second audit", () => {
		const review: MangaOcrVisualReview = {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			decision: "accept",
			regions: [{ order: 1, kind: "dialogue", text: "Bonjour", confidence: "high" }],
			notes: "",
		};
		const result = reviewedMangaResult("DB-vol1-0003.jpg", "DB:vol1:3", review);
		const parsed = parseMangaResults(`${JSON.stringify(result)}\n`, manifest());
		expect(parsed.pages).toEqual([]);
		expect(parsed.invalid[0]).toContain("deux lectures");
	});

	test("refuse un résultat PP-OCR non arbitré au dépôt", () => {
		const line = JSON.stringify({
			image: "DB-vol1-0003.jpg",
			text: { kind: "text", markdown: "- Bonjour" },
			engine: "ppocr-v5",
			model: "ppocr-v5-mobile",
		});
		const parsed = parseMangaResults(`${line}\n`, manifest());
		expect(parsed.pages).toEqual([]);
		expect(parsed.invalid[0]).toContain("non arbitré");
	});

	test("refuse une revue produite par un ancien prompt", () => {
		const review: MangaOcrVisualReview = {
			schemaVersion: 1,
			pageId: "DB:vol1:3",
			decision: "accept",
			regions: [{ order: 1, kind: "dialogue", text: "Bonjour", confidence: "high" }],
			notes: "",
		};
		const result = reviewedMangaResult("DB-vol1-0003.jpg", "DB:vol1:3", review);
		result.promptVersion = MANGA_REVIEW_PROMPT_VERSION - 1;
		const parsed = parseMangaResults(`${JSON.stringify(result)}\n`, manifest());
		expect(parsed.pages).toEqual([]);
		expect(parsed.invalid[0]).toContain("non arbitré");
	});
});
