/**
 * Noms propres Dragon Ball mal lus — chaque garde testée, y compris (surtout)
 * les cas où la table ne DOIT pas s'appliquer. Tous les textes viennent du
 * corpus réel de dragonballfr.com, mesuré le 2026-08-25.
 */
import { describe, expect, test } from "bun:test";
import {
	AGGLUTINATIONS_VALIDEES_A_LA_MAIN,
	NOMS_PROPRES_MAL_LUS,
	corrigerNomsPropres,
	detaillerNomsPropres,
} from "../src/lib/databooks-ocr/noms-propres";

describe("table des noms propres", () => {
	test("chaque paire retenue est corrigée quand elle forme un mot entier", () => {
		for (const f of NOMS_PROPRES_MAL_LUS) {
			const { texte, corrections } = detaillerNomsPropres(f.lu);
			expect(texte).toBe(f.correct);
			expect(corrections).toBe(1);
		}
	});

	test("aucune forme juste n'est elle-même une forme fautive", () => {
		// Sans quoi la table bougerait : A vers B, puis B vers C. C'est aussi
		// ce qui rend l'idempotence vraie plutôt qu'espérée.
		const fautives = new Set(NOMS_PROPRES_MAL_LUS.map((f) => f.lu));
		for (const f of NOMS_PROPRES_MAL_LUS) {
			expect(fautives.has(f.correct)).toBe(false);
		}
	});

	test("aucune forme juste n'est réécrite par la table", () => {
		// Le test qui interdit le scénario le plus coûteux : corriger un nom
		// déjà correct vers un autre personnage.
		for (const f of NOMS_PROPRES_MAL_LUS) {
			const { texte, corrections } = detaillerNomsPropres(f.correct);
			expect(texte).toBe(f.correct);
			expect(corrections).toBe(0);
		}
	});

	test("aucune graphie fautive n'apparaît deux fois", () => {
		const vues = new Set(NOMS_PROPRES_MAL_LUS.map((f) => f.lu));
		expect(vues.size).toBe(NOMS_PROPRES_MAL_LUS.length);
	});

	test("toute paire diffère par exactement un kana, à longueur égale", () => {
		// La classe traitée est la confusion sourde/sonore : un kana bascule,
		// la longueur ne change pas. Une paire qui violerait ça relèverait
		// d'une autre passe et n'a rien à faire ici.
		for (const f of NOMS_PROPRES_MAL_LUS) {
			const a = [...f.lu];
			const b = [...f.correct];
			expect(a.length).toBe(b.length);
			const differences = a.filter((c, i) => c !== b[i]).length;
			expect(differences).toBe(1);
		}
	});

	test("les quatre cibles non attestées sont celles qu'on sait nommer", () => {
		// Une cible à zéro occurrence n'est retenue que si le contexte
		// l'identifie sans équivoque — ici, des listes nominatives où tous les
		// noms voisins sont justes (représentants des univers 3 et 10, crédits
		// Dr. Slump). Figer la liste empêche qu'une cinquième s'y glisse sans
		// que quelqu'un l'ait regardée.
		const orphelines = NOMS_PROPRES_MAL_LUS.filter((f) => f.attesteJuste === 0).map((f) => f.lu);
		expect(orphelines.toSorted()).toEqual(
			["シルコル", "パバロニ", "ブビピンマン", "メチオーフ"].toSorted()
		);
	});

	test("chaque paire porte un comptage réel", () => {
		for (const f of NOMS_PROPRES_MAL_LUS) {
			expect(f.occurrences).toBeGreaterThan(0);
			expect(f.planches).toBeGreaterThan(0);
			expect(f.planches).toBeLessThanOrEqual(f.occurrences);
			expect(f.fr.length).toBeGreaterThan(0);
		}
	});
});

