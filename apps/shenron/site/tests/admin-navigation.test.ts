import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const sidebar = await Bun.file(
	new URL("../../../../m3/packages/admin-ui/src/components/admin/AdminSidebar.tsx", import.meta.url)
).text();
const adminIndex = await Bun.file(new URL("../../../../m3/packages/admin-ui/src/app/admin/page.tsx", import.meta.url)).text();
const links = [...sidebar.matchAll(/href:\s*"(\/admin[^"]+)"/g)].map((match) => match[1]!);
const pages = [...new Bun.Glob("src/app/admin/**/page.tsx").scanSync(siteRoot)].map(
	(file) =>
		`/${file
			.replaceAll("\\", "/")
			.replace(/^src\/app\//, "")
			.replace(/\/page\.tsx$/, "")}`
);
const consolidatedIaRoutes = ["/admin/assistance-ia", "/admin/evaluations", "/admin/canon"];

describe("navigation administrateur", () => {
	test("ne contient aucun raccourci dupliqué", () => {
		expect(new Set(links).size).toBe(links.length);
	});

	test("rend chaque page admin atteignable depuis une rubrique", () => {
		const missing = pages.filter(
			(page) =>
				page !== "/admin" &&
				!consolidatedIaRoutes.includes(page) &&
				!links.some((href) => page === href || page.startsWith(`${href}/`))
		);
		expect(missing).toEqual([]);
	});

	test("consolide les anciens écrans IA dans le cockpit unique", async () => {
		const redirects = await Promise.all(
			consolidatedIaRoutes.map((route) =>
				Bun.file(new URL(`../../../../m3/packages/admin-ui/src/app${route}/page.tsx`, import.meta.url)).text()
			)
		);

		for (const source of redirects) expect(source).toContain("redirectToAdminIa");
		expect(links).toContain("/admin/ia");
		expect(links).not.toContain("/admin/assistance-ia");
		expect(links).not.toContain("/admin/evaluations");
		expect(links).not.toContain("/admin/canon");
	});

	test("redirige la racine admin vers le tableau de bord canonique", () => {
		expect(adminIndex).toContain('redirect("/admin/dashboard")');
	});
});
