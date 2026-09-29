import { describe, expect, test } from "bun:test";
import { AMBIGUËS, graphiesDeRace, normaliserRace, slugDeRace } from "../src/lib/races-alias";

describe("slugDeRace", () => {
	test("rattache les graphies d'import aux races canoniques", () => {
		expect(slugDeRace("Terrienne (anciennement)")).toBe("human");
		expect(slugDeRace("Humains")).toBe("human");
		expect(slugDeRace("Androïde")).toBe("android");
		expect(slugDeRace("Ange (anciennement)")).toBe("angel");
		expect(slugDeRace("Glind (anciennement)")).toBe("kaioshin");
		expect(slugDeRace("Dieu de la Destruction")).toBe("god-of-destruction");
	});

	test("départage Nucleico sur le nom du personnage", () => {
		expect(slugDeRace("Nucleico benigno", "Kaïo Shin de l'Est")).toBe("kaioshin");
		expect(slugDeRace("Nucleico benigno", "Kibito")).toBe("kaioshin");
		expect(slugDeRace("Nucleico", "Kaito")).toBe("kaio");
	});

	test("refuse les graphies fourre-tout et les énumérations", () => {
		for (const graphie of Object.keys(AMBIGUËS)) expect(slugDeRace(graphie)).toBeNull();
		expect(slugDeRace("Terrien, Zombie, Humain artificiel")).toBeNull();
		expect(slugDeRace("Hybride Humain Artificiel/Machine Mutante")).toBeNull();
		expect(slugDeRace(null)).toBeNull();
	});

	test("une graphie n'est jamais à la fois rattachée et déclarée ambiguë", () => {
		for (const slug of ["human", "android", "angel", "kaioshin", "god-of-destruction"]) {
			for (const graphie of graphiesDeRace(slug)) {
				expect(AMBIGUËS[normaliserRace(graphie)]).toBeUndefined();
			}
		}
	});
});
