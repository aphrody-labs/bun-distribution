import "./setup";
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
	extractTranslationPairs,
	getPublishedMangaTranslation,
	insertMangaCandidate,
	listMangaCandidates,
	parseMangaReviewCandidate,
} from "../src/db/manga-candidates";
import { approveAndPublishMangaCandidate, rejectMangaCandidate } from "../src/lib/manga-publish";
import { mangaCandidate } from "./manga-candidate-fixture";

describe("manga_candidates (SQLite)", () => {
	it("valide le schéma et refuse un candidat incohérent", () => {
		expect(parseMangaReviewCandidate(mangaCandidate()).pageId).toBe("DB:vol1:12");
		expect(() => parseMangaReviewCandidate({ ...mangaCandidate(), schema: "x" })).toThrow();
		expect(() => parseMangaReviewCandidate({ ...mangaCandidate(), decision: "approved" })).toThrow();
		const bad = mangaCandidate();
		bad.source.sourceSha256 = "nope";
		expect(() => parseMangaReviewCandidate(bad)).toThrow();
		expect(() => parseMangaReviewCandidate({ ...mangaCandidate(), pageId: "DB:vol1:13" })).toThrow();
	});

	it("déduplique par hash canonique", () => {
		const db = new Database(":memory:");
		const a = insertMangaCandidate(db, mangaCandidate(), 1);
		const b = insertMangaCandidate(db, mangaCandidate(), 2);
		expect(a.created).toBe(true);
		expect(b.created).toBe(false);
		expect(b.candidate.id).toBe(a.candidate.id);
		expect(listMangaCandidates(db, { status: "unreviewed" })).toHaveLength(1);
	});

	it("extrait les paires dans l'ordre de lecture", () => {
		const pairs = extractTranslationPairs(parseMangaReviewCandidate(mangaCandidate()));
		expect(pairs.map((p) => p.translatedText)).toEqual(["Goku", "Kamé Hamé Ha !"]);
	});

	it("approuve → publie, puis refuse une seconde transition", () => {
		const db = new Database(":memory:");
		const { candidate } = insertMangaCandidate(db, mangaCandidate(), 1);
		const r = approveAndPublishMangaCandidate(db, candidate.id, "discord:1", 5);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.candidate.status).toBe("published");
		expect(r.candidate.reviewedAt).toBe(5);
		expect(r.candidate.publishedAt).toBe(5);
		expect(getPublishedMangaTranslation(db, "DB:vol1:12")?.pairs).toHaveLength(2);
		expect(rejectMangaCandidate(db, candidate.id, "discord:1")).toEqual({ ok: false, code: "invalid_state" });
		expect(approveAndPublishMangaCandidate(db, 999, "x")).toEqual({ ok: false, code: "not_found" });
	});

	it("rejette et refuse de publier un candidat sans traduction", () => {
		const db = new Database(":memory:");
		const empty = insertMangaCandidate(db, mangaCandidate({ translated: null }), 1).candidate;
		const r = approveAndPublishMangaCandidate(db, empty.id, "x");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.code).toBe("no_translation");
		expect(rejectMangaCandidate(db, empty.id, "x").ok).toBe(true);
		expect(listMangaCandidates(db, { status: "rejected" })).toHaveLength(1);
		expect(getPublishedMangaTranslation(db, "DB:vol1:12")).toBeNull();
	});
});
