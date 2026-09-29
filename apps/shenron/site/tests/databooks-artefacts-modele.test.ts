/**
 * Artefacts de sortie du modèle — chaque règle testée isolément, avec ses
 * **contre-exemples réels** : la mise en page ou le texte légitime qu'une
 * règle trop large détruirait. Tous les cas viennent du corpus mesuré le
 * 2026-08-25 (11 255 planches de `bot.db_databooks`), avec le numéro de la
 * planche d'origine en commentaire.
 */
import { describe, expect, test } from "bun:test";
import {
	PHRASES_META,
	corrigerArtefactsModele,
	couperSerialisationJson,
	retirerBalisesHtml,
	decoderEntitesHtml,
	normaliserEllipsesMidot,
	normaliserEllipsesNakaguro,
	normaliserEllipsesPoints,
	normaliserLatexHallucine,
	reduireEchappementsRepetes,
	restaurerEchappementsLitteraux,
	retirerLiensHallucines,
	retirerMarqueursPage,
	retirerPhrasesMeta,
	retirerRemplacementTerminal,
	retirerTokensControle,
} from "../src/lib/databooks-ocr/artefacts-modele";

describe("couperSerialisationJson", () => {
	test("coupe la queue de boîtes englobantes en gardant le texte mis en forme", () => {
		// #133 p.9 : la queue tient en un bloc, le texte utile est intact.
		const source =
			'次ページからは“TOBAL”の基本をチェック!!!"}, {"bbox": [74, 1446, 95, 1463], "category": "Page-footer", "text": "25"}]';
		const { texte, corrections } = couperSerialisationJson(source);
		expect(corrections).toBe(1);
		expect(texte).toBe("次ページからは“TOBAL”の基本をチェック!!!");
	});

	test("coupe aussi quand la troncature a mangé l'ouverture du bloc", () => {
		// #12 p.97 : « ピッ (19, 536, 174, 806], "I did not… » — le fragment de
		// mot « ピッ » reste tel quel, on ne le complète pas.
		const source =
			'該当者(夜) 岡田登斗\n\nピッ (19, 536, 174, 806], "I did not find any text in the image."}, {"bbox": [63, 71';
		const { texte, corrections } = couperSerialisationJson(source);
		expect(corrections).toBe(1);
		expect(texte).toBe("該当者(夜) 岡田登斗\n\nピッ");
	});

	test("ne touche pas un texte sans sérialisation", () => {
		const source =
			"【特】バンダナをしたヤンキーな兄ちゃん。ベジータに因縁をつけ、裏拳一発でノックダウンされた。";
		expect(couperSerialisationJson(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("retirerPhrasesMeta", () => {
	test("supprime le paragraphe entier quand il ne reste rien de japonais", () => {
		// #10 p.9 : quatre refus d'affilée en fin de transcription.
		const source =
			"が悟空に似ているのかな？\n\nI did not find any text in the image.\n\nI did not find any text in the image.";
		const { texte, corrections } = retirerPhrasesMeta(source);
		expect(corrections).toBe(2);
		expect(texte).toBe("が悟空に似ているのかな？");
	});

	test("emporte la description d'image accolée au refus", () => {
		// #129 p.15 : refus + description anglaise dans le même paragraphe.
		const source =
			"よ——!!\n\nI did not find any text in the image. The image contains a drawing of a cartoon character with a speech bubble.\n\nたご";
		const { texte } = retirerPhrasesMeta(source);
		expect(texte).toBe("よ——!!\n\nたご");
	});

	test("ne retire que la phrase quand elle est collée à du japonais", () => {
		// #4 p.204 : le japonais du paragraphe reste, tronqué, sans être complété.
		const source = "空中基地にThere is no text in the image.";
		const { texte, corrections } = retirerPhrasesMeta(source);
		expect(corrections).toBe(1);
		expect(texte).toBe("空中基地に");
	});

	test("laisse intactes les phrases anglaises légitimes de l'ouvrage anglais", () => {
		// #46 p.20 (réplique traduite) et #46 p.3 (titre d'épisode) : un
		// mot-clé « I cannot » ou « sorry » les aurait emportées.
		const source =
			"I cannot tell an evil being.\n\nSorry, Robot-san -- The Desert of Vanishing Tears";
		expect(retirerPhrasesMeta(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("la liste des phrases est close et documentée", () => {
		expect(PHRASES_META.length).toBeGreaterThan(0);
		for (const p of PHRASES_META) expect(p.note.length).toBeGreaterThan(10);
	});
});

describe("retirerTokensControle", () => {
	test("retire un token de fin de tour", () => {
		const { texte, corrections } = retirerTokensControle("孫悟空<|im_end|>");
		expect(corrections).toBe(1);
		expect(texte).toBe("孫悟空");
	});

	test("ne touche pas un chevron ordinaire du corpus", () => {
		// #259 p.14 après décodage des entités : « ヤムチャ<天津飯> ».
		const source = "ヤムチャ<天津飯>\n30\n列島";
		expect(retirerTokensControle(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("normaliserLatexHallucine", () => {
	test("déballe le texte et transpose les flèches", () => {
		// #6 p.56.
		const source = "国王（統治） \\rightarrow 43の地区（所属） \\rightarrow 国民";
		const { texte } = normaliserLatexHallucine(source);
		expect(texte).toBe("国王（統治） → 43の地区（所属） → 国民");
	});

	test("déballe une flèche annotée sans rien perdre", () => {
		// #6 p.69.
		const { texte } = normaliserLatexHallucine(
			"ビビディ（父） \\xrightarrow{\\text{作る}} 魔人ブウ"
		);
		expect(texte).toBe("ビビディ（父） →作る 魔人ブウ");
	});

	test("retire les délimiteurs autour d'un simple encadré de texte", () => {
		// #167 p.41.
		const source = "$$\n\\text{ドラゴンボールファイターズ}\n$$";
		const { texte } = normaliserLatexHallucine(source);
		expect(texte.trim()).toBe("ドラゴンボールファイターズ");
	});

	test("laisse une fraction telle quelle : pas d'équivalent univoque", () => {
		// #2 p.92 — la planche reste signalée à la relecture.
		const { texte } = normaliserLatexHallucine("$$\\frac{1}{2}x-5$$");
		expect(texte).toBe("\\frac{1}{2}x-5");
	});

	test("ne touche pas aux dollars d'un texte sans commande LaTeX", () => {
		// #24 p.46 : « $ta$ » est du bruit de lecture, pas des maths ; et un
		// prix en dollars ne doit pas être charcuté non plus.
		const source = "ちょっとお Informa tae nai kyo, $ta$ ta taa — 価格 $25 だ";
		expect(normaliserLatexHallucine(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("retirerLiensHallucines", () => {
	test("retire une image markdown inventée", () => {
		// #91 p.13 : URL imgur factice, légende anglaise décrivant la case.
		const source =
			"勝ち![Image of a person with a gun and a mask on his/her face.](https://i.imgur.com/12345.jpg)\n「気」を探れない";
		const { texte, corrections } = retirerLiensHallucines(source);
		expect(corrections).toBe(1);
		expect(texte).toBe("勝ち\n「気」を探れない");
	});

	test("dé-lie une cible vide en gardant le libellé", () => {
		// #120 p.18 et #154 p.6.
		const { texte } = retirerLiensHallucines("※[:!)]() [planning new adventures](#)");
		expect(texte).toBe("※:!) planning new adventures");
	});

	test("ne touche pas un lien vers une URL réellement imprimée", () => {
		// #202 p.20 : l'adresse du site du magazine figure sur la planche.
		const source = "[VJ WEB](http://jump.shueisha.co.jp/) にて";
		expect(retirerLiensHallucines(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("decoderEntitesHtml", () => {
	test("décode le double échappement d'une esperluette imprimée", () => {
		// #3 p.13.
		const { texte, corrections } = decoderEntitesHtml("ポスター&amp;ラフスケッチ集 5");
		expect(corrections).toBe(1);
		expect(texte).toBe("ポスター&ラフスケッチ集 5");
	});

	test("décode les chevrons d'un tableau de jeu", () => {
		// #259 p.14.
		const { texte } = decoderEntitesHtml("ヤムチャ&lt;天津飯&gt;");
		expect(texte).toBe("ヤムチャ<天津飯>");
	});

	test("ne touche pas une esperluette déjà nue", () => {
		const source = "PS3&Xbox360 『ドラゴンボールレイジングブラスト』";
		expect(decoderEntitesHtml(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("retirerBalisesHtml", () => {
	test("retire les balises de structure et conserve le saut de br", () => {
		expect(retirerBalisesHtml("A<br>B<td>C</td>")).toEqual({
			texte: "A\nBC",
			corrections: 3,
		});
	});

	test("ne touche pas aux chevrons pleine chasse imprimés", () => {
		const source = "ドラゴンボール＜文化＞";
		expect(retirerBalisesHtml(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("restaurerEchappementsLitteraux", () => {
	test("restaure un saut de ligne écrit en toutes lettres", () => {
		// #45 p.15.
		const { texte, corrections } = restaurerEchappementsLitteraux("か…\\n変わった……");
		expect(corrections).toBe(1);
		expect(texte).toBe("か…\n変わった……");
	});

	test("ne touche pas un vrai saut de ligne", () => {
		const source = "か…\n変わった……";
		expect(restaurerEchappementsLitteraux(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("reduireEchappementsRepetes", () => {
	test("supprime une rafale d'astérisques échappés", () => {
		// #195 p.24 : 2 040 d'affilée dans le corpus.
		const source = "ち……" + "\\*".repeat(40);
		const { texte } = reduireEchappementsRepetes(source);
		expect(texte).toBe("ち……");
	});

	test("laisse un ou deux astérisques échappés : ce peut être voulu", () => {
		// #195 p.11, #257 p.19.
		const source = "ち……\\*\\*";
		expect(reduireEchappementsRepetes(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("retirerMarqueursPage", () => {
	test("retire l'en-tête de page inventé par le modèle", () => {
		// #20 p.3 : le modèle annonce « Page 4 » sur une planche numérotée 3.
		const source = "**Page 4**\n\nかつて、誰もひとり\n\n4";
		const { texte, corrections } = retirerMarqueursPage(source);
		expect(corrections).toBe(1);
		expect(texte.trim()).toBe("かつて、誰もひとり\n\n4");
	});

	test("préserve le folio authentique, qui est un chiffre nu", () => {
		// Même planche : « 4 » en dernière ligne est le vrai folio imprimé.
		const { texte, corrections } = retirerMarqueursPage("見たいことも\n\n4\n4");
		expect(corrections).toBe(0);
		expect(texte).toBe("見たいことも\n\n4\n4");
	});

	test("accepte les variantes de forme relevées dans le corpus", () => {
		for (const marqueur of ["PAGE 50", "## Page 53", "PAGE 51:", "PAGE 54 :", "PAGE 56 !"]) {
			const { corrections } = retirerMarqueursPage(marqueur + "\n## 北の界王");
			expect(corrections).toBe(1);
		}
	});

	test("retire le marqueur collé en tête de la première ligne", () => {
		// #21 p.2.
		const { texte } = retirerMarqueursPage("PAGE 2 : 週刊少年ジャンプ特別編集");
		expect(texte).toBe("週刊少年ジャンプ特別編集");
	});

	test("retire le séparateur de double page laissé en milieu de texte", () => {
		// #21 p.43.
		const source = "engloutir une ville entière !!\n\npage 47\n\n六星龙";
		const { texte, corrections } = retirerMarqueursPage(source);
		expect(corrections).toBe(1);
		expect(texte).toBe("engloutir une ville entière !!\n\n\n六星龙");
	});

	test("ne touche pas une mention de pagination prise dans une phrase", () => {
		// #6 p.5, #318 p.8, #21 p.23, #317 p.18 (numéro de téléphone).
		const source =
			"sentation des techniques à partir de la page 71 !\nConsulte la page 7 pour plus de détails\nÀ la page 54, découvrez le CD single\nこの页の先の下へ、このPage 03-3847-5090";
		expect(retirerMarqueursPage(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("normaliserEllipsesPoints", () => {
	test("convertit les points collés à du japonais", () => {
		// #26 p.9.
		const { texte, corrections } = normaliserEllipsesPoints(
			"ベジータは防戦一方に... 目覚めた13号に"
		);
		expect(corrections).toBe(1);
		expect(texte).toBe("ベジータは防戦一方に… 目覚めた13号に");
	});

	test("six points donnent une ellipse doublée", () => {
		// #38 p.136.
		const { texte } = normaliserEllipsesPoints("フロート・バイクだ......");
		expect(texte).toBe("フロート・バイクだ……");
	});

	test("ne touche pas aux points de conduite d'un sommaire", () => {
		// #24 p.38 et #88 p.103 : mise en page authentique, espace ou run long.
		const source =
			"レッドリポン軍編.........................名シーン3\nアタック .................................... P103";
		expect(normaliserEllipsesPoints(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("ne touche pas à des points séparés du japonais par une espace", () => {
		// #45 p.16 : « ............ おまえたち ».
		const source = "もろさないぞ\n\n............ おまえたち";
		expect(normaliserEllipsesPoints(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("laisse le français en points ASCII : la règle est japonaise", () => {
		// #20 p.3, transcription bilingue.
		const source = "Ni entendu parler...";
		expect(normaliserEllipsesPoints(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("normaliserEllipsesMidot", () => {
	test("convertit un point médian demi-chasse répété", () => {
		// #26 p.9.
		const { texte, corrections } = normaliserEllipsesMidot("気絶\uff65\uff65\uff65！");
		expect(corrections).toBe(1);
		expect(texte).toBe("気絶…！");
	});

	test("six points médians donnent une ellipse doublée", () => {
		// #58 p.59.
		const { texte } = normaliserEllipsesMidot("ゃねえぞ" + "\uff65".repeat(6));
		expect(texte).toBe("ゃねえぞ……");
	});

	test("ne touche pas un point médian isolé", () => {
		// Garde-fou prescrit : séparateur de composé katakana. Le corpus
		// n'en contient aucun en demi-chasse, mais la garde reste.
		const source = "ドラゴン\uff65ボール";
		expect(normaliserEllipsesMidot(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("ignore le point médian pleine chasse : c'est une autre règle", () => {
		// `normaliserEllipsesNakaguro` s'en charge, avec un seuil plus strict.
		const source = "ミスター・サタン\nなんとか波・・・";
		expect(normaliserEllipsesMidot(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("normaliserEllipsesNakaguro", () => {
	test("convertit un point médian pleine chasse triplé", () => {
		// #182 : « 悟空たちが力を失う事件が発生・・・！ ».
		const { texte, corrections } = normaliserEllipsesNakaguro("事件が発生・・・！");
		expect(corrections).toBe(1);
		expect(texte).toBe("事件が発生…！");
	});

	test("ne touche pas au séparateur isolé", () => {
		// 15 317 occurrences sur 4 109 planches : la population à protéger.
		const source = "ミスター・サタン と ドラゴン・ボール";
		expect(normaliserEllipsesNakaguro(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("ne touche pas au séparateur doublé, qui est une puce de liste", () => {
		// #12 p.172 et #53 : les 18 runs de longueur 2 du corpus ont été lus un
		// par un, aucun n'est une ellipse.
		const source =
			"サヤ人・・宇宙人の・外の世界" + "\n" + "・オーブングランデー・・本編前半・・本編後半";
		expect(normaliserEllipsesNakaguro(source)).toEqual({ texte: source, corrections: 0 });
	});

	test("ne touche qu'à l'ellipse quand les deux usages cohabitent", () => {
		// #169 : les kanji séparés un à un, puis l'ellipse finale.
		const { texte, corrections } = normaliserEllipsesNakaguro(
			"「黒・魔・導・爆・裂・破」・・・！！"
		);
		expect(corrections).toBe(1);
		expect(texte).toBe("「黒・魔・導・爆・裂・破」…！！");
	});
});

describe("retirerRemplacementTerminal", () => {
	test("retire le caractère de remplacement laissé en fin de sortie tronquée", () => {
		// #19 p.305 : 1 074 signes, la sortie a été coupée net.
		const { texte, corrections } = retirerRemplacementTerminal("⑳\n\n④\n\n⑤\n\n\ufffd");
		expect(corrections).toBe(1);
		expect(texte.trimEnd()).toBe("⑳\n\n④\n\n⑤");
	});

	test("retire le caractère seul sur sa ligne", () => {
		// #155 p.37.
		const { texte } = retirerRemplacementTerminal("なが とうじょう\n\ufffd\n次");
		expect(texte).toBe("なが とうじょう\n次");
	});

	test("laisse le caractère pris entre deux signes japonais", () => {
		// #24 p.26 : le retirer souderait « 使えるけではない », une faute
		// silencieuse ; le remplacer serait deviner le kana わ.
		const source = "忍術が使える\ufffdけではない。";
		expect(retirerRemplacementTerminal(source)).toEqual({ texte: source, corrections: 0 });
	});
});

describe("corrigerArtefactsModele", () => {
	test("n'annonce aucune modification sur un texte propre", () => {
		const source = "# 孫悟空\n\n地球育ちのサイヤ人。ドラゴンボールを探す旅に出る。";
		const r = corrigerArtefactsModele(source);
		expect(r.modifie).toBe(false);
		expect(r.texte).toBe(source);
	});

	test("enchaîne plusieurs règles sur une même planche", () => {
		const source =
			"**Page 12**\n\nどうしたのだ？さっきまでの勢いは\uff65\uff65\uff65」\n\nポスター&amp;ラフ集";
		const r = corrigerArtefactsModele(source);
		expect(r.modifie).toBe(true);
		expect(r.texte.trim()).toBe("どうしたのだ？さっきまでの勢いは…」\n\nポスター&ラフ集");
	});

	test("est idempotent : un second passage ne change plus rien", () => {
		const sources = [
			"**Page 4**\n\nかつて、誰もひとり\n\n4",
			"気絶\uff65\uff65\uff65！18号が余裕の勝利!!",
			"ベジータは防戦一方に... 目覚めた13号に",
			"空中基地にThere is no text in the image.",
			"ポスター&amp;ラフスケッチ集",
			"国王（統治） \\rightarrow 43の地区",
			"か…\\n変わった……",
			'次ページからは基本をチェック!!!"}, {"bbox": [74, 1446, 95, 1463], "category": "Page-footer"}]',
		];
		for (const s of sources) {
			const une = corrigerArtefactsModele(s).texte;
			const deux = corrigerArtefactsModele(une).texte;
			expect(deux).toBe(une);
		}
	});

	test("rapporte une entrée par règle, même à zéro correction", () => {
		const r = corrigerArtefactsModele("孫悟空");
		expect(r.rapport.length).toBe(14);
		expect(r.rapport.every((x) => x.corrections === 0)).toBe(true);
	});
});
