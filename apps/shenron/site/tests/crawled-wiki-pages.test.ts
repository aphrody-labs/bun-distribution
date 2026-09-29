import { describe, expect, test } from "bun:test";
import {
	CRAWLED_CATEGORIES,
	crawledCategoryId,
	crawledPageKey,
	decodeCrawledPageBody,
	decodeCrawledPageTitle,
	hasEditorialLabel,
	renderCrawledPage,
	withEditorialLabel,
} from "../scripts/_crawled-wiki-pages";

const record = {
	url: "https://example.org/interview-toriyama",
	kind: "reference",
	title: "Interview *Toriyama* [1995]",
	excerpt: "Line one\nline two <b>",
	httpStatus: 200,
	fetchedAt: "2026-09-17T09:46:35.000Z",
};

describe("crawled wiki pages", () => {
	test("identity is derived from the URL only", () => {
		const key = crawledPageKey(record.url);
		expect(key.id).toMatch(/^source_[0-9a-f]{20}$/);
		expect(key.slug).toBe(key.id.replace("source_", "source-"));
		expect(crawledPageKey(record.url)).toEqual(key);
	});

	test("classification is typed and never falls back to the root category", () => {
		expect(crawledCategoryId({ ...record, kind: "media" })).toBe("cat_crawled_media");
		expect(crawledCategoryId({ ...record, kind: "statistics" })).toBe("cat_crawled_stats");
		expect(crawledCategoryId({ ...record, kind: "archive" })).toBe("cat_crawled_archives");
		expect(crawledCategoryId(record)).toBe("cat_crawled_interviews");
		expect(crawledCategoryId({ ...record, url: "https://x.org/a", title: "Daizenshuu 7", excerpt: "" })).toBe("cat_crawled_guides");
		expect(crawledCategoryId({ ...record, url: "https://x.org/a", title: "Autre", excerpt: "" })).toBe("cat_crawled_references");
		const ids = new Set(CRAWLED_CATEGORIES.map((category) => category.id));
		for (const kind of ["media", "statistics", "archive", "reference"]) expect(ids.has(crawledCategoryId({ ...record, kind }))).toBe(true);
	});

	test("rendered page is sanitized, attributed and already carries its editorial label", () => {
		const page = renderCrawledPage(record);
		expect(page.title).toBe("Interview Toriyama 1995");
		expect(page.category.id).toBe("cat_crawled_interviews");
		expect(page.body).toContain("ne constitue pas une assertion canonique");
		expect(page.body).toContain(`- **Document d'origine :** ${record.url}`);
		expect(page.body).toContain("Line one line two b");
		expect(hasEditorialLabel(page.body, page.category.name)).toBe(true);
	});

	test("entities are decoded once at render time, URLs and markdown stay inert", () => {
		const page = renderCrawledPage({
			...record,
			url: "https://ja.wikipedia.org/wiki/Expo&amp;Linimo.jpg",
			title: "Press Archive | Shonen Jump (July 2003): &quot;The Legacy Continues on GBA…&quot;",
			excerpt: "Q&amp;A &#x27;Z&#x27; &lt;b&gt;gras&lt;/b&gt; &#42;x&#42; voir https://x.test/?a=1&amp;b=2 &amp;amp;",
		});
		expect(page.title).toBe('Press Archive | Shonen Jump (July 2003): "The Legacy Continues on GBA…"');
		expect(page.body).toContain(`# ${page.title}\n`);
		expect(page.body).toContain("Q&A 'Z' bgras/b x voir https://x.test/?a=1&amp;b=2 &amp;");
		expect(page.body).toContain("- **Document d'origine :** https://ja.wikipedia.org/wiki/Expo&amp;Linimo.jpg");
		// Identity still hashes the URL exactly as stored, never a decoded variant.
		expect(page.id).toBe(crawledPageKey("https://ja.wikipedia.org/wiki/Expo&amp;Linimo.jpg").id);
	});

	test("repair of a page rendered before decoding matches a fresh render", () => {
		const raw = {
			...record,
			title: "Translations | Dragon Box Z Volume 1 - &quot;Z&quot; Staff and Cast Q&amp;A",
			excerpt: "Victory Asada&#039;s Road &bull; 1989&#8211;1996 &ldquo;Pok&eacute;mon&rdquo; &lt;i&gt;",
		};
		// What the pre-fix renderer stored: identical pipeline, no decoding.
		const legacyText = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>]/g, "").replace(/\s+/g, " ").trim();
		const fresh = renderCrawledPage(raw);
		const legacyTitle = legacyText(raw.title);
		const legacyBody = fresh.body.replace(fresh.title, legacyTitle).replace(/## Extrait collecté\n\n.*\n/, `## Extrait collecté\n\n${legacyText(raw.excerpt)}\n`);
		expect(legacyBody).not.toBe(fresh.body);
		expect(decodeCrawledPageTitle(legacyTitle)).toBe(fresh.title);
		expect(decodeCrawledPageBody(legacyBody)).toBe(fresh.body);
	});

	test("repair is a fixed point on decoded pages and keeps the origin URL", () => {
		const page = renderCrawledPage({ ...record, url: "https://x.test/?a=1&amp;b=2", title: "A &amp; B" });
		expect(decodeCrawledPageTitle(page.title)).toBe(page.title);
		expect(decodeCrawledPageBody(page.body)).toBe(page.body);
		expect(decodeCrawledPageTitle("&nbsp;")).toBe("Document collecté");
		expect(decodeCrawledPageTitle("Sans entité &Peace;")).toBe("Sans entité &Peace;");
	});

	test("editorial label is idempotent and replaceable", () => {
		const page = renderCrawledPage(record);
		expect(withEditorialLabel(page.body, page.category.name)).toBe(page.body);
		const moved = withEditorialLabel(page.body, "Sources collectées — Guides et articles");
		expect(moved.match(/## Classement éditorial/g)).toHaveLength(1);
		expect(hasEditorialLabel(moved, page.category.name)).toBe(false);
	});
});
