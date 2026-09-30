/**
 * Générations déraillées — chaque règle testée isolément, avec les cas où elle
 * ne doit **PAS** s'appliquer : mises en page légitimes du corpus qu'une règle
 * un cran trop large détruirait. Tous les cas, positifs comme négatifs, sont
 * repris du corpus réel mesuré le 2026-08-25 (11 255 planches transcrites).
 */
import { describe, expect, test } from "bun:test";
import {
	blocBoucleEnInterne,
	corrigerGenerationsDeraillees,
	couperBouclesDegenerees,
	estBoucleDegeneree,
	plusLongueBoucle,
	segmentUniforme,
	supprimerBlocsHallucinesRepetes,
} from "../src/lib/databooks-ocr/generations-deraillees";

const repeter = (motif: string, n: number) => motif.repeat(n);

describe("couperBouclesDegenerees — motif long", () => {
	test("garde le préfixe et une occurrence du motif (#12 p.85, période 7 ×167)", () => {
		const prefixe = "激闘！\n\n逆転また逆転!!\n\n最強の超人力人気ビデオ game で、";
		const source = prefixe + repeter("超人力の力で、", 167);
		const { texte, corrections } = couperBouclesDegenerees(source);
		expect(corrections).toBe(1);
		// La tête conservée est un préfixe LITTÉRAL du texte d'origine, et
		// une occurrence ENTIÈRE du motif y survit : le préfixe se termine par
		// « で、 », les deux mêmes signes que la fin du motif, donc la zone
		// périodique commence deux signes avant le motif — c'est le report
		// « longueur % periode » qui évite que la soudure tombe au milieu.
		expect(texte).toBe(
			"激闘！\n\n逆転また逆転!!\n\n最強の超人力人気ビデオ game で、超人力の力で、"
		);
		expect(source.startsWith(texte)).toBe(true);
	});

	test("recolle ce qui suit la boucle — le modèle se remet parfois à lire", () => {
		const source = `冒頭の文は「${repeter("同じ断片を繰り返す。", 12)}最後の文。`;
		expect(couperBouclesDegenerees(source).texte).toBe(
			"冒頭の文は「同じ断片を繰り返す。最後の文。"
		);
	});

	test("ce qui est retiré est un multiple entier de la période", () => {
		const source = `前置きの文。${repeter("繰り返される断片。", 31)}`;
		const { texte, coupes } = couperBouclesDegenerees(source);
		expect((source.length - texte.length) % coupes[0].periode).toBe(0);
	});

	test("ne touche pas un motif long répété 6 fois (grille de tournoi, #2 p.223)", () => {
		const source = repeter("\n\n## ジヤロベーvsシェン\n\nパ Full\n101", 6);
		expect(couperBouclesDegenerees(source).corrections).toBe(0);
	});

	test("le seuil est bien à 10 répétitions, pas 9", () => {
		const motif = "の名前で、その名前は";
		expect(couperBouclesDegenerees(repeter(motif, 9)).corrections).toBe(0);
		expect(couperBouclesDegenerees(repeter(motif, 10)).corrections).toBe(1);
	});
});

describe("couperBouclesDegenerees — motif court", () => {
	test("coupe une génération partie jusqu'à sa limite (#259 p.24, ？！ ×4060)", () => {
		const prefixe =
			"全宇宙最强の\n「DB」情報読者ページ！！\nグッズも！！ ゲームも！！ もらんハガキも！！ ハガキ";
		const { texte, corrections } = couperBouclesDegenerees(prefixe + repeter("？！", 4060));
		expect(corrections).toBe(1);
		expect(texte).toBe(`${prefixe}？！`);
	});

	test("ne touche pas un séparateur de tableau markdown (#159 p.13, |--- ×11)", () => {
		const source = `| 技 | 使い手 |\n|${repeter("---|", 11)}\n| かめはめ波 | 悟空 |`;
		expect(couperBouclesDegenerees(source).corrections).toBe(0);
	});

	test("un motif court très répété mais noyé dans du texte est épargné (couverture < 60 %)", () => {
		const remplissage =
			"孫悟空は幼いころ、祖父の孫悟飯に育てられた。paozu 山の奥深くで、如意棒と四星球だけを頼りに暮らしていた。ブルマと出会い、七つのドラゴンボールを探す旅に出るまで、外の世界をまったく知らなかったのである。";
		expect(couperBouclesDegenerees(`${repeter("おお", 25)}${remplissage}`).corrections).toBe(0);
	});
});

describe("segmentUniforme — la garde qui sauve la typographie", () => {
	test("un signe unique répété n'est jamais une boucle", () => {
		// Piège : une suite de signes identiques est périodique pour TOUTES les
		// périodes, donc elle ressort aussi en période 2 — borner la période à 2
		// ne suffit pas, c'est `segmentUniforme` qui la sauve.
		expect(couperBouclesDegenerees(repeter("ー", 200)).corrections).toBe(0);
		expect(couperBouclesDegenerees(`目次${repeter("・", 200)}12`).corrections).toBe(0);
		expect(couperBouclesDegenerees(`う${repeter("お", 300)}っ`).corrections).toBe(0);
	});

	test("détecte l'uniformité d'un segment", () => {
		expect(segmentUniforme("ああああ", { debut: 0, periode: 2, longueur: 4, repetitions: 2 })).toBe(
			true
		);
		expect(segmentUniforme("あいあい", { debut: 0, periode: 2, longueur: 4, repetitions: 2 })).toBe(
			false
		);
	});
});

