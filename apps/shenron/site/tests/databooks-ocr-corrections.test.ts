/**
 * Correcteur de transcriptions de databooks — chaque règle testée isolément,
 * y compris les cas où elle ne doit PAS s'appliquer (mise en page légitime
 * qu'une règle trop large détruirait). Les cas viennent du corpus réel,
 * mesuré le 2026-08-23.
 */
import { describe, expect, test } from "bun:test";
import {
	FAUTES_VALIDEES,
	candidatFuriganaOrphelin,
	contientMojibakeSuspect,
	corrigerFautesDeLecture,
	corrigerTexte,
	corrigerTitresInline,
	estRomajiUniquement,
	normaliserLatinPleineChasse,
	supprimerRepetitionsConsecutives,
} from "../src/lib/databooks-ocr-corrections";

describe("corrigerTitresInline", () => {
	test("renvoie un marqueur coincé en milieu de ligne à la ligne", () => {
		const source =
			"8年間在籍していた多林寺の服だ。 ## PERSONALITY 性格最初はこんなにスルかかった!?";
		const { texte, corrections } = corrigerTitresInline(source);
		expect(corrections).toBe(1);
		// La fonction insère un vrai saut de ligne ; l'espace qui précédait le
		// marqueur reste en fin de ligne précédente — c'est `nettoyerOcr`, dans
		// le pipeline complet, qui la retire (cf. describe("corrigerTexte")).
		expect(texte).toBe(
			"8年間在籍していた多林寺の服だ。 \n## PERSONALITY 性格最初はこんなにスルかかった!?"
		);
	});

	test("plusieurs marqueurs coincés dans le même texte sont tous renvoyés à la ligne", () => {
		const source =
			"17号と18号に殺害されてしまう。 ### 17号 ### 18号 ### 8号(ハッチャム) 特殊な戦闘員たち";
		const { texte, corrections } = corrigerTitresInline(source);
		expect(corrections).toBe(3);
		expect(texte).toBe(
			"17号と18号に殺害されてしまう。 \n### 17号 \n### 18号 \n### 8号(ハッチャム) 特殊な戦闘員たち"
		);
	});

	test("un titre déjà en début de ligne n'est pas touché", () => {
		const source = "# 最新映画を破壊する!! 遼りの化身\n\nサブタイトルか示す通り…";
		const { texte, corrections } = corrigerTitresInline(source);
		expect(corrections).toBe(0);
		expect(texte).toBe(source);
	});

	test("un # collé à un numéro (pas suivi d'une espace) n'est pas un titre", () => {
		const source = "12 神龍内海賢二 DBZ #193から佐藤正治";
		const { texte, corrections } = corrigerTitresInline(source);
		expect(corrections).toBe(0);
		expect(texte).toBe(source);
	});

	test("un # isolé suivi d'un second # collé à un numéro n'est pas coupé (piège du corpus)", () => {
		const source = "## STORY SEQUENCE # #14 「悟空のライバル？ 参上！！」";
		const { texte, corrections } = corrigerTitresInline(source);
		// Le premier ## est déjà en tête de ligne (non touché). Le # isolé au
		// milieu est suivi d'un second # (pas d'un caractère de titre) : on ne
		// le coupe pas, pour ne pas fabriquer un faux niveau de titre.
		expect(corrections).toBe(0);
		expect(texte).toBe(source);
	});

	test("est idempotent", () => {
		const source = "texte ## Titre 1 encore du texte ### Titre 2 fin";
		const premier = corrigerTitresInline(source);
		const second = corrigerTitresInline(premier.texte);
		expect(second.corrections).toBe(0);
		expect(second.texte).toBe(premier.texte);
	});

	test("accepte les niveaux de titre jusqu'à 6 dièses", () => {
		const source = "texte #### Sous-titre";
		const { corrections } = corrigerTitresInline(source);
		expect(corrections).toBe(1);
	});
});

