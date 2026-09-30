import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(join(import.meta.dir, "..", "scripts", "audit-wiki-articles.ts"), "utf8");

describe("fact-check structurel des articles wiki", () => {
	test("couvre les tables éditoriales portant un article", () => {
		expect(script).toContain("ARTICLE_TABLES");
		expect(script).toContain("article_sources");
		expect(script).toContain("visible");
	});

	test("signale les risques sans modifier le contenu", () => {
		expect(script).toContain("missing_sources");
		expect(script).toContain("fan_wiki_reference");
		expect(script).toContain("speculation");
		expect(script).toContain("lecture seule");
		expect(script).toContain("process.exitCode = 1");
	});
});
