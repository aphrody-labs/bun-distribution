import { describe, expect, test } from "bun:test";
import {
	auditerPlanche,
	bruitOcrFr,
	defautCertain,
	indexerEntites,
	kanjiVersNombre,
	nombresDe,
	signalArtefactsConnus,
	signalCopie,
	signalJetons,
	signalMotsDoubles,
	signalNombresInventes,
	signalSourceBruitee,
	signalSousChaines,
	type EntreeLexique,
} from "../src/lib/databooks-audit-traductions";

/**
 * Les cas sont tirés des planches réellement corrompues le 2026-09-14 (et des
 * faux positifs écartés pendant la calibration) : chacun verrouille une mesure.
 */

const LEXIQUE: EntreeLexique[] = [
	{ ja: "亀仙人", fr: "Kamé Sennin", kind: "personnage" },
	{ ja: "セル", fr: "Cell", kind: "personnage" },
	{ ja: "パン", fr: "Pan (Xeno)", kind: "personnage" },
	{ ja: "アカ", fr: "Aca", kind: "personnage" },
	{ ja: "ナム", fr: "Nam", kind: "personnage" },
	{ ja: "セルジュニア", fr: "Cell Jr", kind: "personnage" },
	{ ja: "桃白白", fr: "Tao Pai Pai", kind: "personnage" },
	{ ja: "フリーザ", fr: "Freezer", kind: "personnage" },
	{ ja: "ベジータ", fr: "Vegeta", kind: "personnage" },
	{ ja: "ラディッツ", fr: "Raditz", kind: "personnage" },
	{ ja: "バーダック", fr: "Bardock", kind: "personnage" },
	{ ja: "ピッコロ", fr: "Piccolo", kind: "personnage" },
];
const INDEX = indexerEntites(LEXIQUE);

describe("nombres", () => {
	test("lit les numéraux kanji positionnels et à unités", () => {
		expect(kanjiVersNombre("二百五十七")).toBe(257);
		expect(kanjiVersNombre("三十六")).toBe(36);
		expect(kanjiVersNombre("一九九〇")).toBe(1990);
		expect(kanjiVersNombre("悟空")).toBeNull();
	});

	test("rassemble chiffres, pleine chasse, cerclés et kanji", () => {
		const n = nombresDe("◆1990年WJNo.１２其之二百五十七 ⑪ 集英社");
		expect([...n].toSorted((a, b) => a - b)).toEqual([11, 12, 257, 1990]);
	});

	test("un chapitre traduit en chiffres arabes n'est pas inventé", () => {
		const src = "◆1990年WJNo.6其之二百五十七\n◆1990年WJNo.3・4其之二百五十四\n◆1990年WJNo.10其之二百六十一";
		const fr = "◆ WJ n° 6 de 1990 — Chapitre 257\n◆ WJ n° 3-4 de 1990 — Chapitre 254\n◆ WJ n° 10 de 1990 — Chapitre 261";
		expect(signalNombresInventes(fr, src)).toBeNull();
	});

	test("des dates absentes de la source le sont (#18 p230, rédigée de mémoire)", () => {
		const src = "地獄地獄地獄のほかに、界王星に通しる蛇の道などがある。";
		const fr = "Date de diffusion : 17 octobre 1990. Épisode 63, 24 minutes, rediffusé en 1993.";
		expect(signalNombresInventes(fr, src)?.code).toBe("nombres-inventes");
	});
});

describe("défauts certains", () => {
	test("jeton de masquage non réinjecté (#24 p15 : 亀仙人 → Zêta010)", () => {
		const src = "チャランポランな武の達人！！\n亀仙人\nかめせんにん";
		const fr = "Maître des arts martiaux charanporan ! !\nZêta010\nKamesennin";
		const s = signalJetons(fr, src);
		expect(s?.certain).toBe(true);
		expect(s?.detail).toContain("Zêta010");
		expect(defautCertain(fr, src)?.code).toBe("jeton-masquage");
		expect(auditerPlanche({ fr, src }, INDEX).niveau).toBe("corrompu");
	});

	test("un sigle de produit n'est pas un jeton", () => {
		expect(signalJetons("Carte SH001 et BT3-001", "SH001 BT3-001")).toBeNull();
	});

	test("copie de la source japonaise", () => {
		const src = "孫悟空は界王拳を使った。";
		expect(signalCopie(src, src)?.certain).toBe(true);
		expect(defautCertain(src, src)?.code).toBe("copie-source");
	});

	test("une traduction saine n'a aucun défaut certain", () => {
		expect(defautCertain("Son Goku utilise le Kaiô-ken.", "孫悟空は界王拳を使った。")).toBeNull();
	});
});

