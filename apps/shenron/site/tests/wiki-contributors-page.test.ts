import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

describe("Sprint 4 — Contributor Detail Pages & Wiring", () => {
	it("la page index /wiki/contributeurs redirige vers /wiki/staff", () => {
		const filePath = new URL("../src/app/wiki/contributeurs/page.tsx", import.meta.url).pathname;
		expect(existsSync(filePath)).toBe(true);
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain('redirect("/wiki/staff")');
	});

	it("la page de détail /wiki/contributeurs/[slug] existe et intègre les composants canoniques", () => {
		const filePath = new URL("../src/app/wiki/contributeurs/[slug]/page.tsx", import.meta.url).pathname;
		expect(existsSync(filePath)).toBe(true);
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("DomainBar");
		expect(content).toContain("WikiDrawer");
		expect(content).toContain("Breadcrumbs");
		expect(content).toContain("JsonLd");
		expect(content).toContain('slug === "akira-toriyama"');
		expect(content).toContain('redirect("/wiki/toriyama")');
		expect(content).toContain("contributorBySlug");
	});

	it("le hub staff rend le catalogue unifié et intègre le casting dans le hub", () => {
		const filePath = new URL("../src/app/wiki/staff/page.tsx", import.meta.url).pathname;
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("buildUnifiedStaffCatalog");
		expect(content).toContain("UnifiedStaffExplorer");
		const catalog = readFileSync(new URL("../src/lib/unified-staff-catalog.ts", import.meta.url).pathname, "utf-8");
		expect(catalog).toContain("/wiki/staff#${va.slug}");
	});
});
