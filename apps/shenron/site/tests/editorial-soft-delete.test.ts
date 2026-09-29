import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("suppression logique éditoriale", () => {
	test("les trois surfaces ne suppriment plus physiquement", async () => {
		const [reports, databooks, wiki] = await Promise.all([
			read("../src/app/api/admin/reports/route.ts"),
			read("../src/lib/databooks.ts"),
			read("../src/lib/wiki-admin.ts"),
		]);
		for (const source of [reports, databooks, wiki]) {
			expect(source).not.toMatch(/\.delete\s*\(/);
			expect(source).toContain("visible: false");
			expect(source).toContain("transaction(async");
			expect(source).toContain("wikiRevisions");
		}
	});

	test("les lectures publiques excluent les signalements masqués", async () => {
		const source = await read("../src/app/api/admin/reports/route.ts");
		expect(source).toContain("eq(siteReports.visible, true)");
		expect(source).toContain('action: "visibility"');
		expect(source).toContain('typeof body.visible === "boolean"');
	});

	test("le revert d'une suppression wiki restaure le snapshot avant", async () => {
		const [deletion, revisions] = await Promise.all([
			read("../src/lib/wiki-admin.ts"),
			read("../src/lib/wiki-revisions.ts"),
		]);
		expect(deletion).toContain('action: "visibility"');
		expect(revisions).toContain('rev.action === "visibility"');
		expect(revisions).toContain("setWikiVisibility(table, rowId, want)");
	});
});
