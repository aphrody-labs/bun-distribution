/**
 * Thème de design global — cohérence entre l'éditeur et la feuille de style.
 *
 * `/admin/design` liste une couleur par clé de `THEME_COLOR_VARS` et injecte
 * `:root { --dbz-<x>: … }`. Si `globals.css` ne consomme pas cette variable,
 * le bouton existe mais ne repeint rien : une molette débranchée, invisible
 * depuis l'écran d'admin comme depuis le code.
 *
 * Le piège inverse a réellement eu lieu : les accents « braise / ki / ambre »
 * étaient écrits en dur (`#ff6b1a`, `rgba(75, 168, 255, .3)`, …) dans
 * `globals.css` et une quinzaine de composants, donc hors de portée de
 * l'éditeur, qui ne reskinait le site qu'à moitié.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SITE_THEME,
	THEME_COLORS,
	THEME_COLOR_VARS,
	isDefaultTheme,
	resolveSiteTheme,
	themeCssVars,
	type ThemeColorKey,
} from "../src/lib/site-theme";

// Les blocs @theme / :root partagés vivent dans @shenron/ui (styles.css), importé
// par globals.css : le rendu du site est la concaténation des deux feuilles.
const css = [
	await Bun.file(new URL("../src/app/globals.css", import.meta.url)).text(),
	await Bun.file(new URL("../../../../m3/packages/shenron-ui/src/styles.css", import.meta.url)).text(),
].join("\n");
const cles = Object.keys(THEME_COLOR_VARS) as ThemeColorKey[];

describe("tokens de thème", () => {
	test("chaque variable proposée à l'édition est consommée par globals.css", () => {
		const debranchees = cles.filter((k) => !css.includes(`var(${THEME_COLOR_VARS[k]},`));
		expect(debranchees).toEqual([]);
	});

	test("chaque clé a une valeur par défaut et une fiche d'édition", () => {
		for (const k of cles) {
			expect(DEFAULT_SITE_THEME.colors[k]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
		}
		expect(THEME_COLORS.map((c) => c.key).toSorted()).toEqual([...cles].toSorted());
	});

	test("les accents d'origine gardent leur valeur historique en défaut", () => {
		// Le rendu doit être strictement inchangé tant qu'aucun thème n'est posé.
		expect(DEFAULT_SITE_THEME.colors.ember).toBe("#ff6b1a");
		expect(DEFAULT_SITE_THEME.colors.ki).toBe("#4ba8ff");
		expect(DEFAULT_SITE_THEME.colors.amber).toBe("#ffd23f");
	});

	test("aucun littéral de la palette héritée ne subsiste hors définition de token", () => {
		const litteraux = css
			.split("\n")
			.filter((l) => !/--color-dbz-(ember|ki|amber):/.test(l) && !l.trimStart().startsWith("(`"))
			.filter((l) =>
				/#(ff6b1a|4ba8ff|ffd23f)|rgba\((255, *107, *26|75, *168, *255|255, *210, *63)/i.test(l)
			);
		expect(litteraux).toEqual([]);
	});
});

describe("resolveSiteTheme", () => {
	test("un thème enregistré avant l'ajout des accents reste valide", () => {
		// Cas réel : le document en base ne connaît que les 9 clés d'origine.
		const ancien = { version: 1, radius: 0.5, colors: { orange: "#00ff00" } };
		const t = resolveSiteTheme(ancien);
		expect(t.colors.orange).toBe("#00ff00");
		expect(t.colors.ember).toBe(DEFAULT_SITE_THEME.colors.ember);
		expect(isDefaultTheme(t)).toBe(false);
	});

	test("rejette une couleur non hexadécimale sans casser le reste", () => {
		const t = resolveSiteTheme({ colors: { ki: "javascript:alert(1)", amber: "#123456" } });
		expect(t.colors.ki).toBe(DEFAULT_SITE_THEME.colors.ki);
		expect(t.colors.amber).toBe("#123456");
	});

	test("n'injecte rien quand le thème est celui par défaut", () => {
		expect(themeCssVars(DEFAULT_SITE_THEME)).toBe("");
	});

	test("injecte toutes les variables dès qu'une couleur change", () => {
		const vars = themeCssVars(resolveSiteTheme({ colors: { ember: "#123456" } }));
		for (const k of cles) expect(vars).toContain(`${THEME_COLOR_VARS[k]}:`);
		expect(vars).toContain("--dbz-ember:#123456");
	});
});
