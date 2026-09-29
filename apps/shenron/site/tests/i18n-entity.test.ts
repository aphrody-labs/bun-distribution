import { describe, expect, test } from "bun:test";
import { localizedName, langOfName } from "@/lib/i18n/entity";
import { negotiateLocale, normalizeLocale } from "@/lib/i18n";
import fr from "../messages/fr.json";
import en from "../messages/en.json";
import ja from "../messages/ja.json";

const goku = { name: "Son Goku", nameJa: "孫悟空", nameRomaji: "Son Gokū" };

describe("localizedName", () => {
	test("fr : nom français, japonais en second", () => {
		expect(localizedName(goku, "fr")).toEqual({ primary: "Son Goku", secondary: "孫悟空" });
	});
	test("ja : japonais d'abord", () => {
		expect(localizedName(goku, "ja").primary).toBe("孫悟空");
	});
	test("en : Hepburn d'abord", () => {
		expect(localizedName(goku, "en").primary).toBe("Son Gokū");
	});
	test("sans japonais, on ne meuble pas", () => {
		expect(localizedName({ name: "Bulma" }, "ja")).toEqual({ primary: "Bulma", secondary: null });
	});
	test("lang attribute", () => {
		expect(langOfName(goku, "孫悟空")).toBe("ja");
		expect(langOfName(goku, "Son Gokū")).toBe("ja-Latn");
	});
});

describe("locales", () => {
	test("negotiateLocale", () => {
		expect(negotiateLocale("ja-JP,ja;q=0.9,en;q=0.8")).toBe("ja");
		expect(negotiateLocale("de-DE")).toBe("fr");
		expect(normalizeLocale("JP")).toBe("ja");
	});
	test("chaque langue porte toutes les clés du français", () => {
		const keys = (o: unknown, p = ""): string[] =>
			o && typeof o === "object"
				? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k))
				: [p];
		const ref = keys(fr);
		for (const [code, dico] of Object.entries({ en, ja })) {
			const missing = ref.filter((k) => !keys(dico).includes(k));
			expect({ code, missing }).toEqual({ code, missing: [] });
		}
	});
	test("aucun compteur écrit en dur dans les messages", () => {
		// Un volume (« 826 épisodes », « 1 300+ fiches ») se mesure en base ; un
		// nom propre chiffré, comme le jeu 2048, n'en est pas un.
		const COMPTEUR = /\d[\d\s.,]*\+|\b\d{2,}\s+\p{L}+s\b/u;
		for (const dico of [fr, en, ja]) expect(JSON.stringify(dico)).not.toMatch(COMPTEUR);
	});
});
