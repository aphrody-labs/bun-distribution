/**
 * Tests du module « sosies et intrusions ».
 *
 * Deux familles : ce que la règle DOIT corriger (chaque cas vient du corpus,
 * avec sa fiche et sa planche) et ce qu'elle NE DOIT PAS toucher — la seconde
 * pèse plus lourd, parce que la façon de casser 11 000 planches est de
 * remplacer un kanji parfaitement légitime.
 */
import { describe, expect, it } from "bun:test";
import {
	corrigerEnumerationHangul,
	corrigerSosies,
	corrigerSosiesEtIntrusions,
	signalerIntrusions,
	SOSIES_VALIDES_A_LA_MAIN,
} from "./sosies-intrusions";

/**
 * Oracle de test : un lexique fermé qui tient lieu de kuromoji + JMdict.
 *
 * Un faux dictionnaire plutôt que le vrai, parce que le vrai vit dans
 * `.ja-data/` hors dépôt (18 Mo + 113 Mo, cf. `scripts/ja-preparer.ts`) : lier
 * les tests à sa présence les rendrait verts sur une machine et rouges sur une
 * autre. Le contenu reproduit ce que le vrai dictionnaire répond sur les cas
 * mesurés, vérifié à l'exécution contre kuromoji/JMdict le 2026-08-25.
 */
const CONNUS = new Set([
	"カメラ",
	"ロボット",
	"ロマンス",
	"ロマンティック",
	"ニヤリ",
	"ニヒル",
	"ニシン",
	"アニメ",
	"カット",
	"カセット",
	"ゲームカセット",
	"ハサミ",
	"オネエ",
	"ベース",
	"ベビー",
	"スケベ",
	"ケンカ",
	"タンカ",
	"カリン",
	"カエデ",
	"チョロチョロ",
	"ドラクエ",
	"ロカビリー",
	"カリスト",
	"ニプロダクション",
	"ベジータ",
	"ブロリー",
	"ミート",
	"キラー",
	"ヤシ",
	"パワー",
	"ガード",
	"プラチナ",
	"ゴールド",
	"シルバー",
	"ブロンズ",
	"トロフィー",
	"スーパー",
]);
const motConnu = (m: string) => CONNUS.has(m);

describe("débordement d'énumération en hangul cerclé", () => {
	it("poursuit la numérotation après le 35 cerclé", () => {
		// Daizenshuu 6 p.113, tel quel dans le corpus.
		const { texte, corrections } = corrigerEnumerationHangul(
			"だろく(㉟) だろく(㉠)\nだろく(㉡) だろく(㉢)"
		);
		expect(texte).toBe("だろく(㉟) だろく(㊱)\nだろく(㊲) だろく(㊳)");
		expect(corrections).toBe(3);
	});

	it("va jusqu'à 50 et pas au-delà", () => {
		// U+326E vaut 50 et a un nombre cerclé ; U+326F vaudrait 51 et n'en a
		// aucun. Le laisser tel quel est le seul choix qui n'invente rien.
		const { texte, corrections } = corrigerEnumerationHangul("㉟㉮㉯");
		expect(texte).toBe("㉟㊿㉯");
		expect(corrections).toBe(1);
	});

	it("ne touche pas à une page sans énumération cerclée japonaise", () => {
		// Sans compteur ailleurs dans la planche, rien ne dit que ces signes
		// sont un débordement plutôt que du coréen.
		const texte = "㉠ 한국어 ㉡";
		expect(corrigerEnumerationHangul(texte).texte).toBe(texte);
	});

	it("laisse intacts les nombres cerclés déjà justes", () => {
		const texte = "① ⑳ ㉑ ㉟ ㊱ ㊿";
		expect(corrigerEnumerationHangul(texte).corrections).toBe(0);
	});

	it("est idempotent", () => {
		const un = corrigerEnumerationHangul("㉟㉠㉡");
		const deux = corrigerEnumerationHangul(un.texte);
		expect(deux.texte).toBe(un.texte);
		expect(deux.corrections).toBe(0);
	});
});

