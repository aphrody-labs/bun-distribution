import { describe, expect, test } from "bun:test";

import { safeReturnUrl } from "./auth-session";

/**
 * Migré de `apps/achillea-web/tests/auth-session.test.ts`.
 *
 * Le front Angular portait cette garde ; le portage vers Next l'avait perdue,
 * et `login(returnUrl)` transmettait la valeur brute à l'OAuth Discord. Ce
 * test est ce qui l'a révélé : la fonction n'existait plus côté site.
 */
describe("safeReturnUrl", () => {
	test("laisse passer un chemin interne", () => {
		expect(safeReturnUrl("/achillea/clans")).toBe("/achillea/clans");
		expect(safeReturnUrl("/achillea/ranked?onglet=historique")).toBe(
			"/achillea/ranked?onglet=historique"
		);
	});

	test("refuse une URL absolue", () => {
		expect(safeReturnUrl("https://exemple-malveillant.test/phish")).toBe("/achillea");
		expect(safeReturnUrl("http://exemple-malveillant.test")).toBe("/achillea");
	});

	test("refuse une URL protocole-relative, externe malgré son « / » initial", () => {
		expect(safeReturnUrl("//exemple-malveillant.test")).toBe("/achillea");
	});

	test("refuse les antislashs, que certains navigateurs normalisent en « / »", () => {
		expect(safeReturnUrl("/\\exemple-malveillant.test")).toBe("/achillea");
		expect(safeReturnUrl("\\\\exemple-malveillant.test")).toBe("/achillea");
	});

	test("refuse les caractères de contrôle, qui coupent l'en-tête de redirection", () => {
		expect(safeReturnUrl("/ok\nLocation: https://ailleurs.test")).toBe("/achillea");
		expect(safeReturnUrl("/ok\r\nSet-Cookie: a=b")).toBe("/achillea");
		expect(safeReturnUrl("/ok ")).toBe("/achillea");
	});

	test("refuse ce qui n'est pas une chaîne", () => {
		expect(safeReturnUrl(null)).toBe("/achillea");
		expect(safeReturnUrl(undefined)).toBe("/achillea");
		expect(safeReturnUrl(42)).toBe("/achillea");
		expect(safeReturnUrl({ toString: () => "/achillea" })).toBe("/achillea");
	});

	test("refuse une chaîne démesurée sans tenter de l'analyser", () => {
		expect(safeReturnUrl(`/${"a".repeat(3000)}`)).toBe("/achillea");
	});

	test("respecte le repli demandé", () => {
		expect(safeReturnUrl("https://ailleurs.test", "/")).toBe("/");
	});
});
