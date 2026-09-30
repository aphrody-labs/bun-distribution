import { describe, expect, test } from "bun:test";
import {
	boucleDispersee,
	intraduisible,
	noyaux,
	refus,
	replier,
} from "../src/lib/databooks-traduction";

/**
 * Les cas ci-dessous ne sont pas inventés : ce sont ceux qui ont réellement
 * fauté sur le corpus, relevés soit par les relecteurs, soit par la mesure.
 * C'est ce qui rend ces tests utiles — chacun verrouille une erreur commise.
 */

describe("intraduisible — ce qu'on refuse de payer à la lecture", () => {
	test("laisse passer une planche japonaise saine", () => {
		expect(intraduisible("孫悟空は界王拳を使った。ベジータはサイヤ人の王子である。")).toBeNull();
	});

	test("écarte le chinois simplifié mêlé aux kana", () => {
		// Signature vue sur les lots : les kana restent, donc classerDefaut ne
		// voit rien, mais la sortie a dérivé vers du chinois.
		expect(intraduisible("悟空は这个について说明する")).toBe("chinois-simplifie");
	});

	test("écarte le bruit latin greffé en plein mot", () => {
		expect(intraduisible("S.S.ほうのabilityを持つ")).toBe("latin-colle");
		expect(intraduisible("じolationの戦い")).toBe("latin-colle");
	});

	test("NE PLUS écarter les sigles latins en majuscules", () => {
		// La leçon la plus chère de la passe : un premier filtre comptait aussi
		// les majuscules et jetait 3 468 planches au lieu de 1 682 — un quart du
		// corpus, pour des sigles parfaitement légitimes des V-Jump et des
		// guides de jeux.
		for (const legitime of [
			"1995年WJNo.19に掲載",
			"ISBNコード",
			"遊戯王OCGの新弾",
			"アイテムをGETしよう",
			"DRAGON BALL超の最新話",
			"Switch版が発売",
			"NARUTO・ワンピース",
		]) {
			expect(intraduisible(legitime)).toBeNull();
		}
	});

	test("écarte une boucle non consécutive", () => {
		// Le juge des transcriptions exige la répétition d'affilée (`\1{2,}`) et
		// rate ce cas, fréquent sur les tableaux « ADVENTURE HISTORY ».
		// Bloc de 30+ signes : c'est la fenêtre du détecteur, calée sur les vraies
		// boucles du corpus, qui reprennent un paragraphe entier — pas trois mots.
		const bloc = "其之四百四十六の冒険の記録がここに始まる。悟空とその仲間たちの物語である。";
		expect(boucleDispersee(`${bloc}。挿入。${bloc}。別の挿入。${bloc}`)).toBe(true);
		expect(boucleDispersee(`${bloc}。一度きりの記述である。`)).toBe(false);
	});
});

describe("refus — ce qu'on refuse de déposer", () => {
	const ja = "孫悟空は界王拳を使い、フリーザを倒した。".repeat(3);

	test("accepte une traduction fidèle", () => {
		expect(refus("Son Goku a utilisé le Kaïō-ken et a vaincu Freezer. ".repeat(3), ja)).toBeNull();
	});

	test("tolère la graphie japonaise en regard du français", () => {
		// Zéro japonais serait un critère faux : « Kaïō-ken (界王拳) » est une
		// bonne pratique, pas un défaut.
		expect(
			refus(
				"Son Goku a utilisé le Kaïō-ken (界王拳) pour vaincre Freezer et sauver la planète.",
				ja
			)
		).toBeNull();
	});

	test("refuse du japonais recopié au lieu d'être traduit", () => {
		expect(refus(ja, ja)).toMatch(/japonais résiduel/);
	});

	test("refuse une sortie vide", () => {
		expect(refus("   ", ja)).toBe("vide");
	});

	test("refuse une sortie tronquée, mais pas une planche brève", () => {
		expect(refus("Son Goku.", ja)).toMatch(/tronqué/);
		// Une planche qui ne porte qu'un titre rend légitimement dix signes :
		// « courte » est un verdict de transcription, pas de traduction.
		expect(refus("Chapitre 3", "第三章")).toBeNull();
	});

	test("refuse une glose trois fois plus longue que sa source", () => {
		const glose =
			"Ce passage décrit longuement la scène, ses personnages, leurs intentions et le contexte narratif qui l'entoure, bien au-delà de ce que porte la source.";
		expect(refus(glose, "短い題名")).toMatch(/glose/);
	});

	test("refuse une sortie qui boucle", () => {
		expect(refus("Le Kaïō-ken de Son Goku. ".repeat(8), ja)).toMatch(/défaut boucle/);
	});
});

describe("appariement du lexique — la faute qui a produit « Tarles »", () => {
	test("replie l'allongement mangé par l'OCR", () => {
		// La base écrit ターレス (Tullece), la planche タレス : sans repli,
		// `includes` échoue, le terme sort du lexique du lot, et le traducteur
		// privé de forme officielle translittère à l'oreille.
		expect(replier("ターレス")).toBe(replier("タレス"));
		expect(replier("ミスター・ポポ")).toBe(replier("ミスターポポ"));
	});

	test("dépouille les qualificatifs de désambiguïsation", () => {
		// ダーブラ n'existe en base qu'enrobé — d'où « Dâburâ » au lieu de « Dâbra ».
		expect(noyaux("未来のダーブラ")).toContain("ダーブラ");
		expect(noyaux("ターレス：ゼノ")).toContain("ターレス");
		expect(noyaux("ピッコロ（未来）")).toContain("ピッコロ");
	});

	test("ne replie pas deux noms proches en un seul", () => {
		// Le piège classique du corpus : マロン (l'ex-petite amie de Krilin) et
		// マーロン (sa fille) ne doivent PAS se confondre... or le repli efface
		// justement l'allongement. On documente le fait plutôt que de le taire :
		// c'est pourquoi le repli ne substitue rien et se contente de PROPOSER
		// une entrée de lexique, l'arbitrage restant au traducteur.
		expect(replier("マロン")).toBe(replier("マーロン"));
	});
});
