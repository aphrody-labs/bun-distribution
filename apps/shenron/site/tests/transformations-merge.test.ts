import { describe, expect, it } from "bun:test";
import {
	TRANSFORMATION_CANONICAL_SLUGS,
	resolveTransformationParam,
} from "../src/lib/wiki-slugs";

describe("Fusion et cohérence des transformations canoniques", () => {
	it("résout tous les slugs canoniques majeurs sans redirection inutile", () => {
		const forms = [
			"super-saiyan",
			"super-saiyan-2",
			"super-saiyan-3",
			"super-saiyan-4",
			"super-saiyan-god",
			"super-saiyan-blue",
			"fusion-potara",
			"ultra-instinct",
			"ultra-ego",
			"beast",
			"transformation-par-absorption",
			"forme-finale",
			"golden-freezer",
			"black-freezer",
			"ozaru-grand-singe",
			"orange-piccolo",
			"potentiel-eveille-ultimate-gohan",
		];

		for (const slug of forms) {
			const res = resolveTransformationParam(slug);
			expect(res.canonicalSlug).toBe(slug);
			expect(res.isAlias).toBe(false);
		}
	});

	it("redirige les transformations similaires et proches fusionnées vers leur fiche canonique", () => {
		// Fusion Freezer : formes régressives et 100% -> forme finale
		expect(resolveTransformationParam("forme-regressive").canonicalSlug).toBe("forme-finale");
		expect(resolveTransformationParam("forme-100-full-power").canonicalSlug).toBe("forme-finale");
		expect(resolveTransformationParam("forme-100").canonicalSlug).toBe("forme-finale");
		expect(resolveTransformationParam("5eme-forme").canonicalSlug).toBe("forme-finale");

		// Fusion Fusion : Danse Métamol -> Fusion Potara / unifiée
		expect(resolveTransformationParam("fusion-metamol").canonicalSlug).toBe("fusion-potara");
		expect(resolveTransformationParam("metamol").canonicalSlug).toBe("fusion-potara");
		expect(resolveTransformationParam("potara").canonicalSlug).toBe("fusion-potara");
		expect(resolveTransformationParam("fusion").canonicalSlug).toBe("fusion-potara");

		// Fusion Super Saiyan Blue & Rosé
		expect(resolveTransformationParam("super-saiyan-rose").canonicalSlug).toBe("super-saiyan-blue");
		expect(resolveTransformationParam("ssj-rose").canonicalSlug).toBe("super-saiyan-blue");

		// Fusion Kyodaika / Gigantification -> Orange Piccolo
		expect(resolveTransformationParam("forme-geante").canonicalSlug).toBe("orange-piccolo");

		// Forme Mini -> Super Saiyan (fallback propre)
		expect(resolveTransformationParam("forme-mini").canonicalSlug).toBe("super-saiyan");
	});

	it("maintient la compatibilité avec les anciens identifiants numériques", () => {
		expect(TRANSFORMATION_CANONICAL_SLUGS[1]).toBe("super-saiyan");
		expect(TRANSFORMATION_CANONICAL_SLUGS[6]).toBe("super-saiyan-blue");
		expect(TRANSFORMATION_CANONICAL_SLUGS[8]).toBe("fusion-potara");
		expect(TRANSFORMATION_CANONICAL_SLUGS[15]).toBe("forme-finale");
		expect(TRANSFORMATION_CANONICAL_SLUGS[26]).toBe("orange-piccolo");
	});
});