describe("normaliserLatinPleineChasse", () => {
	test("convertit les lettres pleine chasse en forme normale", () => {
		expect(normaliserLatinPleineChasse("ＣＯＮＴＥＮＴＳ").texte).toBe("CONTENTS");
		expect(normaliserLatinPleineChasse("ＤＲＡＧＯＮ ＢＡＬＬ").texte).toBe("DRAGON BALL");
	});

	test("laisse les chiffres pleine chasse intacts", () => {
		// Dans un texte japonais, la pleine chasse est la graphie normale, pas du
		// bruit d'encodage : `１100円(税込)` (marqueur d'item + prix) devenait
		// « 1100円 » — un autre prix. Même règle que pour les noms japonais.
		expect(normaliserLatinPleineChasse("第１話").texte).toBe("第１話");
		expect(normaliserLatinPleineChasse("２０１３年").texte).toBe("２０１３年");
		expect(normaliserLatinPleineChasse("１100円(税込)").texte).toBe("１100円(税込)");
	});

	test("ne touche pas à la ponctuation pleine chasse japonaise", () => {
		const source = "（重要）、これは正しい。";
		expect(normaliserLatinPleineChasse(source).texte).toBe(source);
	});

	test("compte le nombre de caractères convertis", () => {
		expect(normaliserLatinPleineChasse("Ｂボタン").corrections).toBe(1);
	});

	test("est idempotent", () => {
		const converti = normaliserLatinPleineChasse("第１話 ＣＯＮＴＥＮＴＳ").texte;
		expect(converti).toBe("第１話 CONTENTS");
		expect(normaliserLatinPleineChasse(converti).texte).toBe(converti);
	});
});

