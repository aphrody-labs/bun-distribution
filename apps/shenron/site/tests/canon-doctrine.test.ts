/**
 * La doctrine de canonicité : résolution défensive du document stocké
 * (`resolveCanonConfig`) et verdicts rendus par le moteur (`analyzeCanon`).
 *
 * Ce que ces tests protègent, c'est la promesse de la page `/wiki/canon` : le
 * verdict sort d'une table écrite à la main dans `/admin/canon`, jamais d'une
 * source extérieure ni d'une génération. Deux régressions possibles :
 *
 *  - un document partiel ou corrompu venu de la base fait tomber la page ou,
 *    pire, efface silencieusement la doctrine ;
 *  - le moteur cesse de refléter ce qui est écrit en configuration (verdict
 *    figé dans le code, mot-clé apparié n'importe où).
 */
import { describe, expect, test } from "bun:test";
import {
	analyzeCanon,
	DEFAULT_CANON_CONFIG,
	referencesPour,
	resolveCanonConfig,
	type CanonConfig,
} from "../src/lib/canon-engine";

/** Deux citations du corpus, telles que le chargeur `.aphrody` les écrit. */
const CORPUS = [
	{
		id: "piccolo-favori",
		subject: "Piccolo : le personnage préféré de l'auteur",
		keywords: ["piccolo", "goku"],
		text: "Je suppose que j'aime Piccolo le plus après tout.",
		source: "Daizenshuu 2 : Story Guide (1995)",
		year: 1995,
		document: "toriyama_toriyama-interviews.md",
		lang: "fr",
		provenance: "aphrody",
	},
	{
		id: "tome-01",
		subject: "Tome 01 — Son Goku and Friends",
		keywords: ["goku"],
		text: "The setting of Dragon Ball has a sort of Chinese feel to it.",
		source: "Introductions des tankōbon",
		year: 1985,
		document: "toriyama_akira-toriyama-tankobon-introductions.md",
		lang: "en",
		provenance: "aphrody",
	},
];

describe("resolveCanonConfig", () => {
	test("un document vide rend la doctrine complète du dépôt", () => {
		const c = resolveCanonConfig({});
		expect(c.tiers).toHaveLength(5);
		expect(c.entries.length).toBe(DEFAULT_CANON_CONFIG.entries.length);
		expect(c.doctrine.length).toBeGreaterThan(0);
		expect(c.heuristics.length).toBe(DEFAULT_CANON_CONFIG.heuristics.length);
	});

	test("un document illisible ne casse rien", () => {
		for (const brut of [null, undefined, 42, "texte", []]) {
			expect(resolveCanonConfig(brut).tiers).toHaveLength(5);
		}
	});

	test("les cinq rangs restent présents même si la base n'en décrit qu'un", () => {
		const c = resolveCanonConfig({
			tiers: [{ id: "CANON_ABSOLU", court: "Manga pur", couleur: "#000000", score: 100 }],
		});
		expect(c.tiers).toHaveLength(5);
		expect(c.tiers[0]!.court).toBe("Manga pur");
		// Les champs non fournis retombent sur le défaut, jamais sur du vide.
		expect(c.tiers[0]!.definition).toBe(DEFAULT_CANON_CONFIG.tiers[0]!.definition);
		expect(c.tiers[1]!.court).toBe(DEFAULT_CANON_CONFIG.tiers[1]!.court);
	});

	test("un rang inconnu et une couleur invalide sont refusés", () => {
		const c = resolveCanonConfig({
			tiers: [{ id: "CANON_ABSOLU", couleur: "rouge; drop table" }],
			entries: [{ title: "Test", keywords: ["test"], tier: "CANON_INVENTE" }],
		});
		expect(c.tiers[0]!.couleur).toBe(DEFAULT_CANON_CONFIG.tiers[0]!.couleur);
		expect(c.entries[0]!.tier).toBe("EXTENSION_OFFICIELLE");
	});

	test("une entrée sans titre ou sans mot-clé est écartée, les identifiants restent uniques", () => {
		const c = resolveCanonConfig({
			entries: [
				{ title: "Broly", keywords: ["broly"] },
				{ title: "", keywords: ["vide"] },
				{ title: "Sans mot-clé", keywords: [] },
				{ title: "Broly", keywords: ["broli"] },
			],
		});
		expect(c.entries).toHaveLength(2);
		expect(c.entries[0]!.id).toBe("broly");
		expect(c.entries[1]!.id).toBe("broly-2");
	});

	test("effacer toutes les entrées est une décision respectée", () => {
		expect(resolveCanonConfig({ entries: [] }).entries).toHaveLength(0);
		// … mais une clé absente n'efface rien.
		expect(resolveCanonConfig({ intro: "x" }).entries.length).toBeGreaterThan(0);
	});

	test("les scores sont bornés à 0-100", () => {
		const c = resolveCanonConfig({
			entries: [
				{ title: "Trop", keywords: ["trop"], score: 900 },
				{ title: "Negatif", keywords: ["negatif"], score: -12 },
			],
		});
		expect(c.entries[0]!.score).toBe(100);
		expect(c.entries[1]!.score).toBe(0);
	});

	test("une citation sans texte est abandonnée plutôt que rendue vide", () => {
		const c = resolveCanonConfig({
			entries: [{ title: "X", keywords: ["x"], toriyamaQuote: { source: "Daizenshuu 6" } }],
		});
		expect(c.entries[0]!.toriyamaQuote).toBeUndefined();
	});
});