describe("sosies typographiques — ce qui est corrigé", () => {
	const cas: [string, string, string][] = [
		["18号とのラブ\n口マンス?", "18号とのラブ\nロマンス?", "fiche #2 p.142"],
		["とても口マンティックなところだ。", "とてもロマンティックなところだ。", "fiche #298 p.65"],
		["攻撃をくらい、二ヤリと笑うセル", "攻撃をくらい、ニヤリと笑うセル", "fiche #11 p.156"],
		["僕は二枚目や二ヒルな役が多いので", "僕は二枚目やニヒルな役が多いので", "fiche #24 p.81"],
		["フウにタン力を切ったところで", "フウにタンカを切ったところで", "fiche #11 p.122"],
		["正面からケン力を報げるヤジロベー", "正面からケンカを報げるヤジロベー", "fiche #2 p.221"],
		["専用ゲーム力セットをファミコンに", "専用ゲームカセットをファミコンに", "fiche #61 p.40"],
		["特製チップ／八サミできれいに", "特製チップ／ハサミできれいに", "fiche #136 p.14"],
		["なぜかオネ工言葉をしゃべる。", "なぜかオネエ言葉をしゃべる。", "fiche #33 p.34"],
		["べビーに完全に支配される", "ベビーに完全に支配される", "fiche #137 p.14 — Baby, GT"],
		["べースになる話があれば", "ベースになる話があれば", "fiche #2 p.255"],
		["悟空のスケべな旅仲間。", "悟空のスケベな旅仲間。", "fiche #9 p.99"],
	];
	for (const [avant, apres, ou] of cas) {
		it(`${avant} devient ${apres} (${ou})`, () => {
			expect(corrigerSosies(avant, motConnu).texte).toBe(apres);
		});
	}
});

