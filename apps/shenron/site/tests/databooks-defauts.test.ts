import { describe, expect, it, test } from "bun:test";
import {
	classerDefaut,
	contientBoucle,
	defautDePlanche,
	estPlancheVerifiee,
	gravite,
	noteQualite,
} from "@/lib/databooks-defauts";

/**
 * Le classement des défauts décide de deux choses visibles : ce que la file de
 * relecture propose de rouvrir, et l'avertissement affiché sous une planche.
 * Les cas ci-dessous viennent tous du corpus réel — c'est pour ça qu'ils sont
 * écrits tels quels plutôt qu'inventés.
 */
describe("classerDefaut", () => {
	it("ne signale rien sur une transcription saine", () => {
		expect(classerDefaut("亀仙人に弟子入りした悟空、クリリンが修行を始めた時刻。")).toBeNull();
	});

	it("repère le signe perdu en plein caractère", () => {
		expect(classerDefaut("カプセルコー�")).toBe("remplacement");
	});

	it("repère un alphabet halluciné au milieu du japonais", () => {
		// « S・S・デッドリイюンバー » — un ю cyrillique sorti de nulle part.
		expect(classerDefaut("得意技はS・S・デッドリイюンバー。")).toBe("etranger");
	});

	it("repère du faux chinois (idéogrammes sans un seul kana)", () => {
		expect(classerDefaut("同时也进行了攻击")).toBe("han-sans-kana");
	});

	it("ne rejette pas une page longue en chinois traditionnel", () => {
		const chinois = "龍珠完全版公式手冊\n少年篇～菲利篇\n文化傳信 香港中文版 龍珠文化傳信有限公司";
		expect(classerDefaut(chinois)).toBeNull();
	});

	it("repère la boucle du modèle", () => {
		expect(classerDefaut("いるかといますいるかといますいるかといます")).toBe("boucle");
	});

	it("ne prend pas un tableau markdown pour une boucle", () => {
		// Mesuré sur les catalogues de cartes du Saikyō Jump : le séparateur
		// `|---|---|---|` est la seule répétition qu'une bonne transcription
		// produit, et il faisait tomber 5 planches sur 30.
		const tableau = [
			"| カードNo. | カード名 | カードNo. | カード名 |",
			"|---|---|---|---|",
			"| UM9-048 | 時の界王神 | UM9-SEC3 | 暗黒王メチカブラ |",
		].join("\n");
		expect(classerDefaut(tableau)).toBeNull();
		// …sans pour autant aveugler le détecteur sur le reste de la planche.
		expect(classerDefaut(`${tableau}\nいるかといますいるかといますいるかといます`)).toBe("boucle");
	});

	it("ne prend pas une file d'un meme signe pour une boucle", () => {
		// Notation en etoiles d'une fiche, cases d'un bulletin-reponse, points de
		// conduite d'un sommaire : de la mise en page. Mesure : aucune des 285
		// planches signalees du corpus ne l'est par cette seule signature.
		expect(classerDefaut("戦闘力 ★★★★★★★★★★★★ 最高クラスの強さ")).toBeNull();
		expect(classerDefaut("おなまえ　　　　　　　　　　　　ごじゅうしょ")).toBeNull();
		// …mais une file assez longue reste une sortie emballee.
		expect(classerDefaut(`前書き${"あ".repeat(60)}`)).toBe("boucle");
	});

	it("ne prend pas une grille ou une ellipse imprimée pour une boucle", () => {
		const grille = "六\n星球\n\n五\n星球\n\n四\n星球\n\n三\n星球".repeat(3);
		expect(contientBoucle(grille)).toBe(false);
		expect(contientBoucle("････".repeat(20))).toBe(false);
		expect(contientBoucle("次Pへ次Pへ次Pへ")).toBe(false);
	});

	it("conserve le signal sur une phrase répétée", () => {
		const phrase = "これは十分に長い説明文で、モデルが同じ段落を繰り返しています。";
		expect(contientBoucle(`${phrase}${phrase}${phrase}`)).toBe(true);
	});

	it("distingue une planche muette d'une planche à peine lisible", () => {
		expect(classerDefaut("")).toBe("vide");
		expect(classerDefaut("1992")).toBe("courte");
	});

	it("ne prend pas une page réellement latine pour un défaut", () => {
		expect(classerDefaut("SHUEISHA 1995 Printed in Japan — ISBN4-08-782752-6")).toBeNull();
	});
});

describe("noteQualite", () => {
	it("fait gagner le texte sain sur le texte fautif, même plus long", () => {
		const fautif = "レベルアップ".repeat(50);
		const sain = "オリジナルキャラクター";
		expect(noteQualite(sain)).toBeGreaterThan(noteQualite(fautif));
	});

	it("départage deux textes de même rang par la longueur", () => {
		expect(noteQualite("孫悟空とベジータが戦う場面。")).toBeGreaterThan(
			noteQualite("孫悟空が戦う。")
		);
	});
});

describe("gravite", () => {
	it("compte les signes fautifs pour trier le pire d'abord", () => {
		expect(gravite("あ�い�う�", "remplacement")).toBe(3);
		expect(gravite("デッドリイюンバーとспособ", "etranger")).toBeGreaterThan(1);
	});
});

describe("acquittement manuel", () => {
	// Le cas réel qui a motivé le drapeau : la couverture du V Jump de mars 1995
	// ne porte que « 3月号 » et « COVER ». Neuf signes, des idéogrammes sans un
	// seul kana — deux défauts levés sur une transcription pourtant exacte.
	const couverture = "3月号\nCOVER";

	test("sans drapeau, la couverture reste jugée fautive", () => {
		expect(classerDefaut(couverture)).not.toBeNull();
		expect(defautDePlanche({ text: couverture }, couverture)).not.toBeNull();
	});

	test("le drapeau fait taire les signatures mécaniques", () => {
		expect(defautDePlanche({ text: couverture, verifiee: true }, couverture)).toBeNull();
		expect(estPlancheVerifiee({ verifiee: true })).toBe(true);
	});

	test("acquitter une planche VIDE n'invente pas de transcription", () => {
		// Sinon elle sortirait de la file « à transcrire » sans avoir de texte.
		expect(defautDePlanche({ verifiee: true }, "")).toBe("vide");
	});

	test("seul `true` acquitte (une clé parasite ne suffit pas)", () => {
		for (const v of ["true", 1, null, undefined, {}]) {
			expect(estPlancheVerifiee({ verifiee: v })).toBe(false);
		}
		expect(estPlancheVerifiee(null)).toBe(false);
	});
});
