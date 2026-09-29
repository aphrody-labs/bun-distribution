import { describe, expect, it } from "bun:test";
import {
	formatCharacterSlug,
	formatPlanetSlug,
	formatTransformationSlug,
	resolveCharacterParam,
	resolvePlanetParam,
	resolveTransformationParam,
} from "@/lib/wiki-slugs";

describe("wiki-slugs", () => {
	it("génère des slugs canoniques et mondiaux pour les personnages majeurs", () => {
		expect(formatCharacterSlug({ id: 1, name: "Goku" })).toBe("son-goku");
		expect(formatCharacterSlug({ id: 2, name: "Vegeta" })).toBe("vegeta");
		expect(formatCharacterSlug({ id: 5, name: "Freezer" })).toBe("freezer");
		expect(formatCharacterSlug({ id: 9, name: "Celula" })).toBe("cell");
		expect(formatCharacterSlug({ id: 1146, name: "Son Goku (futur)" })).toBe("son-goku-futur");
		expect(formatCharacterSlug({ id: 1149, name: "Son Goku (Xeno)" })).toBe("son-goku-xeno");
	});

	it("génère des slugs formatés pour les versions libres", () => {
		expect(formatCharacterSlug({ id: 9999, name: "Trunks (futur)" })).toBe("trunks-futur");
		expect(formatCharacterSlug({ id: 9998, name: "Gohan (Daima)" })).toBe("gohan-daima");
		expect(formatCharacterSlug({ id: 9997, name: "Son Goku (GT)" })).toBe("son-goku-gt");
		expect(formatCharacterSlug({ id: 9996, name: "Vegeta (SDBH)" })).toBe("vegeta-sdbh");
	});

	it("résout les identifiants numériques hérités vers le slug canonique", () => {
		const res1 = resolveCharacterParam("1");
		expect(res1.id).toBe(1);
		expect(res1.canonicalSlug).toBe("son-goku");
		expect(res1.isLegacyNumericId).toBe(true);

		const res9 = resolveCharacterParam("9");
		expect(res9.id).toBe(9);
		expect(res9.canonicalSlug).toBe("cell");
		expect(res9.isLegacyNumericId).toBe(true);

		const res2 = resolveCharacterParam("2");
		expect(res2.id).toBe(2);
		expect(res2.canonicalSlug).toBe("vegeta");
		expect(res2.isLegacyNumericId).toBe(true);
	});

	it("résout les alias internationaux vers le slug canonique", () => {
		const resGoku = resolveCharacterParam("goku");
		expect(resGoku.id).toBe(1);
		expect(resGoku.canonicalSlug).toBe("son-goku");
		expect(resGoku.isAlias).toBe(true);

		const resFrieza = resolveCharacterParam("frieza");
		expect(resFrieza.id).toBe(5);
		expect(resFrieza.canonicalSlug).toBe("freezer");
		expect(resFrieza.isAlias).toBe(true);

		const resBuu = resolveCharacterParam("buu");
		expect(resBuu.id).toBe(32);
		expect(resBuu.canonicalSlug).toBe("majin-buu");
		expect(resBuu.isAlias).toBe(true);
	});

	it("la table canonique ne sert pas une autre fiche (régression 2026-09-12 : /broly → Dyspo)", () => {
		expect(resolveCharacterParam("broly").id).toBe(68);
		expect(resolveCharacterParam("whis").id).toBe(34);
		expect(resolveCharacterParam("beerus").id).toBe(208);
		expect(resolveCharacterParam("dende").id).toBe(21);
		expect(resolveCharacterParam("vegetto").id).toBe(66);
		expect(resolveCharacterParam("bardock").canonicalSlug).toBe("baddack");
		expect(resolveCharacterParam("plume").canonicalSlug).toBe("launch");
	});

	it("résout cosmologie et planètes", () => {
		expect(formatPlanetSlug({ id: 1, name: "Namek" })).toBe("namek");
		expect(formatPlanetSlug({ id: 2, name: "Terre" })).toBe("terre");
		expect(formatPlanetSlug({ id: 3, name: "Vegeta" })).toBe("planete-vegeta");

		const resEarth = resolvePlanetParam("earth");
		expect(resEarth.id).toBe(2);
		expect(resEarth.canonicalSlug).toBe("terre");
		expect(resEarth.isAlias).toBe(true);

		const resPlanetNum = resolvePlanetParam("1");
		expect(resPlanetNum.id).toBe(1);
		expect(resPlanetNum.canonicalSlug).toBe("namek");
		expect(resPlanetNum.isLegacyNumericId).toBe(true);
	});

	it("résout les transformations", () => {
		expect(formatTransformationSlug({ id: 1, name: "Super Saiyan" })).toBe("super-saiyan");
		expect(formatTransformationSlug({ id: 18, name: "Freezer Perfect Form (Golden)" })).toBe(
			"golden-freezer"
		);
		expect(formatTransformationSlug({ id: 21, name: "Super Saiyan Rosé 3" })).toBe(
			"super-saiyan-rose-3"
		);

		const resSsj = resolveTransformationParam("ssj");
		expect(resSsj.id).toBe(1);
		expect(resSsj.canonicalSlug).toBe("super-saiyan");
		expect(resSsj.isAlias).toBe(true);

		const resTransfoNum = resolveTransformationParam("1");
		expect(resTransfoNum.id).toBe(1);
		expect(resTransfoNum.canonicalSlug).toBe("super-saiyan");
		expect(resTransfoNum.isLegacyNumericId).toBe(true);
	});
});
