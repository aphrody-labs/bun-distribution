import { describe, expect, it, mock } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Sprint 4 — Contributor Detail Pages & Wiring", () => {
	it("la page index /wiki/contributeurs redirige vers /wiki/staff", () => {
		const filePath = join(process.cwd(), "apps/shenron/site/src/app/wiki/contributeurs/page.tsx");
		expect(existsSync(filePath)).toBe(true);
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain('redirect("/wiki/staff")');
	});

	it("la page de détail /wiki/contributeurs/[slug] existe et intègre les composants canoniques", () => {
		const filePath = join(process.cwd(), "apps/shenron/site/src/app/wiki/contributeurs/[slug]/page.tsx");
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
		const filePath = join(process.cwd(), "apps/shenron/site/src/app/wiki/staff/page.tsx");
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("buildUnifiedStaffCatalog");
		expect(content).toContain("UnifiedStaffExplorer");
		const catalog = readFileSync(join(process.cwd(), "apps/shenron/site/src/lib/unified-staff-catalog.ts"), "utf-8");
		expect(catalog).toContain("/wiki/staff#${va.slug}");
	});
});