describe("copie d'OCR français", () => {
	test("OCR bruité recopié : poids de quarantaine", () => {
		const ocr = "Grand}clash” avec)le/CommandantB } EN";
		expect(bruitOcrFr(ocr)).toBeGreaterThan(0.12);
		expect(signalCopie(ocr, ocr)?.poids).toBeGreaterThanOrEqual(6);
	});

	test("OCR propre recopié : simple signalement", () => {
		const ocr =
			"Voici l'illustration pour le jeu du « meilleur slogan des lecteurs » du Weekly Shonen Jump n° 23 de 1986. On retrouve leurs avions dans ce dessin.";
		expect(signalCopie(ocr, ocr)?.poids).toBeLessThan(3);
	});
});

describe("artefacts de substitution du lexique", () => {
	test("« Capsule Cell Corporation » et « Terre Terre »", () => {
		const s = signalArtefactsConnus("【Fabricant】 Capsule Cell Corporation, sur la Terre Terre");
		expect(s?.detail).toContain("Capsule Cell Corporation");
		expect(s?.detail).toContain("Terre Terre");
	});

	test("nom répété, sauf nom officiellement redoublé", () => {
		expect(signalMotsDoubles("la Terre Terre entière", "地球")?.code).toBe("mot-double");
		expect(signalMotsDoubles("le tueur Tao Pai Pai", "桃白白", INDEX.reduplicatifs)).toBeNull();
		expect(signalMotsDoubles("non non, pas ça", "")).toBeNull();
	});

	test("entrée courte découpée dans un mot : formes exotiques multiples → lourd", () => {
		const src = "株式会社パンダイナムコ／アカデミー";
		const fr = "Pan (Xeno) dai Nam co / Aca démie";
		const s = signalSousChaines(fr, src, INDEX.courtes, INDEX.longues);
		expect(s?.poids).toBeGreaterThanOrEqual(6);
	});

	test("un seul nom réel dans un composé reste léger (« Cell Game » pour セルゲーム)", () => {
		const s = signalSousChaines("Le Cell Game commence", "セルゲーム開幕", INDEX.courtes, INDEX.longues);
		expect(s?.poids).toBeLessThan(3);
	});

	test("occurrence couverte par une entrée plus longue : légitime", () => {
		expect(signalSousChaines("Cell Jr attaque", "セルジュニアが攻撃", INDEX.courtes, INDEX.longues)).toBeNull();
	});
});

describe("source inexploitable", () => {
	test("bruit d'OCR traduit mot à mot (#36 p135) → corrompu", () => {
		const src = "的\nあ\n无\nそ\nそ\n面\n六元\nな\n中\n如\n千\nTOTO";
		const fr = "cible\nAh\nNon\nCela\nCela\nvisage\nSix yuans\nNa\nMoyen\nComme\nmille\nTOTO";
		expect(signalSourceBruitee(fr, src)?.poids).toBeGreaterThanOrEqual(6);
		expect(auditerPlanche({ fr, src }, INDEX).niveau).toBe("corrompu");
	});

	test("grille de carte traduite étiquette par étiquette (#13 p10) → pas de quarantaine", () => {
		const src = "BP\n攻守\nマ\n裏\nサ\n星\n\n600\n500\n100\n魔\n必\n罠\n5";
		const fr = "BP\nAttaque-Défense\nMarque\nVerso\nScouteur\nÉtoiles :\n600\n500\n100\nDémon\nSpécial\nPiège\n5";
		expect(auditerPlanche({ fr, src }, INDEX).niveau).not.toBe("corrompu");
	});

	test("lecture partielle honnête d'une source bruitée (#36 p67) → pas de quarantaine", () => {
		const src = "保的\n回\nにぎりめし\nらった!!\nも\nな\n公\n经\n中\n元\nそ\n天";
		expect(auditerPlanche({ fr: "J'ai eu des boulettes de riz !!", src }, INDEX).niveau).not.toBe("corrompu");
	});
});

describe("verdict", () => {
	test("traduction fidèle → sain", () => {
		const src = "クリリンを殺され、激しい怒りを覚える悟空。フリーザがピッコロを瀕死に追いやる。ベジータも倒れた。";
		const fr = "Goku ressent une colère intense après la mort de Krilin. Freezer pousse Piccolo au bord de la mort. Vegeta est tombé lui aussi.";
		expect(auditerPlanche({ fr, src }, INDEX).niveau).toBe("sain");
	});

	test("un verdict relu sur le scan s'ajoute et suffit", () => {
		const v = auditerPlanche(
			{ fr: "Texte plausible.", src: "地獄のほかに、界王星に通しる蛇の道などがある。", extras: [{ code: "relu-scan", poids: 10, certain: true, detail: "scan" }] },
			INDEX
		);
		expect(v.niveau).toBe("corrompu");
	});
});