describe("analyzeCanon", () => {
	test("sans question, il invite au lieu de trancher", () => {
		const r = analyzeCanon("   ");
		expect(r.origine).toBe("empty");
		expect(r.score).toBe(0);
	});

	test("le verdict vient de la configuration passée, pas du code", () => {
		const config: CanonConfig = resolveCanonConfig({
			entries: [
				{
					title: "Broly",
					keywords: ["broly"],
					tier: "APOCRYPHE_FANON",
					score: 3,
					verdict: "Verdict écrit par l'administrateur.",
					explanation: "Explication écrite par l'administrateur.",
				},
			],
		});
		const r = analyzeCanon("Broly est-il canonique ?", config);
		expect(r.verdict).toBe("Verdict écrit par l'administrateur.");
		expect(r.tier).toBe("APOCRYPHE_FANON");
		expect(r.score).toBe(3);
		expect(r.origine).toBe("entry:broly");
	});

	test("chaque verdict rappelle les règles générales et la définition du rang", () => {
		const r = analyzeCanon("Dragon Ball GT est-il canon ?");
		expect(r.doctrineRules).toEqual(DEFAULT_CANON_CONFIG.doctrine);
		expect(r.tierDefinition).toBeTruthy();
	});

	test("les accents de la question n'empêchent pas la reconnaissance", () => {
		const r = analyzeCanon("Le Super Saiyan légendaire de Broly est-il canonique ?");
		expect(r.origine).toBe("entry:broly");
	});

	test("un mot-clé court ne s'apparie pas au milieu d'un autre mot", () => {
		// « gt » vit dans l'entrée Dragon Ball GT : « magtruc » ne doit rien déclencher.
		expect(analyzeCanon("magtruc").origine).toBe("fallback");
		expect(analyzeCanon("Dragon Ball GT").origine).toBe("entry:db-gt");
	});

	test("les familles de formulations servent de repli, pas de premier choix", () => {
		const r = analyzeCanon("Cet épisode est-il un filler ?");
		expect(r.origine).toBe("heuristic:production-toei");
		expect(r.tier).toBe("NON_CANON_DERIVE");
	});

	test("entre deux familles, la formulation la plus spécifique tranche", () => {
		// « chapitre » renvoie au manga original (rang 1) et est déclaré en
		// premier dans la table ; « filler » et « xenoverse » désignent du dérivé.
		// Le premier match l'emportait, ce qui rendait « canon absolu » sur du
		// contenu de jeu vidéo.
		const r = analyzeCanon("Ce chapitre filler de Xenoverse est-il canonique ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.origine).not.toBe("heuristic:manga-original");
	});

	test("un sujet inconnu est déclaré non établi, jamais tranché au hasard", () => {
		const r = analyzeCanon("Yamcha a battu le cuisinier secret dans une dimension inconnue.");
		expect(r.origine).toBe("fallback");
		expect(r.nature).toBe("verdict");
		expect(r.verdict).toBe(DEFAULT_CANON_CONFIG.fallback.verdict);
	});

	test("une vraie question hors doctrine est reçue comme question, sans rang inventé", () => {
		const r = analyzeCanon("Est-ce que Yamcha a battu le cuisinier secret dans une dimension inconnue ?");
		expect(r.origine).toBe("fallback");
		expect(r.nature).toBe("question");
		expect(r.tierLabel).toBe("Question ouverte");
	});

	test("un troll est nommé comme tel, avec des sujets tranchés en sortie", () => {
		for (const q of [
			"Goku vs Superman qui gagne ?",
			"le super saiyan 8 est canon",
			"ton site est de la merde",
			"qsdfgjklm wxcvbnhjk",
		]) {
			const r = analyzeCanon(q);
			expect(r.nature).toBe("troll");
			expect(r.origine.startsWith("troll:")).toBe(true);
			expect(r.score).toBe(0);
		}
		const ssj5 = analyzeCanon("Le Super Saiyan 5 existe-t-il ?");
		expect(ssj5.nature).toBe("verdict");
		expect(analyzeCanon("Broly est-il canon ?").suggestions.length).toBeGreaterThan(0);
	});

	test("le SSJ5 reste apocryphe — la rumeur fondatrice du site", () => {
		const r = analyzeCanon("Le Super Saiyan 5 existe-t-il ?");
		expect(r.tier).toBe("APOCRYPHE_FANON");
		expect(r.score).toBe(0);
	});
});

describe("citations du corpus", () => {
	const config = resolveCanonConfig({ references: CORPUS });

	test("une citation invalide est écartée, les bonnes sont conservées", () => {
		const c = resolveCanonConfig({
			references: [...CORPUS, { subject: "Sans texte", keywords: ["x"] }],
		});
		expect(c.references).toHaveLength(2);
		expect(c.references[0]!.lang).toBe("fr");
		expect(c.references[1]!.lang).toBe("en");
		expect(c.references[0]!.provenance).toBe("aphrody");
	});

	test("la citation la plus précise remonte en premier", () => {
		const trouvees = referencesPour("piccolo est-il le prefere de goku", config);
		expect(trouvees[0]!.id).toBe("piccolo-favori");
		expect(trouvees).toHaveLength(2);
	});

	test("un mot-clé de trois lettres ne suffit pas à faire remonter une citation", () => {
		const maigre = resolveCanonConfig({
			references: [{ ...CORPUS[0]!, id: "trop-court", keywords: ["ki"] }],
		});
		expect(referencesPour("le ki de sangoku", maigre)).toHaveLength(0);
	});

	test("le verdict emporte les citations du sujet", () => {
		const avecEntrees = resolveCanonConfig({
			entries: DEFAULT_CANON_CONFIG.entries,
			references: CORPUS,
		});
		const r = analyzeCanon("Piccolo est-il le personnage préféré de Toriyama ?", avecEntrees);
		expect(r.references?.[0]?.source).toContain("Daizenshuu 2");
	});

	test("sans corpus chargé, un verdict n'invente aucune citation", () => {
		expect(analyzeCanon("Broly est-il canonique ?").references).toHaveLength(0);
	});
});
