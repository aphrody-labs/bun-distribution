import { describe, expect, test } from "bun:test";
import {
	compacter,
	estCjk,
	extraitAutour,
	motsDe,
	normaliser,
	scorer,
	surlignerExtrait,
} from "../src/lib/manga-search-rules";

describe("normalisation", () => {
	test("accents et casse ne séparent plus deux graphies", () => {
		expect(normaliser("KAMÉHAMÉHA")).toBe("kamehameha");
		expect(compacter("KAMEHA-MEHA !")).toBe("kamehameha");
		expect(compacter("KAMEHAME HA")).toBe("kamehameha");
	});

	test("le japonais est détecté pour contourner les trigrammes", () => {
		expect(estCjk("かめはめ波")).toBe(true);
		expect(estCjk("kamehameha")).toBe(false);
		expect(estCjk("魔貫光殺砲")).toBe(true);
		expect(estCjk("クリリン")).toBe(true);
	});

	test("les mots d'une lettre sont ignorés", () => {
		expect(motsDe("Son Goku a un Kinto-Un")).toEqual(["son", "goku", "un", "kinto"]);
		expect(motsDe("A B C")).toEqual([]);
	});

	test("gestion de la ponctuation mixte et des guillemets français et japonais", () => {
		expect(compacter("« Kamehameha ! »")).toBe("kamehameha");
		expect(compacter("“Genki-Dama”")).toBe("genkidama");
		expect(compacter("「かめはめ波！」")).toBe("かめはめ波");
	});
});

describe("classement", () => {
	test("l'expression exacte passe devant la présence dispersée des mots", () => {
		const exact = scorer("Goku lance un KAMÉHAMÉHA sur Piccolo !", "kamehameha");
		const disperse = scorer("KAME HOUSE… HA HA ! MEHA ?", "kamehameha");
		expect(exact.exact).toBe(true);
		expect(exact.score).toBeGreaterThan(disperse.score);
	});

	test("une coupure de bulle de l'OCR reste une correspondance exacte", () => {
		expect(scorer("VOICI MON KAMEHAME HA !!", "kamehameha").exact).toBe(true);
		expect(scorer("PRENDS CE KA-ME-HA-ME-HA !", "kamehameha").exact).toBe(true);
		expect(scorer("PREPARE UN KAMEHAME\nHA FINAL !", "kamehameha").exact).toBe(true);
	});

	test("mots très courts : distinction stricte entre mot entier et sous-chaîne", () => {
		// En latin, une seule lettre ne doit pas scorer comme un match exact
		expect(scorer("Goku mange une pomme", "a").score).toBe(0);
		expect(scorer("Quelque chose", "x").exact).toBe(false);

		// Un mot court de 2 lettres comme "ki" ne doit pas matcher "kinto" par hasard
		const motExact = scorer("Son ki est gigantesque !", "ki");
		const motInclus = scorer("Goku monte sur son Kinto-Un", "ki");
		expect(motExact.exact).toBe(true);
		expect(motInclus.exact).toBe(false);
		expect(motExact.score).toBeGreaterThan(motInclus.score);
	});

	test("kanji/kana japonais d'un caractère", () => {
		// En japonais, un seul kanji est sémantique
		const kanji = scorer("亀仙人の修行", "亀");
		expect(kanji.exact).toBe(true);
		expect(kanji.score).toBeGreaterThan(50);

		const vague = scorer("かめはめ波を撃つ", "波");
		expect(vague.exact).toBe(true);
	});

	test("fautes de frappe : tolérance graduée selon la longueur du mot", () => {
		// Mot long (>= 8 lettres) : 2 fautes tolérées
		const longOk1 = scorer("Le GENKIDAMA de Goku frappe Boo", "genkidma"); // 1 faute
		const longOk2 = scorer("Le GENKIDAMA de Goku frappe Boo", "genkidaama"); // 1 insertion
		expect(longOk1.couverture).toBe(1);
		expect(longOk2.couverture).toBe(1);

		// Trop de fautes sur mot long : rejeté
		const tropDeFautes = scorer("Le GENKIDAMA de Goku frappe Boo", "genkixyzaa");
		expect(tropDeFautes.couverture).toBe(0);

		// Mot moyen (5 à 7 lettres) : 1 faute tolérée
		const moyenOk = scorer("Gohan repousse l'attaque", "gohn");
		expect(moyenOk.couverture).toBe(1);

		// Mot court (< 5 lettres) : 0 faute tolérée pour éviter le bruit
		const courtKo = scorer("Boo s'énerve", "buu");
		expect(courtKo.couverture).toBe(0);
	});

	test("une planche quasi vide est pénalisée", () => {
		const vide = scorer("GOKU", "goku");
		const dialogue = scorer("GOKU ! Reviens ici tout de suite, on n'a pas fini !", "goku");
		expect(dialogue.score).toBeGreaterThan(vide.score);
	});

	test("japonais : présence exacte requise ou couverture multi-segments", () => {
		expect(scorer("悟空のかめはめ波だ！", "かめはめ波").exact).toBe(true);
		expect(scorer("悟空だ！", "かめはめ波").score).toBe(0);

		// Multi-segment CJK
		const multi = scorer("孫悟空が叫ぶ。そしてかめはめ波を放った！", "孫悟空 かめはめ波");
		expect(multi.couverture).toBe(1);
		expect(multi.score).toBeGreaterThan(40);

		// Ponctuation japonaise tolérée dans la requête
		const avecPonct = scorer("「かめはめ波！」", "かめはめ波");
		expect(avecPonct.exact).toBe(true);
		const avecPonctInverse = scorer("かめはめ波", "「かめはめ波！」");
		expect(avecPonctInverse.exact).toBe(true);
	});

	test("frontières kana/kanji japonais et katakana composés", () => {
		const k1 = scorer("ピッコロの魔貫光殺砲が炸裂！", "魔貫光殺砲");
		expect(k1.exact).toBe(true);

		const k2 = scorer("フリーザ様、大変です！", "フリーザ");
		expect(k2.exact).toBe(true);

		const k3 = scorer("超サイヤ人に覚醒した孫悟空", "超サイヤ人 孫悟空");
		expect(k3.couverture).toBe(1);
	});

	test("requête vide ou ponctuation seule : score nul", () => {
		expect(scorer("n'importe quoi", "  ").score).toBe(0);
		expect(scorer("n'importe quoi", "??! «»").score).toBe(0);
		expect(scorer("n'importe quoi", "「」・").score).toBe(0);
	});
});

