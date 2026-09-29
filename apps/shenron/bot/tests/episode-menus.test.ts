import { describe, expect, test } from "bun:test";
import {
	cleMenu,
	construireMenusEpisodes,
	estMenuEpisodes,
	libelleEpisode,
	lireCustomIdMenu,
	lireValeurEpisode,
	MAX_EPISODES_PAR_MESSAGE,
	OPTIONS_PAR_MENU,
	PREFIXE_MENU_EPISODES,
	type EpisodePourMenu,
} from "~/lib/episode-menus";

/** Un lot d'épisodes numérotés 1..n, comme une saga en base. */
function lot(n: number, depart = 1): EpisodePourMenu[] {
	return Array.from({ length: n }, (_, i) => ({
		id: depart + i,
		numero: depart + i,
		titre: `Titre ${depart + i}`,
	}));
}

describe("construireMenusEpisodes", () => {
	test("un lot court tient dans un seul menu", () => {
		const menus = construireMenusEpisodes(12, lot(10));
		expect(menus).toHaveLength(1);
		expect(menus[0]!.options).toHaveLength(10);
		expect(menus[0]!.customId).toBe(`${PREFIXE_MENU_EPISODES}:12:0`);
		expect(menus[0]!.placeholder).toBe("Choisis un épisode");
		expect(menus[0]!.options[0]).toEqual({ label: "Épisode 1 — Titre 1", value: "1" });
	});

	test("découpe par tranches de 25 et borne à 5 menus", () => {
		const menus = construireMenusEpisodes("saga", lot(140));
		expect(menus).toHaveLength(5);
		expect(menus.every((m) => m.options.length === OPTIONS_PAR_MENU)).toBe(true);
		// Les épisodes au-delà de 125 ne sont pas proposés : un message n'accepte
		// pas plus de cinq rangées.
		expect(menus.flatMap((m) => m.options)).toHaveLength(MAX_EPISODES_PAR_MESSAGE);
		expect(menus.at(-1)!.options.at(-1)!.value).toBe("125");
	});

	test("le placeholder annonce les bornes dès qu'il y a plusieurs menus", () => {
		const menus = construireMenusEpisodes("saga", lot(30));
		expect(menus[0]!.placeholder).toBe("Épisodes 1 à 25");
		expect(menus[1]!.placeholder).toBe("Épisodes 26 à 30");
	});

	test("le placeholder retombe sur le rang quand les numéros manquent", () => {
		const sansNumero = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, titre: "x" }));
		const menus = construireMenusEpisodes("films", sansNumero);
		expect(menus[0]!.placeholder).toBe("Épisodes 1 à 25");
		expect(menus[1]!.placeholder).toBe("Épisodes 26 à 30");
		expect(menus[0]!.options[0]!.label).toBe("Épisode — x");
	});

	test("libellé et description sont tronqués aux plafonds de Discord", () => {
		const menus = construireMenusEpisodes(1, [
			{ id: 7, numero: 7, titre: "T".repeat(300), description: "D".repeat(300) },
		]);
		const option = menus[0]!.options[0]!;
		expect(option.label).toHaveLength(100);
		expect(option.label.endsWith("…")).toBe(true);
		expect(option.description).toHaveLength(100);
	});

	test("une description vide n'est pas émise du tout", () => {
		const menus = construireMenusEpisodes(1, [{ id: 3, numero: 3, titre: "a", description: "  " }]);
		expect(menus[0]!.options[0]).not.toHaveProperty("description");
	});

	test("les valeurs en double sont écartées — Discord refuse le menu sinon", () => {
		const menus = construireMenusEpisodes(1, [
			{ id: 5, numero: 5 },
			{ id: 5, numero: 5 },
			{ id: 6, numero: 6 },
		]);
		expect(menus[0]!.options.map((o) => o.value)).toEqual(["5", "6"]);
	});

	test("un lot vide ne produit aucun menu", () => {
		expect(construireMenusEpisodes("vide", [])).toEqual([]);
	});

	test("le custom_id reste sous les 100 signes et sans séparateur parasite", () => {
		const menus = construireMenusEpisodes("Saga : Freezer / Namek !", lot(3));
		expect(menus[0]!.customId).toBe(`${PREFIXE_MENU_EPISODES}:saga-freezer-namek:0`);
		expect(menus[0]!.customId.length).toBeLessThanOrEqual(100);
	});
});

describe("encodage du custom_id et des valeurs", () => {
	test("aller-retour", () => {
		const menus = construireMenusEpisodes(42, lot(30));
		for (const [rang, menu] of menus.entries()) {
			expect(estMenuEpisodes(menu.customId)).toBe(true);
			expect(lireCustomIdMenu(menu.customId)).toEqual({ cle: "42", page: rang });
		}
	});

	test("un custom_id étranger n'est jamais réclamé", () => {
		expect(estMenuEpisodes("shop:category")).toBe(false);
		expect(lireCustomIdMenu("shop:category")).toBeNull();
		expect(lireCustomIdMenu(`${PREFIXE_MENU_EPISODES}:saga`)).toBeNull();
		expect(lireCustomIdMenu(`${PREFIXE_MENU_EPISODES}:saga:x`)).toBeNull();
	});

	test("la valeur d'option est un identifiant d'épisode, ou rien", () => {
		expect(lireValeurEpisode("826")).toBe(826);
		expect(lireValeurEpisode(" 12 ")).toBe(12);
		expect(lireValeurEpisode("0")).toBeNull();
		expect(lireValeurEpisode("saga:3")).toBeNull();
		expect(lireValeurEpisode("")).toBeNull();
	});

	test("cleMenu ne rend jamais une clé vide", () => {
		expect(cleMenu("!!!")).toBe("lot");
		expect(cleMenu(7)).toBe("7");
	});

	test("libelleEpisode se passe de titre", () => {
		expect(libelleEpisode({ id: 1, numero: 3 })).toBe("Épisode 3");
	});
});
