/**
 * Zone de statistiques d'une fiche personnage, ouverte à la contribution.
 *
 * Le champ est LIBRE : rien n'oblige à parler de ki, une fiche peut porter
 * « Santé » ou « Portée ». Le format d'échange est du texte (« Intitulé :
 * valeur » par ligne) parce que c'est ce qu'un contributeur sait écrire et ce
 * que le relecteur sait comparer — le jsonb reste un détail de stockage.
 */
import { describe, expect, test } from "bun:test";
import {
	estCibleStats,
	formatStats,
	fusionnerStats,
	parseStats,
	STATS_MAX,
} from "@/lib/stats-personnage";

describe("parseStats", () => {
	test("une mesure par ligne", () => {
		expect(parseStats("Ki : 8 000\nSanté : Excellente")).toEqual([
			{ label: "Ki", value: "8 000" },
			{ label: "Santé", value: "Excellente" },
		]);
	});

	test("liberté totale sur l'intitulé", () => {
		const r = parseStats("Groupe sanguin : AB\nPortée d'attaque : 3 km");
		expect(r.map((s) => s.label)).toEqual(["Groupe sanguin", "Portée d'attaque"]);
	});

	test("tolère les tirets de liste, les deux-points japonais et le signe égal", () => {
		expect(parseStats("- Ki ：9\n* Santé = Bonne")).toEqual([
			{ label: "Ki", value: "9" },
			{ label: "Santé", value: "Bonne" },
		]);
	});

	test("ignore les lignes vides et celles sans valeur", () => {
		expect(parseStats("\n  \nKi :\n: 9\nSanté : Bonne")).toEqual([
			{ label: "Santé", value: "Bonne" },
		]);
	});

	test("un intitulé répété ne crée pas de doublon — la dernière valeur gagne", () => {
		expect(parseStats("Ki : 1\nki : 2")).toEqual([{ label: "Ki", value: "2" }]);
	});

	test("le nombre de mesures est borné", () => {
		const texte = Array.from({ length: STATS_MAX + 5 }, (_, i) => `M${i} : ${i}`).join("\n");
		expect(parseStats(texte)).toHaveLength(STATS_MAX);
	});
});

describe("formatStats", () => {
	test("retour au texte, dans l'ordre", () => {
		expect(
			formatStats([
				{ label: "Ki", value: "8 000" },
				{ label: "Santé", value: "Bonne" },
			])
		).toBe("Ki : 8 000\nSanté : Bonne");
	});

	test("une valeur absente ne produit pas de ligne fantôme", () => {
		expect(formatStats([{ label: "Ki" }, { label: "Santé", value: "Bonne" }])).toBe(
			"Santé : Bonne"
		);
	});

	test("résiste à ce qui n'est pas un tableau", () => {
		for (const v of [null, undefined, "", 42, {}]) expect(formatStats(v)).toBe("");
	});

	test("aller-retour fidèle", () => {
		const texte = "Ki : 8 000\nSanté : Excellente";
		expect(formatStats(parseStats(texte))).toBe(texte);
	});
});

describe("fusionnerStats", () => {
	test("conserve l'accent d'une mesure qui existait déjà", () => {
		const r = fusionnerStats(parseStats("Ki : 9 000"), [
			{ label: "Ki", value: "8 000", accent: "cyan" },
		]);
		expect(r).toEqual([{ label: "Ki", value: "9 000", accent: "cyan" }]);
	});

	test("une mesure nouvelle n'invente pas d'accent", () => {
		expect(fusionnerStats(parseStats("Santé : Bonne"), [])).toEqual([
			{ label: "Santé", value: "Bonne" },
		]);
	});

	test("l'accent suit l'intitulé quelle que soit la casse", () => {
		const r = fusionnerStats(parseStats("ki : 9"), [{ label: "Ki", value: "8", accent: "red" }]);
		expect(r[0].accent).toBe("red");
	});
});

describe("estCibleStats", () => {
	test("ne vaut que pour la colonne stats d'un personnage", () => {
		expect(estCibleStats("db_characters", "stats")).toBe(true);
		expect(estCibleStats("db_characters", "article")).toBe(false);
		expect(estCibleStats("db_planets", "stats")).toBe(false);
	});
});