describe("ベジタブル — la non-régression qui justifie toute la mécanique", () => {
	// Deux planches du corpus expliquent l'étymologie du nom de Végéta. Une
	// règle ancrée sur une sous-chaîne les détruirait exactement là où elles
	// disent quelque chose.
	const planche24 =
		"ッパ(菓葉)というのもいたし。で、その頂点に立つのが野菜の総称のベジタブル = ベジータリ。これには感心しましたね。";
	const planche6 =
		" * ベジータ…野菜の英語「ベジタブル」から\n * ラディッツ…野菜のラディッシュ（ハツカダイコン）か";

	test("les deux textes réels traversent intacts", () => {
		for (const texte of [planche24, planche6]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les variantes du mot restent du japonais, pas un personnage", () => {
		for (const texte of ["ベジタブル", "ベジタリアンの食事", "ミックスベジタブル"]) {
			expect(detaillerNomsPropres(texte).texte).toBe(texte);
		}
	});
});

describe("frontière de mot", () => {
	test("une forme fautive collée à d'autres katakana n'est pas touchée", () => {
		// Le mot n'est délimité que par le changement d'écriture : sans cette
		// borne, on parierait sur l'endroit où il commence.
		for (const texte of ["フリーサイズのTシャツ", "フロースト", "サーボンヌ", "コクウブラックス"]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("le point médian vaut frontière", () => {
		// Cas réel #33 p.40 : « ミニ・シャネンバは2体のみの登場だし ».
		const { texte } = detaillerNomsPropres("ミニ・シャネンバは2体のみの登場だし");
		expect(texte).toBe("ミニ・ジャネンバは2体のみの登場だし");
	});

	test("une entrée qui contient elle-même un point médian se corrige", () => {
		// Cas réels #3 p.63 (Daizenshuu 4) et #133 p.26 (V Jump 1996).
		expect(detaillerNomsPropres("ミスター・サダン").texte).toBe("ミスター・サタン");
		expect(detaillerNomsPropres("トクター・ミューはこれまで").texte).toBe(
			"ドクター・ミューはこれまで"
		);
	});

	test("la forme longue gagne sur la forme courte qu'elle contient", () => {
		// `フロリー` est une entrée, et `バイオフロリー` en est une autre : la
		// seconde doit gagner, sans quoi on couperait le mot en deux.
		const { texte, details } = detaillerNomsPropres("暴走するバイオフロリーに、悟天とトランクスが");
		expect(texte).toBe("暴走するバイオブロリーに、悟天とトランクスが");
		expect(details).toEqual([{ lu: "バイオフロリー", correct: "バイオブロリー", n: 1 }]);
	});
});

describe("les paires refusées ne sont pas dans la table", () => {
	test("un mot japonais courant à un kana d'un nom propre traverse", () => {
		// Chacun de ces textes a été mesuré dans le corpus et serait cassé par
		// la paire correspondante. Ce test fige les huit refus : réintroduire
		// l'une d'elles le fera échouer.
		for (const texte of [
			"ドキトキのお楽しみ抽選会！！",
			"トキドキするね 堀井雄二&鳥山明",
			"フューはドギドキとの融合で超強化",
			"ドラゴンボール乙ガンバー孫悟飯",
			"悟空たちもシャンティが亡に余り出し",
			"カステルまじゅう魔神城",
			"ベジータの必殺技ビックバンアタックなど",
			"本名:ジャコ・ティリメンテンピポッシ",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les emprunts écartés par JMdict traversent", () => {
		// Douze mots japonais réels que l'étape de génération visait, et que le
		// dictionnaire a sauvés. Ils ne doivent jamais entrer dans la table.
		for (const texte of [
			"ジャンパを着る",
			"スラックスとシャツ",
			"ドルビーサラウンド",
			"マルガリータ",
			"サーロインステーキ",
			"ブラバンの演奏",
			"ニューズウィーク",
			"ブレークタイム",
		]) {
			expect(detaillerNomsPropres(texte).texte).toBe(texte);
		}
	});
});

describe("cas réels du corpus", () => {
	test("la faute et la forme juste sur la même planche sont unifiées", () => {
		// #26 p.30 : la preuve que c'est une lecture et non une convention.
		const { texte, corrections } = detaillerNomsPropres(
			"ラストアタック\n\nカーリックJr.\n\nガーリックJr.の容赦ない猛攻に、"
		);
		expect(texte).toBe("ラストアタック\n\nガーリックJr.\n\nガーリックJr.の容赦ない猛攻に、");
		expect(corrections).toBe(1);
	});

	test("plusieurs fautes d'une même ligne partent ensemble", () => {
		// #18 p.180 : la liste des guerriers de Bojack, deux noms abîmés.
		const { texte, details } = detaillerNomsPropres("サンギャ\n\nフージン\n\nゴクア\n\nビドー");
		expect(texte).toBe("ザンギャ\n\nブージン\n\nゴクア\n\nビドー");
		expect(details.map((d) => d.lu).toSorted()).toEqual(["サンギャ", "フージン"]);
	});

	test("une planche qui répète la même faute la compte autant de fois", () => {
		// #25 p.23 porte サーボン sept fois ; le détail doit le dire, pour que
		// le relecteur sache ce qu'il regarde.
		const { details } = detaillerNomsPropres(
			"サーボンも圧倒するベジータ! だがサーボンは、変身能力を隠していた"
		);
		expect(details).toEqual([{ lu: "サーボン", correct: "ザーボン", n: 2 }]);
	});

	test("du japonais ordinaire traverse intact", () => {
		for (const texte of [
			"今日はカメラで写真を撮りました。",
			"孫悟空とベジータはナメック星で戦った。",
			"DRAGON BALL 1989 BIRD STUDIO",
			"",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("un caractère hors du plan de base n'est pas coupé en deux", () => {
		const { texte } = detaillerNomsPropres("🐉フロリー🐉あ");
		expect(texte).toBe("🐉ブロリー🐉あ");
	});
});

describe("corrigerNomsPropres", () => {
	test("rend un rapport à une seule règle", () => {
		const { texte, rapport } = corrigerNomsPropres("魔導師ビビティが造った時の姿に戻ったブウ。");
		expect(texte).toBe("魔導師ビビディが造った時の姿に戻ったブウ。");
		expect(rapport).toEqual([{ code: "noms-propres", corrections: 1 }]);
	});

	test("un texte sans faute rend un rapport à zéro", () => {
		const { texte, rapport } = corrigerNomsPropres("界王拳でミソカツツンを倒した悟空");
		expect(texte).toBe("界王拳でミソカツツンを倒した悟空");
		expect(rapport).toEqual([{ code: "noms-propres", corrections: 0 }]);
	});

	test("est idempotente", () => {
		const source = "悟空の父バータックとフリーサ、そしてコクウブラック、シャネンバ、ハビディ";
		const premier = corrigerNomsPropres(source).texte;
		const second = corrigerNomsPropres(premier).texte;
		expect(premier).toBe(
			"悟空の父バーダックとフリーザ、そしてゴクウブラック、ジャネンバ、バビディ"
		);
		expect(second).toBe(premier);
	});

	test("aucune paire ne change la longueur du texte", () => {
		// Le garde-fou du runner écarte une planche tombée sous 50 % de sa
		// longueur ; il ne devrait jamais avoir à se déclencher ici, puisque
		// chaque paire conserve le nombre de caractères.
		for (const f of NOMS_PROPRES_MAL_LUS) {
			expect(f.correct.length).toBe(f.lu.length);
		}
	});
});

describe("agglutinations tranchées à la main", () => {
	test("chaque chaîne ancrée est corrigée", () => {
		for (const a of AGGLUTINATIONS_VALIDEES_A_LA_MAIN) {
			const { texte } = detaillerNomsPropres(a.lu);
			expect(texte).toBe(a.correct);
		}
	});

	test("aucune chaîne ancrée n'est réécrite une seconde fois", () => {
		for (const a of AGGLUTINATIONS_VALIDEES_A_LA_MAIN) {
			const { texte, corrections } = detaillerNomsPropres(a.correct);
			expect(texte).toBe(a.correct);
			expect(corrections).toBe(0);
		}
	});

	test("les cas réels, dans leur phrase d'origine", () => {
		// Chaque texte est la ligne telle qu'elle figure en base.
		const cas: [string, string][] = [
			["### ウバブーアルvsドラキュラマン", "### ウバプーアルvsドラキュラマン"],
			["伝説の超サイヤンフロリーが再登場!!", "伝説の超サイヤンブロリーが再登場!!"],
			["764 トランクスフリーサ親子を倒す", "764 トランクスフリーザ親子を倒す"],
			["バトルタイプパーサーカー\n\nHP 3700", "バトルタイプバーサーカー\n\nHP 3700"],
			["暗黒帝国のトップメチカフラが動き出す", "暗黒帝国のトップメチカブラが動き出す"],
			["第6宇宙戦士\nヒット&操リリシャンバ", "第6宇宙戦士\nヒット&操リリシャンパ"],
			["モビカンモビカンと対戦した選手", "モヒカンモヒカンと対戦した選手"],
		];
		for (const [avant, apres] of cas) {
			expect(detaillerNomsPropres(avant).texte).toBe(apres);
		}
	});

	test("la sous-chaîne qui a motivé la garde reste intacte", () => {
		// `パーボン` est une sous-chaîne de `スーパーボンバーマン` : sept
		// occurrences du corpus, toutes le jeu de Hudson. C'est le contre-exemple
		// qui interdit de dégarder `パーサーカー` et consorts.
		for (const texte of [
			"スーパーボンバーマン4",
			"走る爆弾男スーパーボンバーマン5 59",
			"スーパーボンバーマンばにっくポンバーW／発売元・ハドソン",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les agglutinations refusées traversent intactes", () => {
		// Six lectures que rien ne prouve : deux planches hallucinées, une
		// planche corrompue, un kana qui peut appartenir au mot suivant, et un
		// `ン` dont on ne sait pas ce qu'il devient.
		for (const texte of [
			"このシャネンバクは、超サイMANの骨格に",
			"ターレースサーボン・アリエーナの超決戦",
			"スーパー ALL PARK フロリースペichy!!",
			"恐怖の戦士フロリーカを収集せよ",
			"ナント! フリーサンも..?!",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les deux corrections partielles ne supposent aucun caractère", () => {
		// On répare le dakuten, on n'ajoute ni ne retire rien : `フリーザファミリー`
		// n'existe nulle part dans le corpus, et `カ`/`オ` n'est pas un dakuten.
		expect(detaillerNomsPropres("フリーサアミリーを引き連れて").texte).toBe(
			"フリーザアミリーを引き連れて"
		);
		expect(detaillerNomsPropres("HJ7-41 バイカフロリー").texte).toBe("HJ7-41 バイカブロリー");
		for (const a of AGGLUTINATIONS_VALIDEES_A_LA_MAIN) {
			expect(a.correct.length).toBe(a.lu.length);
		}
	});

	test("une chaîne ancrée répare tous les noms qu'elle porte", () => {
		// La liste du jeu Famicom écrit chaque nom deux fois de suite ; une
		// seule substitution doit réparer les deux.
		const { texte, details } = detaillerNomsPropres("化ブーアルブーアルバトル");
		expect(texte).toBe("化プーアルプーアルバトル");
		expect(details).toEqual([
			{ lu: "化ブーアルブーアル", correct: "化プーアルプーアル", n: 1, agglutine: true },
		]);
	});

	test("aucune chaîne ancrée n'est un mot japonais isolé", () => {
		// Chacune contient au moins un caractère de contexte au-delà du nom :
		// c'est ce qui remplace la frontière, donc c'est ce qui doit exister.
		const fautives = NOMS_PROPRES_MAL_LUS.map((f) => f.lu);
		for (const a of AGGLUTINATIONS_VALIDEES_A_LA_MAIN) {
			const porte = fautives.some((lu) => a.lu.includes(lu));
			expect(porte).toBe(true);
			expect(a.lu.length).toBeGreaterThan(4);
			expect(a.planche.startsWith("#")).toBe(true);
			expect(a.note.length).toBeGreaterThan(0);
		}
	});
});

describe("le second balayage, et ce qu'il a fallu refuser", () => {
	test("les noms que la premiere table manquait sont corriges", () => {
		// Les cinq noms les plus attestes du corpus, absents de la v1 pour
		// quatre causes distinctes documentees dans le module.
		const cas: [string, string][] = [
			[
				"昔、悟空に敗れた溺ヤ人・プロリーが引き起こしていた",
				"昔、悟空に敗れた溺ヤ人・ブロリーが引き起こしていた",
			],
			["・ビッコロ", "・ピッコロ"],
			["チチフルマ", "チチフルマ"], // agglutine : la garde refuse, et c'est voulu
			["ヤムチャとフルマ", "ヤムチャとブルマ"],
			["超サイヤ人コッドへと覚醒", "超サイヤ人ゴッドへと覚醒"],
		];
		for (const [avant, apres] of cas) {
			expect(detaillerNomsPropres(avant).texte).toBe(apres);
		}
	});

	test("Gale de GT n'est pas transforme en Kale de Super", () => {
		// Le seuil abaisse a trois kana a fait remonter cette paire. La planche
		// porte sa propre traduction : « Sheera & Gale ».
		for (const texte of [
			"シーラ&ゲール\nSheera & Gale",
			"用心棒にゲールとシーラ、レックを雇っている",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("le jeu de Chunsoft n'est pas transforme en guerrier de l'univers 11", () => {
		// « 風来のシレン » est cite dans les V-Jump de 1996 a 2000 ; Jiren date
		// de 2017. La fréquence seule aurait valide la paire.
		for (const texte of [
			"不思議のダンジョン風来のシレン2",
			"鬼襲来！シレン城！",
			"「風来のシレン」「サターンポンバーマン」",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les autres homonymes hors univers traversent", () => {
		for (const texte of [
			"ヒカルの碁", // pas ビカル
			"進藤ヒカル", // idem
			"キラン☆と光る", // onomatopee, pas ギラン
			"ブランドのプラン", // ni ブラン ni プラン ne sont sûrs
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les cas reels du second balayage", () => {
		const cas: [string, string][] = [
			["レッド総帥の命令で悟空と闘うフラック", "レッド総帥の命令で悟空と闘うブラック"],
			["恐るべき超能力使いプルー將軍", "恐るべき超能力使いブルー將軍"],
			["フルー将軍の日月部隊", "ブルー将軍の日月部隊"],
			[
				"サマスによって世界をめちゃくちゃにされてしまったトランクス",
				"ザマスによって世界をめちゃくちゃにされてしまったトランクス",
			],
			["聖地ガリンに住むポラの武器", "聖地カリンに住むポラの武器"],
			["ナメック語でならボルンガを呼び出すときも", "ナメック語でならポルンガを呼び出すときも"],
			[
				"老界王神がセットソードの封印から解き放たれる",
				"老界王神がゼットソードの封印から解き放たれる",
			],
			["ボンコとバスタはリッチストン欲しさに", "ボンゴとパスタはリッチストン欲しさに"],
			["んちゃ! ベンギン村より愛をこめて", "んちゃ! ペンギン村より愛をこめて"],
			["フリーザの兎グウラが三人の部下を率いて", "フリーザの兎クウラが三人の部下を率いて"],
		];
		for (const [avant, apres] of cas) {
			expect(detaillerNomsPropres(avant).texte).toBe(apres);
		}
	});

	test("la table a bien grossi, et reste coherente", () => {
		expect(NOMS_PROPRES_MAL_LUS.length).toBe(183);
		// La propriete qui compte : aucune cible n'est elle-meme une faute.
		const fautives = new Set(NOMS_PROPRES_MAL_LUS.map((f) => f.lu));
		for (const f of NOMS_PROPRES_MAL_LUS) expect(fautives.has(f.correct)).toBe(false);
	});
});

describe("ce que le crible dictionnaire masquait", () => {
	test("les quatre noms propres rendus au corpus", () => {
		const cas: [string, string][] = [
			["クウラ、ターレス、スラック、ブロリー", "クウラ、ターレス、スラッグ、ブロリー"],
			["超ナメック星人スラックの率いる魔族軍団", "超ナメック星人スラッグの率いる魔族軍団"],
			["スラック味\n【スラック】\n・超巨身術", "スラッグ味\n【スラッグ】\n・超巨身術"],
			["超サイヤ人ゴットSSベジータ(進化)", "超サイヤ人ゴッドSSベジータ(進化)"],
			["ゴットかめはめ波", "ゴッドかめはめ波"],
			["オッズ！オラ悟空", "オッス！オラ悟空"],
			["オッズ！帰ってきた孫悟空と仲間たち", "オッス！帰ってきた孫悟空と仲間たち"],
			["残るシースとバータの体技", "残るジースとバータの体技"],
			["HG7-21 シース C HG7-22 バータ", "HG7-21 ジース C HG7-22 バータ"],
		];
		for (const [avant, apres] of cas) {
			expect(detaillerNomsPropres(avant).texte).toBe(apres);
		}
	});

	test("l'horoscope financier garde son slack", () => {
		// #82 p.65, Dragon Ball Fortune Book : le seul endroit du corpus où
		// スラック est le mot anglais. Les suffixes viennent de ces lignes-là.
		for (const texte of [
			"第79回第19回のスラックを楽しく年には2回のスラックを楽しく",
			"予想される不況が目撃される。スラックによるで底値より下がる。",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les emprunts que le crible protégeait à raison traversent toujours", () => {
		// Trente et une des trente-cinq formes reprises lui donnaient raison.
		for (const texte of [
			"オーラのパーツと頭髪がより逆立つ程度だ", // pièces, pas Hearts
			"眼球パーツにエネルギーを集積し",
			"ネジなどのパーツはそれらしく描きこむ",
			"DRAGON BALL ゼット",
			"天才ピートのつくったピーター", // Dub & Peter 1
			"ダブとピートとそして……",
			"リーグ戦の結果",
			"スラックスとシャツ", // le pantalon : la frontière suffit
			"ヘビー級のパンチ",
			"ニューズウィーク",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("les deux preuves chronologiques tiennent", () => {
		// `ジャンパ` est une fiche de technique du Daizenshuu 7 (1996) ; Champa
		// date de 2015. `シータ` est un ベジータ amputé, sous « VEGETA ».
		for (const texte of [
			"エネルギー砲【人】ジャンパ【特】体表にある8つの穴から",
			"VEGETA\nシータ\nプレイアブル",
		]) {
			const { texte: sortie, corrections } = detaillerNomsPropres(texte);
			expect(sortie).toBe(texte);
			expect(corrections).toBe(0);
		}
	});

	test("une seule entrée porte des interdits, et ils sont ancrés", () => {
		const avecInterdits = NOMS_PROPRES_MAL_LUS.filter((f) => f.interdits && f.interdits.length > 0);
		expect(avecInterdits.map((f) => f.lu)).toEqual(["スラック"]);
		for (const f of avecInterdits) {
			for (const suffixe of f.interdits ?? []) expect(suffixe.length).toBeGreaterThan(1);
		}
	});
});
