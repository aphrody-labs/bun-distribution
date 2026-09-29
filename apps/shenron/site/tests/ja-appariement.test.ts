/**
 * Règles d'appariement d'un nom du wiki à sa graphie japonaise.
 *
 * Tous les cas sont tirés du corpus réel des databooks (9 384 planches
 * transcrites, mesure du 2026-08-23) ou des données du jeu Xenoverse 2. Chaque
 * test verrouille une décision prise sur la foi d'une mesure : les faire
 * échouer, c'est revenir à un appariement dont on a constaté qu'il posait la
 * mauvaise graphie sur la mauvaise fiche.
 *
 * Rien ici ne touche la base ni ne charge de dictionnaire.
 */
import { describe, expect, test } from "bun:test";
import {
	cleNom,
	compterOccurrences,
	extraireCandidatsXv2,
	extraireIndexTechniques,
	graphieEspacee,
	graphieSuspecte,
	grouperCandidats,
	juger,
	nombreKanji,
	porteeSource,
} from "../src/lib/ja/appariement";

describe("cleNom", () => {
	test("ignore accents, casse et ponctuation", () => {
		expect(cleNom("Kaméhaméha")).toBe(cleNom("Kamehameha"));
		expect(cleNom("Big bang")).toBe(cleNom("Big Bang"));
		expect(cleNom("Kaioken x20")).toBe(cleNom("Kaioken X20"));
	});

	test("ne confond pas deux techniques voisines", () => {
		// La base porte les deux, et elles n'ont pas la même graphie japonaise.
		expect(cleNom("Canon Garric")).not.toBe(cleNom("Attaque Garric"));
		expect(cleNom("Kamehameha")).not.toBe(cleNom("Super Kamehameha"));
	});
});

describe("extraireCandidatsXv2", () => {
	const docs = [
		{
			id: "xv2-skill-spe_skill_0000",
			markdown: "Kamehameha (かめはめ波) est une compétence Super de Dragon Ball (Xenoverse 2). …",
		},
		{
			// Pas de nom japonais côté jeu : la parenthèse est latine, ce n'est pas une graphie.
			id: "xv2-skill-spe_skill_9999",
			markdown: "Coup spécial (DLC 12) est une compétence Super de Dragon Ball (Xenoverse 2).",
		},
		{ id: "xv2-char-GOK", markdown: "Compétences de Son Goku (Dragon Ball Xenoverse 2) …" },
	];

	test("ne lit que les compétences, et seulement quand la parenthèse est japonaise", () => {
		const c = extraireCandidatsXv2(docs);
		expect(c).toHaveLength(1);
		expect(c[0]).toEqual({ id: "spe_skill_0000", fr: "Kamehameha", ja: "かめはめ波" });
	});
});

describe("grouperCandidats", () => {
	test("conserve les deux graphies d'un nom ambigu plutôt que d'en choisir une", () => {
		// Cas réel : « Makankosappo » sert deux compétences distinctes du jeu.
		const g = grouperCandidats([
			{ id: "a", fr: "Makankosappo", ja: "魔貫光殺砲" },
			{ id: "b", fr: "Makankosappo", ja: "魔弾光殺砲" },
			{ id: "c", fr: "Kamehameha", ja: "かめはめ波" },
		]);
		expect(g.get(cleNom("Makankosappo"))).toHaveLength(2);
		expect(g.get(cleNom("Kamehameha"))).toHaveLength(1);
	});

	test("dédoublonne deux compétences qui portent la même graphie", () => {
		const g = grouperCandidats([
			{ id: "a", fr: "Kikoho", ja: "気功砲" },
			{ id: "b", fr: "Kikoho", ja: "気功砲" },
		]);
		expect(g.get(cleNom("Kikoho"))).toHaveLength(1);
	});
});

