/**
 * Le sélecteur de langue et les dictionnaires.
 *
 * Ce que ces tests protègent vient de deux défauts constatés à l'usage :
 *
 *  1. **« FR FR »** — le bouton affichait le drapeau ET le code de langue, soit
 *     la même information deux fois. Un drapeau n'est de toute façon pas une
 *     langue (le français n'est pas la France).
 *  3. **Deux sources pour un texte** — les dictionnaires vivaient en TypeScript
 *     ET en JSON ; ils ont divergé. `messages/*.json` est désormais la seule
 *     source, lue par next-intl comme par le contexte client.
 *  2. **Un sélecteur décoratif** — le dictionnaire existait, complet en trois
 *     langues, mais AUCUN composant ne l'importait : changer de langue posait un
 *     cookie, rechargeait la page, et rien ne bougeait. Le test le plus
 *     important ici est donc celui qui vérifie que l'interface consomme
 *     réellement le contexte de langue.
 */
import { describe, expect, test } from "bun:test";
import fr from "../messages/fr.json";
import ja from "../messages/ja.json";
import en from "../messages/en.json";
import { SUPPORTED_LOCALES, getDictionary, normalizeLocale } from "../src/lib/i18n";

const source = (chemin: string) => Bun.file(new URL(chemin, import.meta.url)).text();

const cles = (o: unknown, prefixe = ""): string[] =>
	typeof o === "object" && o !== null
		? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
				typeof v === "object" && v !== null ? cles(v, `${prefixe}${k}.`) : [`${prefixe}${k}`]
			)
		: [];

describe("dictionnaires", () => {
	test("les trois langues portent exactement les mêmes clés", () => {
		const attendu = cles(fr).toSorted();
		expect(cles(ja).toSorted()).toEqual(attendu);
		expect(cles(en).toSorted()).toEqual(attendu);
	});

	test("aucune valeur n'est vide ni recopiée du français par paresse", () => {
		for (const [nom, dico] of [
			["ja", ja],
			["en", en],
		] as const) {
			const valeurs = (o: unknown): string[] =>
				typeof o === "object" && o !== null
					? Object.values(o as Record<string, unknown>).flatMap((v) =>
							typeof v === "string" ? [v] : valeurs(v)
						)
					: [];
			const vides = valeurs(dico).filter((v) => !v.trim());
			expect(`${nom}: ${vides.length}`).toBe(`${nom}: 0`);
		}
		// « Épisodes » en japonais ne peut pas s'écrire comme en français.
		expect(ja.categories.episodes.label).not.toBe(fr.categories.episodes.label);
		expect(en.categories.episodes.label).not.toBe(fr.categories.episodes.label);
	});

	test("les entrées de navigation canoniques correspondent aux exigences", () => {
		expect(fr.nav.wiki).toBe("Wiki");
		expect(en.nav.wiki).toBe("Wiki");
		expect(ja.nav.wiki).toBe("大百科事典");

		expect(fr.nav.oeuvres).toBe("TV & Médias");
		expect(en.nav.oeuvres).toBe("TV & Media");
		expect(ja.nav.oeuvres).toBe("アニメ・映像");

		expect(fr.nav.archives).toBe("Manga & Guides");
		expect(en.nav.archives).toBe("Manga & Guides");
		expect(ja.nav.archives).toBe("原作漫画・公式ガイド");

		expect(fr.nav.communaute).toBe("Communauté");
		expect(en.nav.communaute).toBe("Community");
		expect(ja.nav.communaute).toBe("コミュニティ");

		expect(fr.nav.admin).toBe("Administration");
		expect(en.nav.admin).toBe("Admin");
		expect(ja.nav.admin).toBe("管理画面");
	});

	test("les codes de langue se normalisent, `jp` compris", () => {
		expect(normalizeLocale("jp")).toBe("ja");
		expect(normalizeLocale("JA-jp")).toBe("ja");
		expect(normalizeLocale("klingon")).toBe("fr");
		for (const l of SUPPORTED_LOCALES) expect(getDictionary(l)).toBeDefined();
	});
});

describe("sélecteur de langue", () => {
	test("n'affiche plus le drapeau ET le code (le « FR FR » d'origine)", async () => {
		const code = await source("../src/components/LanguageSwitcher.tsx");
		expect(code).not.toContain("current.flag");
		expect(code).not.toContain("info.flag");
	});

	test("ne recharge plus la page pour rien", async () => {
		const code = await source("../src/components/LanguageSwitcher.tsx");
		expect(code).not.toContain("window.location.reload");
	});

	test("change réellement la langue de l'interface", async () => {
		// Le sélecteur pilote un contexte, et la navigation le consomme : sans
		// cette chaîne, changer de langue ne fait rien de visible.
		for (const fichier of [
			"../src/components/LanguageSwitcher.tsx",
			"../src/components/NavMega.tsx",
			"../src/components/BarreNavMobile.tsx",
			"../src/components/CommandMenu.tsx",
			"../src/components/NavAuth.tsx",
		]) {
			expect(await source(fichier)).toContain("@/lib/i18n/client");
		}
		expect(await source("../src/app/layout.tsx")).toContain("<LocaleProvider>");
	});

	test("dit ce qu'il ne traduit pas", async () => {
		const code = await source("../src/components/LanguageSwitcher.tsx");
		expect(code).toContain("common.uiOnly");
		expect(fr.common.uiOnly).toContain("français");
	});
});