describe("estBoucleDegeneree / plusLongueBoucle", () => {
	test("un motif long n'exige aucune couverture minimale", () => {
		expect(
			estBoucleDegeneree({ debut: 0, periode: 10, longueur: 100, repetitions: 10 }, 100_000)
		).toBe(true);
	});

	test("un motif court exige 20 répétitions ET 60 % du texte", () => {
		expect(estBoucleDegeneree({ debut: 0, periode: 2, longueur: 40, repetitions: 20 }, 50)).toBe(
			true
		);
		expect(estBoucleDegeneree({ debut: 0, periode: 2, longueur: 40, repetitions: 20 }, 500)).toBe(
			false
		);
		expect(estBoucleDegeneree({ debut: 0, periode: 2, longueur: 38, repetitions: 19 }, 50)).toBe(
			false
		);
	});

	test("une vraie boucle n'est pas masquée par un plus long segment non qualifiant", () => {
		const source = `${repeter("ー", 300)}${repeter("、その部分を除いて", 12)}`;
		expect(plusLongueBoucle(source)?.periode).toBe(9);
	});
});

describe("supprimerBlocsHallucinesRepetes", () => {
	const pave =
		"ヒリースの身に着いた衣を\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を";

	test("retire toutes les occurrences du pavé recollé sous chaque titre (#93 p.6)", () => {
		const source = ["# ベリブル", pave, "# ゴルト大王", pave, "# キョウ", pave].join("\n\n");
		const { texte, corrections } = supprimerBlocsHallucinesRepetes(source);
		expect(corrections).toBe(3);
		expect(texte).toBe("# ベリブル\n\n# ゴルト大王\n\n# キョウ");
	});

	test("emporte la queue tronquée du même pavé, sans toucher aux titres", () => {
		const source = [
			"# ベリブル",
			pave,
			"# ゴルト大王",
			pave,
			"# キョウ",
			pave,
			"# レロロ",
			"ヒリースの身に着",
		].join("\n\n");
		expect(supprimerBlocsHallucinesRepetes(source).texte).toBe(
			"# ベリブル\n\n# ゴルト大王\n\n# キョウ\n\n# レロロ"
		);
	});

	test("ne touche pas un bloc répété qui ne boucle pas en interne (copyright)", () => {
		const bloc = "© BIRD STUDIO/SHUEISHA, TOEI ANIMATION";
		const source = ["# カード1", bloc, "# カード2", bloc, "# カード3", bloc].join("\n\n");
		expect(supprimerBlocsHallucinesRepetes(source).corrections).toBe(0);
	});

	test("ne touche pas un bloc bouclant présent une ou deux fois seulement", () => {
		const source = ["# ベリブル", pave, "# ゴルト大王", pave].join("\n\n");
		expect(supprimerBlocsHallucinesRepetes(source).corrections).toBe(0);
	});

	test("blocBoucleEnInterne ignore les lignes courtes redoublées (onomatopée)", () => {
		expect(blocBoucleEnInterne("おおお\nおおお\nおおお")).toBe(false);
		expect(
			blocBoucleEnInterne("着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を")
		).toBe(true);
	});
});

describe("corrigerGenerationsDeraillees", () => {
	test("ne touche à rien sur une planche saine — pas même à la mise en forme", () => {
		const source = "# ドラゴンボール大全集\n\n  鳥山明インタビュー   \n\n\n悟空とベジータ。";
		const r = corrigerGenerationsDeraillees(source);
		expect(r.modifie).toBe(false);
		expect(r.texte).toBe(source);
	});

	test("enchaîne bloc halluciné puis boucle, et nettoie les blancs laissés", () => {
		const pave = "同じ長い断片がここに続く\n同じ長い断片がここに続く\n同じ長い断片がここに続く";
		const source = [
			"# ピッコロ",
			pave,
			"# ブルマ",
			pave,
			"# ベジータ",
			pave,
			`最後の notice は「${repeter("繰り返される断片。", 15)}`,
		].join("\n\n");
		const r = corrigerGenerationsDeraillees(source);
		expect(r.rapport.find((x) => x.code === "bloc-hallucine-repete")?.corrections).toBe(3);
		expect(r.rapport.find((x) => x.code === "boucle-degeneree")?.corrections).toBe(1);
		expect(r.texte).toBe(
			"# ピッコロ\n\n# ブルマ\n\n# ベジータ\n\n最後の notice は「繰り返される断片。"
		);
	});

	test("idempotent — un second passage ne change plus rien", () => {
		const pave = "同じ長い断片がここに続く\n同じ長い断片がここに続く";
		const cas = [
			`前置き。${repeter("繰り返される断片です", 40)}`,
			`前置き${repeter("？！", 3000)}`,
			["# A", pave, "# B", pave, "# C", pave].join("\n\n"),
			"# 普通のページ\n\nかめはめ波の説明。",
			repeter("ー", 200),
		];
		for (const source of cas) {
			const une = corrigerGenerationsDeraillees(source).texte;
			expect(corrigerGenerationsDeraillees(une).texte).toBe(une);
		}
	});
});