describe("supprimerRepetitionsConsecutives", () => {
	test("réduit une ligne longue répétée 3 fois ou plus d'affilée à une seule occurrence", () => {
		const source =
			"着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を";
		const { texte, corrections } = supprimerRepetitionsConsecutives(source);
		expect(texte).toBe("着衣に着いた衣を被衣に着いた衣を");
		expect(corrections).toBe(3);
	});

	test("une répétition de 2 (colophon, ISBN) n'est PAS touchée", () => {
		const source = "DRAGON BALL GT\nDRAGON BALL GT\nISBN4-08-874089-0\nISBN4-08-874089-0";
		const { texte, corrections } = supprimerRepetitionsConsecutives(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("une ligne courte répétée (onomatopée, SFX) n'est pas touchée même 4 fois", () => {
		const source = "はあっ！\nはあっ！\nはあっ！\nはあっ！";
		const { texte, corrections } = supprimerRepetitionsConsecutives(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("des répétitions non consécutives (tableau, colonne) ne sont pas touchées", () => {
		const source =
			"孫悟空、界王星で修行する日々を送っていた\nベジータ\n孫悟空、界王星で修行する日々を送っていた\nピッコロ\n孫悟空、界王星で修行する日々を送っていた";
		const { texte, corrections } = supprimerRepetitionsConsecutives(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("est idempotent", () => {
		const source =
			"音楽 声優：古谷 徹 ヤング\n音楽 声優：古谷 徹 ヤング\n音楽 声優：古谷 徹 ヤング\n音楽 声優：古谷 徹 ヤング\n音楽 声優：古谷 徹 ヤング";
		const premier = supprimerRepetitionsConsecutives(source);
		const second = supprimerRepetitionsConsecutives(premier.texte);
		expect(second.corrections).toBe(0);
		expect(second.texte).toBe(premier.texte);
	});
});

describe("corrigerFautesDeLecture", () => {
	test("corrige une confusion sourde/sonore connue", () => {
		const { texte, corrections } = corrigerFautesDeLecture("プロリーが登場する");
		expect(texte).toBe("ブロリーが登場する");
		expect(corrections).toBe(1);
	});

	test("corrige plusieurs graphies fautives différentes dans le même texte", () => {
		const source = "ビッコロとフルマとペジータが登場する";
		const { texte, corrections } = corrigerFautesDeLecture(source);
		expect(texte).toBe("ピッコロとブルマとベジータが登場する");
		expect(corrections).toBe(3);
	});

	test("ne mord pas sur un mot katakana plus long qui contient la graphie comme sous-chaîne", () => {
		// クリン n'est volontairement PAS dans la table (cf. commentaire de
		// FAUTES_VALIDEES), mais le principe de frontière katakana est vérifié
		// sur une entrée réelle avec le même risque : ゲロ (Dr. Gero) ne doit
		// pas être touché s'il fait partie d'un mot katakana plus long.
		const source = "トクター・ゲロプラスなにか"; // faux mot de test, ゲロ suivi de プ (katakana)
		const { corrections } = corrigerFautesDeLecture(source);
		// トクター・ゲロ est bien suivi d'un caractère katakana (プ) : la
		// frontière protège contre une correction à l'intérieur d'un mot plus
		// long qui ne serait pas vraiment « Dr. Gero ».
		expect(corrections).toBe(0);
	});

	test("corrige bien quand la frontière est franche (espace, ponctuation, fin de chaîne)", () => {
		expect(corrigerFautesDeLecture("トクター・ゲロが登場").corrections).toBe(1);
		expect(corrigerFautesDeLecture("トクター・ゲロ").corrections).toBe(1);
		expect(corrigerFautesDeLecture("「トクター・ゲロ」").corrections).toBe(1);
	});

	test("aucune fausse piste connue n'est dans la table (garde-fou de non-régression)", () => {
		const lus = new Set(FAUTES_VALIDEES.map((f) => f.lu));
		for (const rejetee of [
			"ウィス",
			"メカフリーザ",
			"ミスター・ブウ",
			"ポリューム",
			"ピラフロボ",
			"キライ",
			"カブキ",
			"コナッツ",
			"シュラ",
			"タゴマ",
			"ソウラ",
			"カウラ",
			"コウラ",
			"ボタラ",
			"カドレ",
			"カンバニー",
		]) {
			expect(lus.has(rejetee)).toBe(false);
		}
	});

	test("ne touche pas un texte qui ne contient aucune graphie fautive connue", () => {
		const source = "ベジータとブロリーとピッコロが登場する";
		const { texte, corrections } = corrigerFautesDeLecture(source);
		expect(texte).toBe(source);
		expect(corrections).toBe(0);
	});

	test("est idempotent", () => {
		const premier = corrigerFautesDeLecture("プロリーとビッコロとフルマ");
		const second = corrigerFautesDeLecture(premier.texte);
		expect(second.corrections).toBe(0);
		expect(second.texte).toBe(premier.texte);
	});
});

describe("corrigerTexte — pipeline complet", () => {
	test("combine plusieurs règles sur un exemple représentatif du corpus", () => {
		const source =
			"8年間在籍していた多林寺の服だ。 ## PERSONALITY プロリーが登場する ## ＡＢＩＬＩＴＹ ２０１３年の話";
		const { texte, modifie, regles } = corrigerTexte(source);
		expect(modifie).toBe(true);
		expect(texte).toContain("\n## PERSONALITY");
		expect(texte).toContain("## ABILITY");
		expect(texte).toContain("ブロリー");
		// Les chiffres pleine chasse sont conservés (cf. normaliserLatinPleineChasse).
		expect(texte).toContain("２０１３年");
		const parCode = Object.fromEntries(regles.map((r) => [r.code, r.corrections]));
		expect(parCode["titres-inline"]).toBeGreaterThan(0);
		expect(parCode["fautes-de-lecture"]).toBeGreaterThan(0);
		expect(parCode["latin-pleine-chasse"]).toBeGreaterThan(0);
	});

	test("un texte déjà propre n'est pas modifié", () => {
		const source =
			"# 最新映画を破壊する!! 遼りの化身\n\nサブタイトルか示す通り、最新映画で遂に登場する「ブロリー」!!";
		const { texte, modifie } = corrigerTexte(source);
		expect(texte).toBe(source);
		expect(modifie).toBe(false);
	});

	test("le pipeline complet est idempotent", () => {
		const source =
			"8年間在籍していた多林寺の服だ。 ## PERSONALITY プロリーが登場する\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を\n着衣に着いた衣を被衣に着いた衣を  espaces   multiples  ";
		const premier = corrigerTexte(source);
		const second = corrigerTexte(premier.texte);
		expect(second.texte).toBe(premier.texte);
		expect(second.modifie).toBe(false);
	});

	test("ne devine ni ne complète un caractère illisible", () => {
		const source = "鳥山明の�画伯 ## タイトル";
		const { texte } = corrigerTexte(source);
		expect(texte).toContain("�");
	});
});

describe("détecteurs — jamais de correction", () => {
	test("estRomajiUniquement détecte un texte sans aucun signe japonais", () => {
		expect(estRomajiUniquement("EPISODE 138 → 140")).toBe(true);
		expect(estRomajiUniquement("ブロリーが登場する")).toBe(false);
		expect(estRomajiUniquement("")).toBe(false);
	});

	test("contientMojibakeSuspect détecte le motif Latin-1/UTF-8 classique", () => {
		expect(contientMojibakeSuspect("cafÃ©")).toBe(true); // "café" mojibaké
		expect(contientMojibakeSuspect("ブロリーが登場する")).toBe(false);
	});

	test("candidatFuriganaOrphelin repère une courte ligne hiragana isolée", () => {
		expect(candidatFuriganaOrphelin("そーそー")).toBe(true);
		expect(candidatFuriganaOrphelin("がんぐるん")).toBe(true);
		// Une ligne avec kanji ou katakana n'est pas un candidat furigana.
		expect(candidatFuriganaOrphelin("孫悟空")).toBe(false);
		expect(candidatFuriganaOrphelin("ブロリー")).toBe(false);
		// Trop longue : ce n'est plus une lecture de quelques kanji.
		expect(candidatFuriganaOrphelin("あ".repeat(20))).toBe(false);
		// Un seul signe est trop court pour être exploitable.
		expect(candidatFuriganaOrphelin("あ")).toBe(false);
	});
});
