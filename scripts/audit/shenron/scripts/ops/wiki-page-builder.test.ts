import { describe, expect, test } from "bun:test";
import { buildWikiPageCandidate, categoryForSource, parseOptions, wikiSlug } from "../../../../build/shenron/scripts/ops/wiki-page-builder";

const record = {
	url: "https://www.dragon-ball-official.com/news/01_1234.html",
	kind: "reference",
	title: "Dragon Ball — Nouveautés !",
	excerpt: "  Une annonce   collectée depuis la source. ",
	httpStatus: 200,
	contentHash: "a".repeat(64),
	fetchedAt: "2026-09-16T12:30:00.000Z",
	canonicalEligible: false,
	provenance: { crawlSource: "bxc", locale: "fr" },
};

describe("wiki page builder", () => {
	test("creates a deterministic review-only draft with its source and rollback guard", () => {
		const first = buildWikiPageCandidate(record);
		const second = buildWikiPageCandidate(record);

		expect(first).toEqual(second);
		expect(first).toMatchObject({
			id: "crawl-53f8dbecd935",
			status: "draft",
			category: { slug: "references", name: "Références" },
			slug: "dragon-ball-nouveautes",
			title: "Dragon Ball — Nouveautés !",
			provenance: { url: record.url, canonicalEligible: false, metadata: record.provenance },
			revisionPlan: {
				action: "create",
				tableName: "WikiPage",
				before: null,
				rollback: { action: "revert-create", guard: { expectedContentHash: record.contentHash } },
			},
		});
		expect(first.sections[0]).toEqual({ heading: "Extrait collecté", markdown: "Une annonce collectée depuis la source." });
		expect(first.revisionPlan.after.body).toContain("aucune décision canonique n’est inférée");
	});

	test("avoids an existing wiki route while retaining a stable source-specific suffix", () => {
		const candidate = buildWikiPageCandidate(record, { occupiedSlugs: new Set(["dragon-ball-nouveautes"]) });
		expect(candidate.slug).toBe("dragon-ball-nouveautes-source-53f8dbecd9");
		expect(candidate.revisionPlan.rollback.guard.expectedSlug).toBe(candidate.slug);
		expect(
			buildWikiPageCandidate(record, {
				occupiedSlugs: new Set(["dragon-ball-nouveautes", "dragon-ball-nouveautes-source-53f8dbecd9"]),
			}).slug,
		).toBe("dragon-ball-nouveautes-source-53f8dbecd9-2");
	});

	test("normalizes slugs and classifies every imported source family", () => {
		expect(wikiSlug("  À l'ère de Gokû!  ", record.url)).toBe("a-l-ere-de-goku");
		expect(categoryForSource("publisher")).toEqual({ slug: "editeurs", name: "Éditeurs" });
		expect(categoryForSource("wayback")).toEqual({ slug: "archives", name: "Archives" });
		expect(categoryForSource("media")).toEqual({ slug: "medias", name: "Médias" });
		expect(categoryForSource("statistics")).toEqual({ slug: "statistiques", name: "Statistiques" });
	});

	test("requires an explicit bounded crawl window", () => {
		expect(parseOptions(["--since", "2026-09-16T00:00:00Z", "--limit", "25"])).toMatchObject({ limit: 25 });
		expect(() => parseOptions([])).toThrow("--since");
		expect(() => parseOptions(["--since", "not-a-date"])).toThrow("--since");
		expect(() => parseOptions(["--since", "2026-09-16T00:00:00Z", "--limit", "0"])).toThrow("--limit");
	});
});