describe("extrait et centrage", () => {
	test("centré sur l'occurrence malgré les accents", () => {
		const long = `${"bla ".repeat(80)}Goku lance le KAMÉHAMÉHA final${" bla".repeat(80)}`;
		const e = extraitAutour(long, "kamehameha");
		expect(e).toContain("KAMÉHAMÉHA");
		expect(e.startsWith("…")).toBe(true);
	});

	test("centré avec des guillemets français dans la requête", () => {
		const long = `${"bla ".repeat(80)}Goku lance le KAMÉHAMÉHA final${" bla".repeat(80)}`;
		const e = extraitAutour(long, "« Kamehameha »");
		expect(e).toContain("KAMÉHAMÉHA");
		expect(e.startsWith("…")).toBe(true);
	});

	test("centré avec des guillemets japonais dans la requête", () => {
		const long = `${"bla ".repeat(80)}孫悟空の「かめはめ波」が炸裂した${" bla".repeat(80)}`;
		const e = extraitAutour(long, "「かめはめ波！」");
		expect(e).toContain("かめはめ波");
		expect(e.startsWith("…")).toBe(true);
	});

	test("requête fautive : centré sur le mot approché", () => {
		const long = `${"bla ".repeat(80)}GOKU PRÉPARE UN KAMEHAMEHA !${" bla".repeat(80)}`;
		expect(extraitAutour(long, "kamehameah")).toContain("KAMEHAMEHA");
	});

	test("sans occurrence, le début du texte", () => {
		expect(extraitAutour("Bulma et Son Goku", "vegeta")).toBe("Bulma et Son Goku");
	});
});

describe("surlignage des extraits (<mark>)", () => {
	test("mise en valeur exacte simple", () => {
		const texte = "Goku lance un KAMÉHAMÉHA sur Piccolo !";
		const res = surlignerExtrait(texte, "kamehameha");
		expect(res).toBe("Goku lance un <mark>KAMÉHAMÉHA</mark> sur Piccolo !");
	});

	test("mise en valeur avec coupure de bulle OCR", () => {
		const texte = "VOICI MON KAMEHAME HA !!";
		const res = surlignerExtrait(texte, "kamehameha");
		expect(res).toBe("VOICI MON <mark>KAMEHAME HA</mark> !!");
	});

	test("mise en valeur multi-mots contigus et fusion des balises", () => {
		const texte = "Je suis Son Goku, le Super Saiyan de la Terre !";
		const res = surlignerExtrait(texte, "Son Goku");
		expect(res).toContain("<mark>Son Goku</mark>");
	});

	test("mise en valeur en japonais (kanji et kana)", () => {
		const texte = "孫悟空のかめはめ波だ！";
		const res = surlignerExtrait(texte, "かめはめ波");
		expect(res).toBe("孫悟空の<mark>かめはめ波</mark>だ！");

		const multi = surlignerExtrait("孫悟空が叫ぶ。そしてかめはめ波を放った！", "孫悟空 かめはめ波");
		expect(multi).toContain("<mark>孫悟空</mark>");
		expect(multi).toContain("<mark>かめはめ波</mark>");
	});

	test("mise en valeur avec guillemets dans la requête", () => {
		const texte = "Il crie : KAMEHAMEHA !";
		const res = surlignerExtrait(texte, "« Kamehameha »");
		expect(res).toBe("Il crie : <mark>KAMEHAMEHA</mark> !");

		const jap = surlignerExtrait("悟空の必殺技はかめはめ波だ", "「かめはめ波！」");
		expect(jap).toBe("悟空の必殺技は<mark>かめはめ波</mark>だ");
	});

	test("extraitAutour avec option surligner: true", () => {
		const texte = "Son Goku prépare le KAMÉHAMÉHA final face à Freezer";
		const res = extraitAutour(texte, "kamehameha", { surligner: true });
		expect(res).toContain("<mark>KAMÉHAMÉHA</mark>");
	});
});
