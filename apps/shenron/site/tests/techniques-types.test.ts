import { describe, expect, test } from "bun:test";
import { LIBELLES_TYPE, NOTE_PROVENANCE, estTypeDeJeu, libelleType } from "@/lib/techniques-types";

describe("libelleType", () => {
	test("traduit les quatre slots de compétence Xenoverse 2", () => {
		// Ce sont les seules valeurs mesurées en base : super 428, ultimate 211,
		// evasive 50, awoken 16.
		expect(libelleType("super")).toBe("Attaques spéciales");
		expect(libelleType("ultimate")).toBe("Attaques ultimes");
		expect(libelleType("evasive")).toBe("Esquives et déplacements");
		expect(libelleType("awoken")).toBe("Éveils et transformations");
	});

	test("n'imprime JAMAIS la valeur brute d'un slot connu", () => {
		// C'est le défaut corrigé : la fiche affichait « ultimate », en anglais,
		// comme si l'œuvre classait ainsi ses techniques.
		for (const brut of ["super", "ultimate", "evasive", "awoken"]) {
			expect(libelleType(brut)).not.toBe(brut);
		}
	});

	test("un type absent retombe sur « Capacité », pas sur « Autre »", () => {
		// 120 des 825 techniques n'ont pas de type ; les ranger sous une étiquette
		// de jeu qu'elles ne portent pas leur inventerait une provenance.
		expect(libelleType(null)).toBe("Capacité");
		expect(libelleType(undefined)).toBe("Capacité");
		expect(libelleType("   ")).toBe("Capacité");
	});

	test("une valeur inconnue est rendue telle quelle, pas avalée", () => {
		expect(libelleType("technique-de-combat")).toBe("technique-de-combat");
	});
});

describe("estTypeDeJeu", () => {
	test("vrai pour les slots Xenoverse, faux sinon", () => {
		expect(estTypeDeJeu("ultimate")).toBe(true);
		expect(estTypeDeJeu("evasive")).toBe(true);
		expect(estTypeDeJeu(null)).toBe(false);
		expect(estTypeDeJeu("")).toBe(false);
		expect(estTypeDeJeu("technique-de-combat")).toBe(false);
	});

	test("« Autre » n'est pas un slot de jeu — c'est le fourre-tout de l'index", () => {
		expect(estTypeDeJeu("Autre")).toBe(false);
		// Mais il reste dans le registre des libellés, que l'index utilise pour
		// nommer son groupe résiduel.
		expect(LIBELLES_TYPE.Autre).toBe("Non classées");
	});
});

describe("NOTE_PROVENANCE", () => {
	test("nomme le jeu, et dit que ce n'est pas une taxonomie de l'œuvre", () => {
		expect(NOTE_PROVENANCE).toContain("Xenoverse");
		expect(NOTE_PROVENANCE.toLowerCase()).toContain("pas une taxonomie");
	});
});