describe("sosies typographiques — non-régressions", () => {
	it("laisse intact le kanji « force » employé seul", () => {
		// Le cas le plus dangereux : ce kanji est un mot japonais courant. Une
		// règle qui le remplacerait hors suite katakana casserait le corpus.
		for (const texte of ["二人の力", "パンチ力", "全力で戦う", "力を合わせる", "戦闘力"]) {
			const { texte: sortie, corrections } = corrigerSosies(texte, motConnu);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	it("laisse intact 一味 et sa famille : le sosie 一 n'est pas traité", () => {
		// 88 planches signalées, 95 % de légitime : le couple est volontairement
		// absent de la table des sosies.
		for (const texte of [
			"一味",
			"レッドリボン軍の一味",
			"一家",
			"一同",
			"一ツ橋",
			"コーヒー一杯",
			"ス一パ一マン",
		]) {
			expect(corrigerSosies(texte, motConnu).texte).toBe(texte);
		}
	});

	it("laisse intact le japonais ordinaire porteur de sosies", () => {
		for (const texte of ["入り口は北", "第二巻", "工場で働く", "八時に", "夕焼け"]) {
			expect(corrigerSosies(texte, motConnu).texte).toBe(texte);
		}
	});

	it("refuse un sosie qui borde un mot en kanji", () => {
		// Les trois faux positifs mesurés, plus leur symétrique à droite, plus
		// le cas qui a imposé la version stricte du garde-fou.
		const bordures = [
			"7弾最新能力リスト！！",
			"映像技術協力フジ・メディア",
			"グー超能力グー超能力 B",
			"この部分をチョロチョ口上的",
			"大界王……槐柳二シン(界王神)",
		];
		for (const texte of bordures) {
			expect(corrigerSosies(texte, motConnu).texte).toBe(texte);
		}
	});

	it("ne prend pas la particule へ pour un katakana mal lu", () => {
		// 52 occurrences de ページへ, 11 de ベジータへ dans le corpus : la suite
		// katakana suivie de la particule est du japonais correct.
		for (const texte of ["ページへ戻る", "ベジータへの一撃", "カメハウスへ向かう"]) {
			expect(corrigerSosies(texte, motConnu).texte).toBe(texte);
		}
	});

	it("refuse une substitution que le dictionnaire ne confirme pas", () => {
		// Cas réels du corpus : 95 occurrences de la première, 89 de la
		// deuxième, 50 de la troisième — toutes laissées intactes.
		for (const texte of ["力ヌピ", "力バトル", "力ダメージ", "力ゲージ"]) {
			expect(corrigerSosies(texte, motConnu).texte).toBe(texte);
		}
	});

	it("refuse une suite trop courte pour être jugée", () => {
		expect(corrigerSosies("力ン", motConnu).texte).toBe("力ン");
	});

	it("ne fait rien sans oracle, hors table validée à la main", () => {
		// Contrat de dégradation : sans dictionnaire, la règle générale se tait
		// plutôt que de deviner.
		expect(corrigerSosies("18号とのラブ\n口マンス?").texte).toBe("18号とのラブ\n口マンス?");
	});

	it("est idempotent", () => {
		const un = corrigerSosies("18号とのラブ\n口マンス?", motConnu);
		const deux = corrigerSosies(un.texte, motConnu);
		expect(deux.texte).toBe(un.texte);
		expect(deux.corrections).toBe(0);
	});
});

describe("table validée à la main", () => {
	it("applique les cas que le garde-fou écarte mais que le contexte tranche", () => {
		expect(corrigerSosies("かめはめ波が、巨大口ボットを買い", motConnu).texte).toBe(
			"かめはめ波が、巨大ロボットを買い"
		);
		expect(corrigerSosies("▲聖地力リンにそそえたつ塔。仙猫力リンの修業", motConnu).texte).toBe(
			"▲聖地カリンにそそえたつ塔。仙猫カリンの修業"
		);
	});

	it("s'applique même sans oracle, et reste idempotente", () => {
		const un = corrigerSosies("誘導口ボット☆");
		expect(un.texte).toBe("誘導ロボット☆");
		expect(corrigerSosies(un.texte).corrections).toBe(0);
	});

	it("porte une preuve en contexte pour chaque entrée", () => {
		for (const e of SOSIES_VALIDES_A_LA_MAIN) {
			expect(e.note.length).toBeGreaterThan(40);
			expect(e.lu).not.toBe(e.correct);
		}
	});
});

describe("intrusions d'alphabet — signalées, jamais corrigées", () => {
	it("relève le cyrillique posé au milieu d'un mot japonais", () => {
		const trouve = signalerIntrusions("その忍法は、忍法にさえ容питしない男だ。");
		expect(trouve).toHaveLength(1);
		expect(trouve[0].fragment).toBe("пит");
		expect(trouve[0].contexte).toContain("пит");
	});

	it("relève le devanagari, le grec et le hangul", () => {
		expect(signalerIntrusions("ウルトラゴッドミンजション")).toHaveLength(1);
		expect(signalerIntrusions("合体したスーパーΣは悟空に")).toHaveLength(1);
		expect(signalerIntrusions("全次元を通지ても")).toHaveLength(1);
	});

	it("ne signale pas le latin, qui est du texte réel", () => {
		expect(signalerIntrusions("これは DRAGON BALL の本です")).toHaveLength(0);
		expect(signalerIntrusions("ドラゴンボールSUPERの世界")).toHaveLength(0);
	});

	it("ne signale pas les lettres hangul cerclées : un compteur, pas une écriture", () => {
		expect(signalerIntrusions("だろく(㉟) だろく(㉠)")).toHaveLength(0);
	});

	it("ne corrige rien", () => {
		const texte = "その忍法は、忍法にさえ容питしない男だ。";
		expect(corrigerSosiesEtIntrusions(texte, { motConnu }).texte).toBe(texte);
	});
});

describe("pipeline du module", () => {
	it("compose les deux règles et rend un rapport chiffré", () => {
		const { texte, rapport } = corrigerSosiesEtIntrusions("㉟㉠ 18号とのラブ\n口マンス?", {
			motConnu,
		});
		expect(texte).toBe("㉟㊱ 18号とのラブ\nロマンス?");
		expect(rapport).toEqual([
			{ code: "enumeration-hangul", corrections: 1 },
			{ code: "sosies-typographiques", corrections: 1 },
		]);
	});

	it("laisse passer intacte une planche entièrement en katakana étrangers", () => {
		// Le piège documenté : IPADIC n'arbitre pas les katakana, donc une carte
		// Super Dragon Ball Heroes ou un tableau de trophées ressort « hors
		// dictionnaire » tout en étant exact. Rien ici ne doit y toucher.
		for (const texte of [
			"ベジータ / HP 3500 パワー 5300 ガード 1000 / ゴッドギャリック砲",
			"プラチナ ゴールド シルバー ブロンズ トロフィー",
		]) {
			expect(corrigerSosiesEtIntrusions(texte, { motConnu }).texte).toBe(texte);
		}
	});

	it("est idempotent sur un texte du corpus", () => {
		const brut = "㉟㉠㉡ かめはめ波が、巨大口ボットを買い、18号とのラブ\n口マンス?";
		const un = corrigerSosiesEtIntrusions(brut, { motConnu });
		const deux = corrigerSosiesEtIntrusions(un.texte, { motConnu });
		expect(deux.texte).toBe(un.texte);
		expect(deux.rapport.every((r) => r.corrections === 0)).toBe(true);
	});
});