describe("compterOccurrences", () => {
	test("compte les répétitions, y compris sur une graphie à parenthèses", () => {
		expect(compterOccurrences("かめはめ波とかめはめ波", "かめはめ波")).toBe(2);
		expect(
			compterOccurrences(
				"元気玉タワー(タイムパトロール用)を放つ",
				"元気玉タワー(タイムパトロール用)"
			)
		).toBe(1);
		expect(compterOccurrences("界王拳", "元気玉")).toBe(0);
		expect(compterOccurrences("界王拳", "")).toBe(0);
	});
});

describe("graphieEspacee", () => {
	test("reconnaît le défaut « un signe, une espace » du wiki", () => {
		// Cas réels de bot.db_characters.name_ja, relevés le 2026-08-23.
		expect(graphieEspacee("ジ ー ミ ズ")).toBe(true);
		expect(graphieEspacee("コ リ ー 博士")).toBe(true);
		expect(graphieEspacee("店 の 主人")).toBe(true);
		expect(graphieEspacee("ジ ン グ ル 村 の 村長")).toBe(true);
		expect(graphieEspacee("フ ラ ッ ペ 博士, Furappe Hakase")).toBe(true);
	});

	test("laisse passer l'espace qui sépare des mots, pas des signes", () => {
		// Le critère naïf « une espace entre deux signes japonais » condamnerait
		// ces valeurs : 92 en base, dont 87 parfaitement légitimes.
		expect(graphieEspacee("ドラゴンボール レジェンズ")).toBe(false);
		expect(graphieEspacee("魔人ブウ 純粋")).toBe(false);
		expect(graphieEspacee("未来 ドクター・ゲロ")).toBe(false);
		expect(graphieEspacee("熱井 ビータ")).toBe(false);
		expect(graphieEspacee("ドラゴンボール 超全集 4: 超事典")).toBe(false);
		expect(graphieEspacee("かめはめ波")).toBe(false);
		expect(graphieEspacee("ミスター・ポポ")).toBe(false);
	});
});

describe("graphieSuspecte", () => {
	test("rejette le signe de remplacement laissé par la lecture automatique", () => {
		// Vu tel quel dans le corpus : « Pick up Battle Skill 元気玉（� ».
		expect(graphieSuspecte("元気�")).toBe(true);
	});

	test("refuse d'écrire une graphie aux signes séparés", () => {
		// Sans cette garde, le prochain remplissage réintroduit le défaut à grande
		// échelle : une telle valeur n'est attestable dans aucun corpus.
		expect(graphieSuspecte("ジ ー ミ ズ")).toBe(true);
		expect(
			juger({
				ja: "ジ ー ミ ズ",
				ambigu: false,
				occurrences: 12,
				motCourant: false,
				dansIndexTechniques: true,
			}).niveau
		).toBe("rejete");
	});

	test("rejette ce qui n'est pas japonais, et ce qui est trop court", () => {
		expect(graphieSuspecte("Final Flash")).toBe(true);
		expect(graphieSuspecte("波")).toBe(true);
		expect(graphieSuspecte("")).toBe(true);
		expect(graphieSuspecte("界王拳")).toBe(false);
	});
});

describe("juger", () => {
	const base = {
		ja: "界王拳",
		ambigu: false,
		occurrences: 166,
		motCourant: false,
		dansIndexTechniques: false,
	};

	test("une graphie que les databooks n'écrivent jamais est rejetée", () => {
		// 491 des 701 graphies proposées par le jeu sont dans ce cas.
		expect(juger({ ...base, occurrences: 0 }).niveau).toBe("rejete");
	});

	test("un nom ambigu est rejeté même si la graphie est attestée", () => {
		expect(juger({ ...base, ambigu: true }).niveau).toBe("rejete");
	});

	test("un mot japonais courant attesté ne suffit pas", () => {
		// 突撃 « charge » est écrit 68 fois dans les databooks sans y désigner la technique.
		expect(juger({ ...base, ja: "突撃", occurrences: 68, motCourant: true }).niveau).toBe(
			"a_verifier"
		);
	});

	test("l'index de techniques d'un databook l'emporte sur JMdict", () => {
		// 自爆 est un mot courant, mais l'index le donne comme technique
		// (15巻 其之二百十五, 栽培マン) : c'est le manga qui parle.
		expect(
			juger({ ...base, ja: "自爆", occurrences: 119, motCourant: true, dansIndexTechniques: true })
				.niveau
		).toBe("sur");
	});

	test("vocabulaire de la série attesté : retenu", () => {
		expect(juger(base).niveau).toBe("sur");
	});
});

