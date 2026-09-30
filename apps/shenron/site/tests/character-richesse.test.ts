import { describe, expect, test } from "bun:test";
import {
	POIDS,
	RICHESSE_MAX,
	comparerRichesse,
	scoreRichesse,
	type SignauxRichesse,
} from "@/lib/character-richesse";

const VIDE: SignauxRichesse = {
	longueurArticle: 0,
	longueurDescription: 0,
	longueurSections: 0,
	nbSections: 0,
	nbVariantes: 0,
	nbTransformations: 0,
	nbTechniques: 0,
	aNomJa: false,
	aRace: false,
	aKi: false,
	aPlaneteOrigine: false,
	imagePropre: false,
	aDebutEpisode: false,
	aDebutChapitre: false,
};

const avec = (p: Partial<SignauxRichesse>): SignauxRichesse => ({ ...VIDE, ...p });

describe("scoreRichesse", () => {
	test("une fiche sans rien vaut zéro", () => {
		expect(scoreRichesse(VIDE)).toBe(0);
	});

	test("ne dépasse jamais RICHESSE_MAX, même avec des signaux absurdes", () => {
		const enorme = avec({
			longueurArticle: 5_000_000,
			longueurDescription: 100_000,
			longueurSections: 5_000_000,
			nbSections: 900,
			nbVariantes: 900,
			nbTransformations: 900,
			nbTechniques: 900,
			aNomJa: true,
			aRace: true,
			aKi: true,
			aPlaneteOrigine: true,
			imagePropre: true,
			aDebutEpisode: true,
			aDebutChapitre: true,
		});
		expect(scoreRichesse(enorme)).toBe(RICHESSE_MAX);
	});

	test("l'article et les rubriques comptent dans le MÊME terme", () => {
		// Sinon une fiche pilotée par db_wiki_sections (266 personnages : l'article
		// n'y est pas rendu du tout) serait pénalisée face à une fiche à article.
		const parArticle = scoreRichesse(avec({ longueurArticle: 5_000 }));
		const parSections = scoreRichesse(avec({ longueurSections: 5_000 }));
		expect(parArticle).toBe(parSections);
	});

	test("le texte sature — deux fois plus long ne vaut pas deux fois mieux", () => {
		const court = scoreRichesse(avec({ longueurArticle: 20_000 }));
		const long = scoreRichesse(avec({ longueurArticle: 200_000 }));
		expect(court).toBe(POIDS.texteMax);
		expect(long).toBe(court);
	});

	test("les liens de technique pèsent peu — c'est un import de movesets de jeu", () => {
		// Whis porte 56 liens, plus que Goku : ce signal ne doit pas pouvoir
		// renverser un classement à lui seul.
		const beaucoupDeTechniques = scoreRichesse(avec({ nbTechniques: 56 }));
		const unPeuDArticle = scoreRichesse(avec({ longueurArticle: 2_000 }));
		expect(beaucoupDeTechniques).toBeLessThan(unPeuDArticle);
		expect(beaucoupDeTechniques).toBe(POIDS.techniqueMax);
	});

	test("chaque signal d'identité ajoute strictement quelque chose", () => {
		const base = scoreRichesse(VIDE);
		for (const cle of [
			"aNomJa",
			"aRace",
			"aKi",
			"aPlaneteOrigine",
			"imagePropre",
			"aDebutEpisode",
			"aDebutChapitre",
		] as const) {
			expect(scoreRichesse(avec({ [cle]: true }))).toBeGreaterThan(base);
		}
	});

	test("une fiche riche passe devant une fiche moissonnée", () => {
		const goku = avec({
			longueurArticle: 12_000,
			longueurDescription: 600,
			nbSections: 4,
			nbVariantes: 8,
			nbTransformations: 5,
			nbTechniques: 60,
			aNomJa: true,
			aRace: true,
			aKi: true,
			aPlaneteOrigine: true,
			aDebutChapitre: true,
		});
		const figurant = avec({ aNomJa: true, aRace: true });
		expect(scoreRichesse(goku)).toBeGreaterThan(scoreRichesse(figurant));
	});
});

describe("comparerRichesse", () => {
	test("classe la note décroissante", () => {
		const liste = [
			{ name: "Figurant", richesse: 3 },
			{ name: "Goku", richesse: 98 },
			{ name: "Yamcha", richesse: 40 },
		];
		expect([...liste].sort(comparerRichesse).map((c) => c.name)).toEqual([
			"Goku",
			"Yamcha",
			"Figurant",
		]);
	});

	test("à note égale, l'ordre est alphabétique et donc STABLE", () => {
		// Les ~400 fiches vides sont toutes à 0 : sans départage par le nom, la fin
		// de liste changerait d'ordre à chaque déploiement.
		const liste = [
			{ name: "Zalatz", richesse: 0 },
			{ name: "Bekoganof", richesse: 0 },
			{ name: "Navel", richesse: 0 },
		];
		expect([...liste].sort(comparerRichesse).map((c) => c.name)).toEqual([
			"Bekoganof",
			"Navel",
			"Zalatz",
		]);
	});

	test("une note absente vaut zéro plutôt que de faire échouer le tri", () => {
		const liste = [{ name: "Sans note" }, { name: "Goku", richesse: 50 }];
		expect([...liste].sort(comparerRichesse)[0]!.name).toBe("Goku");
	});

	test("départage accentué : le tri français, pas l'ordre des points de code", () => {
		const liste = [
			{ name: "Zabon", richesse: 0 },
			{ name: "Écureuil", richesse: 0 },
			{ name: "Abra", richesse: 0 },
		];
		expect([...liste].sort(comparerRichesse).map((c) => c.name)).toEqual([
			"Abra",
			"Écureuil",
			"Zabon",
		]);
	});
});
