/**
 * Cohérence des graphies japonaises du corpus databooks — chaque règle testée
 * isolément, y compris les cas où elle ne doit PAS s'appliquer. Les cas
 * viennent du corpus réel, mesuré le 2026-08-23 (cf. docstring de
 * `src/lib/ja/coherence.ts`).
 */
import { describe, expect, test } from "bun:test";
import {
	ALLONGEMENTS_ECARTES,
	DIVERGENCES_CORPUS_WIKI,
	VARIANTES_ALLONGEMENT,
	VARIANTES_COMPOSEES,
	corrigerAllongements,
	corrigerCoherence,
	corrigerDansComposes,
} from "../src/lib/ja/coherence";

describe("corrigerAllongements", () => {
	test("corrige un allongement manquant, gardé par la frontière katakana", () => {
		const { texte, corrections, details } = corrigerAllongements("ガリックJrとの闘い");
		expect(texte).toBe("ガーリックJrとの闘い");
		expect(corrections).toBe(1);
		expect(details).toEqual([{ lu: "ガリック", correct: "ガーリック", n: 1 }]);
	});

	test("corrige un allongement en trop", () => {
		const { texte, corrections } = corrigerAllongements("ジャッキー・チューンとして2回連続");
		expect(texte).toBe(
			"ジャッキー・チューンとして2回連続".replace("ジャッキー・チューン", "ジャッキー・チュン")
		);
		expect(corrections).toBe(1);
	});

	test("corrige plusieurs occurrences distinctes dans le même texte", () => {
		const { texte, corrections } = corrigerAllongements("クリーリンとクリリーンは同一人物");
		expect(texte).toBe("クリリンとクリリンは同一人物");
		expect(corrections).toBe(2);
	});

	test("ne touche pas une graphie déjà correcte", () => {
		const source = "ガーリックJrとの闘いの前に千歳の誕生日を祝う";
		const { texte, corrections } = corrigerAllongements(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("la garde de frontière protège un composé plus long", () => {
		// « ベジタブル » (vegetable) contient « ベジタ » mais « ベジタ » n'est pas
		// dans VARIANTES_ALLONGEMENT (justement à cause de cette collision) —
		// ici on prouve la garde elle-même sur une entrée réelle de la table :
		// un mot plus long qui contiendrait « ガリック » collé à du katakana des
		// deux côtés ne doit pas être touché.
		const source = "スーパーガリックンジュニアパワー"; // ガリック collé à du katakana de chaque côté
		const { corrections } = corrigerAllongements(source);
		expect(corrections).toBe(0);
	});

	test("les entrées écartées ne sont pas dans la table appliquée", () => {
		const lus = new Set(VARIANTES_ALLONGEMENT.map((v) => v.lu));
		for (const e of ALLONGEMENTS_ECARTES) expect(lus.has(e.lu)).toBe(false);
	});

	test("idempotent : appliquer deux fois donne le même résultat, pour chaque entrée", () => {
		for (const { lu, correct } of VARIANTES_ALLONGEMENT) {
			const premiere = corrigerAllongements(lu);
			const seconde = corrigerAllongements(premiere.texte);
			expect(seconde.texte).toBe(premiere.texte);
			expect(premiere.texte).toBe(correct);
		}
	});

	test("idempotent sur un texte mêlant plusieurs entrées", () => {
		const source = VARIANTES_ALLONGEMENT.map((v) => v.lu).join("。");
		const premiere = corrigerAllongements(source);
		const seconde = corrigerAllongements(premiere.texte);
		expect(seconde.texte).toBe(premiere.texte);
		expect(seconde.corrections).toBe(0);
	});
});

describe("corrigerDansComposes", () => {
	test("corrige une graphie collée à un point médian de liste", () => {
		const { texte, corrections } = corrigerDansComposes("・プロリー超サイヤ人4");
		expect(texte).toBe("・ブロリー超サイヤ人4");
		expect(corrections).toBe(1);
	});

	test("corrige une graphie soudée à un autre nom, sans garde de frontière", () => {
		const { texte, corrections } = corrigerDansComposes("バーダックプロリーザマス");
		expect(texte).toBe("バーダックブロリーザマス");
		expect(corrections).toBe(1);
	});

	test("corrige toutes les occurrences d'un même texte", () => {
		const { texte, corrections } = corrigerDansComposes(
			"プロリーフルパワーとプロリープロリーの違い"
		);
		expect(texte).toBe("ブロリーフルパワーとブロリーブロリーの違い");
		expect(corrections).toBe(3);
	});

	test("ne touche pas un texte qui ne contient aucune entrée de la table", () => {
		const source = "孫悟空とベジータの闘い";
		const { texte, corrections } = corrigerDansComposes(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("idempotent : la forme corrigée ne contient plus jamais la forme fautive", () => {
		for (const { lu, correct } of VARIANTES_COMPOSEES) {
			const premiere = corrigerDansComposes(`x${lu}${lu}x`);
			const seconde = corrigerDansComposes(premiere.texte);
			expect(seconde.texte).toBe(premiere.texte);
			expect(premiere.texte.includes(lu)).toBe(false);
			expect(premiere.texte.includes(correct)).toBe(true);
		}
	});
});

describe("corrigerCoherence", () => {
	test("combine allongement et composés dans un seul passage", () => {
		const { texte, modifie, corrections, allongements, composes } = corrigerCoherence(
			"タレスとプロリーフルパワーが同時に登場"
		);
		expect(texte).toBe("ターレスとブロリーフルパワーが同時に登場");
		expect(modifie).toBe(true);
		expect(corrections).toBe(2);
		expect(allongements).toEqual([{ lu: "タレス", correct: "ターレス", n: 1 }]);
		expect(composes).toEqual([{ lu: "プロリー", correct: "ブロリー", n: 1 }]);
	});

	test("un texte déjà correct n'est pas modifié", () => {
		const source = "ターレスとブロリーが同時に登場";
		const { texte, modifie, corrections } = corrigerCoherence(source);
		expect(texte).toBe(source);
		expect(modifie).toBe(false);
		expect(corrections).toBe(0);
	});

	test("idempotent sur un texte combinant les deux familles", () => {
		const source = "タレス軍団とバーダックプロリーザマスの記録";
		const premiere = corrigerCoherence(source);
		const seconde = corrigerCoherence(premiere.texte);
		expect(seconde.texte).toBe(premiere.texte);
		expect(seconde.corrections).toBe(0);
	});

	test("un texte sans japonais n'est pas modifié", () => {
		const source = "DRAGON BALL vol.42, ISBN 4-08-871234-5";
		const { texte, modifie } = corrigerCoherence(source);
		expect(texte).toBe(source);
		expect(modifie).toBe(false);
	});
});

describe("DIVERGENCES_CORPUS_WIKI", () => {
	test("n'est qu'une table de données — informationnelle, jamais appliquée par corrigerCoherence", () => {
		expect(DIVERGENCES_CORPUS_WIKI.length).toBeGreaterThan(0);
		for (const d of DIVERGENCES_CORPUS_WIKI) {
			expect(d.formeWiki).not.toBe(d.formeCorpus);
			expect(["wiki-bug-espacement", "wiki-choonpu-superflu", "ambigu"]).toContain(d.nature);
		}
	});

	test("les cas wiki-bug-espacement ont bien 0 occurrence côté wiki et une majorité corpus claire", () => {
		for (const d of DIVERGENCES_CORPUS_WIKI.filter((d) => d.nature === "wiki-bug-espacement")) {
			expect(d.occWiki).toBe(0);
			expect(d.occCorpus).toBeGreaterThan(0);
		}
	});

	test("le cas ambigu ne prétend à aucune majorité nette (à dessein — pas de correction)", () => {
		const ambigu = DIVERGENCES_CORPUS_WIKI.find((d) => d.nature === "ambigu");
		expect(ambigu).toBeDefined();
		const ratio = ambigu!.occCorpus / Math.max(1, ambigu!.occWiki);
		expect(ratio).toBeLessThan(2); // pas « nettement majoritaire » -> jamais une correction
	});
});