describe("nombreKanji", () => {
	test("lit la numérotation des chapitres telle que les databooks l'impriment", () => {
		expect(nombreKanji("十四")).toBe(14);
		expect(nombreKanji("百七十五")).toBe(175);
		expect(nombreKanji("二百二十六")).toBe(226);
		expect(nombreKanji("四百九十")).toBe(490);
		expect(nombreKanji("五百十八")).toBe(518);
		expect(nombreKanji("三")).toBe(3);
	});

	test("refuse ce qui n'est pas un numéral", () => {
		expect(nombreKanji("かめはめ波")).toBeNull();
		expect(nombreKanji("")).toBeNull();
		expect(nombreKanji("226")).toBeNull();
	});
});

describe("extraireIndexTechniques", () => {
	test("lit une entrée d'index et son chapitre", () => {
		const p = [
			{
				texte: [
					"代表技：かめはめ波",
					" * 初登場： 01巻 其之十四",
					" * 使用者： 亀仙人 / ほか クリリン、孫悟空、孫悟飯、ヤムチャなど",
					"亀仙人が開発した伝説的な技！",
				].join("\n"),
			},
		];
		expect(extraireIndexTechniques(p)).toEqual([
			{
				ja: "かめはめ波",
				debut: "01巻 其之十四",
				chapitre: 14,
				usagers: "亀仙人 / ほか クリリン、孫悟空、孫悟飯、ヤムチャなど",
			},
		]);
	});

	test("ignore la prose : le mot 初登場 remonte 382 fois dans le corpus", () => {
		const p = [
			// Légende d'illustration : aucune apparition chiffrée.
			{ texte: "↑初登場時の道着姿。電仙人のもとに来る前の服だ。" },
			// Fiche de personnage : le tome est celui de l'édition complète, pas un chapitre de technique.
			{ texte: "プロフィール・データ\n初登場回： 完全版01巻 其之一" },
		];
		expect(extraireIndexTechniques(p)).toEqual([]);
	});

	test("l'entrée sans utilisateur reste valable", () => {
		const p = [{ texte: "ビッグバンアタック\n * 初登場： 23巻 其之三百四十四" }];
		const r = extraireIndexTechniques(p);
		expect(r).toHaveLength(1);
		expect(r[0].usagers).toBeNull();
		expect(r[0].chapitre).toBe(344);
	});
});

describe("porteeSource", () => {
	test("sépare le statut de la technique de l'exactitude de sa graphie", () => {
		const p = (categorie: string | null, titre: string, dansIndexTechniques = false) =>
			porteeSource({ categorie, titre, dansIndexTechniques });
		expect(p("V-Jump", "V Jump Novembre 2017", true)).toBe("manga");
		expect(p("Databook", "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten")).toBe("ouvrage");
		// Un nom imprimé sur une publicité de carte à jouer ne dit rien de l'œuvre.
		expect(p("V-Jump", "V Jump Novembre 2017")).toBe("periodique");
		expect(p(null, "")).toBe("periodique");
	});

	test("les guides de cartes rangés en « Databook » ne valent pas ouvrage de référence", () => {
		// La base classe les guides Super Dragon Ball Heroes avec les Daizenshuu.
		expect(
			porteeSource({
				categorie: "Databook",
				titre: "SDBH 11th Anniversary Guide",
				dansIndexTechniques: false,
			})
		).toBe("periodique");
	});
});
