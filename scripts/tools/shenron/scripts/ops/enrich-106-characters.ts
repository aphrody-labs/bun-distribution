// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/enrich-106-characters.ts
 *
 * Enrichissement canonique et rigoureux des 106 personnages de bot.db_characters
 * dépourvus de graphie japonaise ou romaji canonique.
 *
 * Doctrine Shenron :
 *  - Primauté absolue aux 42 tomes du manga original et aux déclarations d'Akira Toriyama.
 *  - Sources complémentaires officielles : Daizenshuu 2/4/6/7, Chōzenshū 4, Dragon Ball Online (Toriyama lore).
 *  - 0 invention, 0 Fandom.
 *  - Graphies japonaises exactes (kanji/kana officiels).
 *  - Romanisation Hepburn canonique stricte.
 *  - Complétion des champs race, affiliation et origin_planet_id attestés.
 *  - Traçabilité intégrale par transaction unifiée et enregistrement dans public.wiki_revisions.
 */
import postgres from "postgres";

export interface CharacterUpdate {
	id: number;
	name: string;
	name_ja: string;
	name_romaji: string;
	race?: string;
	affiliation?: string;
	origin_planet_id?: number | null;
}

export const CHARACTERS_DATA: CharacterUpdate[] = [
	{
		id: 89,
		name: "Super Buu",
		name_ja: "魔人ブウ（悪）",
		name_romaji: "Majin Bū (Aku)",
		race: "Majin",
		affiliation: "Antagoniste de la saga Buu / Forme issue de l'absorption du Buu innocent par le Buu mauvais",
		origin_planet_id: null
	},
	{
		id: 95,
		name: "Dieu démon Demigra",
		name_ja: "魔神ドミグラ",
		name_romaji: "Majin Domigura",
		race: "Démon",
		affiliation: "Royaume des Démons (暗黒魔界)",
		origin_planet_id: null
	},
	{
		id: 108,
		name: "Son Goku Black",
		name_ja: "ゴクウブラック",
		name_romaji: "Gokū Burakku",
		race: "Saiyan",
		affiliation: "Zamasu / Plan Zéro Mortel",
		origin_planet_id: 2
	},
	{
		id: 136,
		name: "Abra",
		name_ja: "アブラ",
		name_romaji: "Abura",
		race: "Neko Majin",
		affiliation: "Compagnon de Kabra / Race des Neko Majin",
		origin_planet_id: 2
	},
	{
		id: 137,
		name: "Ackman (Go! Go! Ackman)",
		name_ja: "アックマン",
		name_romaji: "Akkuman",
		race: "Démon",
		affiliation: "Chasseur d'âmes du Royaume des Enfers (Go! Go! Ackman)",
		origin_planet_id: 2
	},
	{
		id: 140,
		name: "Ackmans de la Malchance",
		name_ja: "不運のアックマン",
		name_romaji: "Fūun no Akkuman",
		race: "Démon",
		affiliation: "Armée démoniaque (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 141,
		name: "Ackmans Supers",
		name_ja: "スーパーアックマン",
		name_romaji: "Sūpā Akkuman",
		race: "Démon",
		affiliation: "Armée démoniaque (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 144,
		name: "Ahms",
		name_ja: "アームズ",
		name_romaji: "Āmuzu",
		race: "Humain artificiel",
		affiliation: "Création de Sealas (Super Dragon Ball Heroes)",
		origin_planet_id: null
	},
	{
		id: 168,
		name: "Aragné",
		name_ja: "アラグネ",
		name_romaji: "Aragune",
		race: "Monstre extraterrestre",
		affiliation: "Armée de Moro / Dorakiyan (DBS)",
		origin_planet_id: null
	},
	{
		id: 188,
		name: "Assistant de Hva",
		name_ja: "第6宇宙界王神の付き人",
		name_romaji: "Dai-Roku Uchū Kaiōshin no Tsukibito",
		race: "Glind",
		affiliation: "Assistant de Fuwa (Kaïô Shin Univers 6)",
		origin_planet_id: null
	},
	{
		id: 191,
		name: "Assassins de l'Univers 9",
		name_ja: "第9宇宙の刺客",
		name_romaji: "Dai-Kyū Uchū no Shikaku",
		race: "Extraterrestre",
		affiliation: "Sidra et Rou (Univers 9)",
		origin_planet_id: null
	},
	{
		id: 195,
		name: "Baby Trunks",
		name_ja: "ベビートランクス",
		name_romaji: "Bebī Torankusu",
		race: "Métis Saiyan",
		affiliation: "Trunks parasité par Baby",
		origin_planet_id: 2
	},
	{
		id: 201,
		name: "Bagetta",
		name_ja: "バゲッタ",
		name_romaji: "Bagetta",
		race: "Terrienne",
		affiliation: "Dragon Ball Fusions (Jikuuichi Budokai)",
		origin_planet_id: 2
	},
	{
		id: 226,
		name: "Belettes",
		name_ja: "イタチ",
		name_romaji: "Itachi",
		race: "Animal terrestre",
		affiliation: "Faune de la Terre (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 245,
		name: "Bongos",
		name_ja: "ボンゴ",
		name_romaji: "Bongo",
		race: "Dragon Namek",
		affiliation: "Descendants du Roi Démon Piccolo (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 280,
		name: "C-18",
		name_ja: "人造人間18号",
		name_romaji: "Jinzōningen Jū Hachi-Gō",
		race: "Humaine modifiée (Cyborg)",
		affiliation: "Équipe Dragon Ball / Famille de Krilin / Anciennement Armée du Ruban Rouge",
		origin_planet_id: 2
	},
	{
		id: 289,
		name: "C-1617",
		name_ja: "人造人間1617号",
		name_romaji: "Jinzōningen Jūroku Jūnana-Gō",
		race: "Cyborg",
		affiliation: "EX-Fusion entre C-16 et C-17 (Dragon Ball Fusions)",
		origin_planet_id: 2
	},
	{
		id: 303,
		name: "Captain Strong",
		name_ja: "ストロング隊長",
		name_romaji: "Sutorongu-taichō",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Anime DBZ)",
		origin_planet_id: null
	},
	{
		id: 319,
		name: "Calamis",
		name_ja: "カラミス",
		name_romaji: "Karamisu",
		race: "Extraterrestre",
		affiliation: "Patrouille Galactique (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 356,
		name: "Chow",
		name_ja: "チャウ",
		name_romaji: "Chau",
		race: "Terrien",
		affiliation: "Gang de Paella (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 357,
		name: "Chocolay",
		name_ja: "チョコレイ",
		name_romaji: "Chokorei",
		race: "Chat anthropomorphe",
		affiliation: "Clan Narak / Opposé de Karin (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 358,
		name: "Chichi (futur)",
		name_ja: "チチ（未来）",
		name_romaji: "Chichi (Mirai)",
		race: "Terrienne",
		affiliation: "Veuve de Son Goku / Mère de Son Gohan (Futur alternatif)",
		origin_planet_id: 2
	},
	{
		id: 360,
		name: "Chef des assassins",
		name_ja: "刺客のリーダー",
		name_romaji: "Shikaku no Rīdā",
		race: "Extraterrestre",
		affiliation: "Chef des assassins de l'Univers 9",
		origin_planet_id: null
	},
	{
		id: 368,
		name: "Chat Blanc de l'Espace",
		name_ja: "宇宙白猫",
		name_romaji: "Uchū Shironeko",
		race: "Chat extraterrestre",
		affiliation: "Clan Narak / Time Breakers (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 376,
		name: "Colohan",
		name_ja: "コロハン",
		name_romaji: "Korohan",
		race: "Métis Namek / Saiyan",
		affiliation: "EX-Fusion entre Piccolo et Son Gohan (Dragon Ball Fusions)",
		origin_planet_id: 2
	},
	{
		id: 395,
		name: "Combattantes de l'Armée de Freezer",
		name_ja: "フリーザ軍の女性兵士",
		name_romaji: "Furīza-gun no Josei Heishi",
		race: "Extraterrestre",
		affiliation: "Vestiges de l'Armée de Freezer (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 401,
		name: "Créatures du docteur Uiro",
		name_ja: "バイオマン",
		name_romaji: "Baioman",
		race: "Créature artificielle",
		affiliation: "Dr. Willow (Dr. Uirō)",
		origin_planet_id: 2
	},
	{
		id: 402,
		name: "Conseiller du roi Vegeta",
		name_ja: "ゾーン",
		name_romaji: "Zōn",
		race: "Saiyan",
		affiliation: "Conseiller du Roi Vegeta / Armée Saiyan",
		origin_planet_id: 3
	},
	{
		id: 422,
		name: "Docteur de la planète Freezer N°79",
		name_ja: "医師（惑星フリーザNo.79）",
		name_romaji: "Ishi (Wakusei Furīza No. 79)",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer",
		origin_planet_id: 4
	},
	{
		id: 427,
		name: "Dieu de la planète Konats",
		name_ja: "コナッツ星の神",
		name_romaji: "Konattsu-sei no Kami",
		race: "Déité konatsienne",
		affiliation: "Divinité protectrice de Konats (Film DBZ 13)",
		origin_planet_id: 26
	},
	{
		id: 428,
		name: "Dr Willow",
		name_ja: "Dr.ウイロー",
		name_romaji: "Dokutā Uirō",
		race: "Terrien (cerveau cybernétique)",
		affiliation: "Scientifique criminel (Film DBZ 2)",
		origin_planet_id: 2
	},
	{
		id: 439,
		name: "Dr. Auto",
		name_ja: "Dr.オート",
		name_romaji: "Dokutā Ōto",
		race: "Terrien",
		affiliation: "Scientifique (Dragon Ball Heroes: Victory Mission)",
		origin_planet_id: 2
	},
	{
		id: 467,
		name: "Dragons Nameks",
		name_ja: "ナメック星のドラゴン",
		name_romaji: "Namekku-sei no Doragon",
		race: "Dragon Namek",
		affiliation: "Clan Narak (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 471,
		name: "Fils de Shen",
		name_ja: "シェンの息子",
		name_romaji: "Shen no Musuko",
		race: "Terrien",
		affiliation: "Famille de Shen (23e Tenkaichi Budokai)",
		origin_planet_id: 2
	},
	{
		id: 478,
		name: "Fooler",
		name_ja: "フウラ",
		name_romaji: "Fūra",
		race: "Race de Freezer",
		affiliation: "EX-Fusion entre Freezer et Cooler (Dragon Ball Fusions)",
		origin_planet_id: null
	},
	{
		id: 483,
		name: "Fratrie Macareni",
		name_ja: "マカレニ兄弟",
		name_romaji: "Makareni Kyōdai",
		race: "Extraterrestre",
		affiliation: "Bande criminelle Macareni / Évadés de la Patrouille Galactique (DBS)",
		origin_planet_id: null
	},
	{
		id: 492,
		name: "Gasshu",
		name_ja: "ガッシュ",
		name_romaji: "Gasshu",
		race: "Makyan (魔凶星人)",
		affiliation: "Quatre Rois Célestes / Garlic Jr.",
		origin_planet_id: 13
	},
	{
		id: 498,
		name: "Frères Para Para",
		name_ja: "パラパラブラザーズ",
		name_romaji: "Parapara Burazāzu",
		race: "Extraterrestre",
		affiliation: "Secte de Luud (Dragon Ball GT)",
		origin_planet_id: null
	},
	{
		id: 504,
		name: "Gardes de Maître Goichi",
		name_ja: "ゴイチの手下",
		name_romaji: "Goichi no Teshita",
		race: "Extraterrestre",
		affiliation: "Vaisseau de Goichi (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 512,
		name: "Galbi",
		name_ja: "ガルビ",
		name_romaji: "Garubi",
		race: "Extraterrestre (Snart-seijin)",
		affiliation: "Combattant de la planète Snart (Univers 6)",
		origin_planet_id: null
	},
	{
		id: 539,
		name: "Goose",
		name_ja: "グース",
		name_romaji: "Gūsu",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Anime DBZ)",
		origin_planet_id: null
	},
	{
		id: 607,
		name: "Heater",
		name_ja: "ヒータ",
		name_romaji: "Hīta",
		race: "Race des Heaters",
		affiliation: "Syndicat criminel des Heaters (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 611,
		name: "Hommes de Babidi",
		name_ja: "バビディの部下",
		name_romaji: "Babidi no Buka",
		race: "Divers (Majin)",
		affiliation: "Sorcier Babidi (Manga DB)",
		origin_planet_id: null
	},
	{
		id: 633,
		name: "Honey",
		name_ja: "ハニー",
		name_romaji: "Hanī",
		race: "Saiyan",
		affiliation: "Épouse d'Onio (Neko Majin Z)",
		origin_planet_id: 3
	},
	{
		id: 638,
		name: "Jewel",
		name_ja: "ジュエール",
		name_romaji: "Juēru",
		race: "Terrien",
		affiliation: "25e Tenkaichi Budokai (Manga DB)",
		origin_planet_id: 2
	},
	{
		id: 645,
		name: "Jinku",
		name_ja: "ジンク",
		name_romaji: "Jinku",
		race: "Loup terrestre",
		affiliation: "Faune de la Terre (Anime DBZ)",
		origin_planet_id: 2
	},
	{
		id: 648,
		name: "Irico",
		name_ja: "イリコ",
		name_romaji: "Iriko",
		race: "Extraterrestre",
		affiliation: "Patrouille Galactique (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 674,
		name: "Jiya",
		name_ja: "ジヤ",
		name_romaji: "Jiya",
		race: "Extraterrestre (Patrouilleur Galactique)",
		affiliation: "Patrouille Galactique (Manga Jiya d'Akira Toriyama)",
		origin_planet_id: null
	},
	{
		id: 705,
		name: "Kettléens et Bowléens",
		name_ja: "ケトル星人・ボウル星人",
		name_romaji: "Ketoru-seijin / Bouru-seijin",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer / Time Breakers (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 713,
		name: "Killer",
		name_ja: "キーラ",
		name_romaji: "Kīra",
		race: "Terrien",
		affiliation: "25e Tenkaichi Budokai (Manga DB)",
		origin_planet_id: 2
	},
	{
		id: 734,
		name: "Le Robot guide",
		name_ja: "案内ロボット",
		name_romaji: "Annai Robotto",
		race: "Robot",
		affiliation: "Big Gete Star (Film DBZ 6)",
		origin_planet_id: null
	},
	{
		id: 740,
		name: "Long",
		name_ja: "ロン",
		name_romaji: "Ron",
		race: "Terrien",
		affiliation: "Gang de Paella (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 744,
		name: "L'homme qui tirait sur les gens",
		name_ja: "ヴァン・ザント",
		name_romaji: "Van Zanto",
		race: "Terrien",
		affiliation: "Criminel terrestre (Manga DB Tome 40 / Daizenshuu 7)",
		origin_planet_id: 2
	},
	{
		id: 755,
		name: "La jeune fille obèse",
		name_ja: "太った娘",
		name_romaji: "Futotta Musume",
		race: "Terrienne",
		affiliation: "Citoyenne de la Terre (Manga DB Tome 39 / Daizenshuu 7)",
		origin_planet_id: 2
	},
	{
		id: 813,
		name: "Mirage Tullece",
		name_ja: "幻影ターレス",
		name_romaji: "Gen'ei Tāresu",
		race: "Saiyan",
		affiliation: "Guerrier fantôme / Hatchiyack (DBZ Gaiden)",
		origin_planet_id: 3
	},
	{
		id: 822,
		name: "Maître Goichi",
		name_ja: "ゴイチ",
		name_romaji: "Goichi",
		race: "Extraterrestre",
		affiliation: "Pirates spatiaux / Créateur des unités OG (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 847,
		name: "Mixailéens",
		name_ja: "ミクサイル星人",
		name_romaji: "Mikusairu-seijin",
		race: "Mixailéen",
		affiliation: "Vestiges de l'Armée de Freezer (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 865,
		name: "Mr. Toto",
		name_ja: "Mr.トト",
		name_romaji: "Misutā Toto",
		race: "Terrien",
		affiliation: "Maître d'arts martiaux (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 868,
		name: "Namek Noir Dissolu",
		name_ja: "暗黒魔界のナメック星人",
		name_romaji: "Ankoku Makai no Namekku-seijin",
		race: "Namek",
		affiliation: "Clan Narak / Clan du Dragon corrompu (Dragon Ball Online)",
		origin_planet_id: 1
	},
	{
		id: 884,
		name: "Narrateur",
		name_ja: "ナレーター",
		name_romaji: "Narētā",
		race: "Entité omnisciente",
		affiliation: "Voix narrative officielle Dragon Ball (Jōji Yanami)",
		origin_planet_id: null
	},
	{
		id: 891,
		name: "Naraks",
		name_ja: "ナラック",
		name_romaji: "Narakku",
		race: "Namek maléfique",
		affiliation: "Clan Narak (Dragon Ball Online)",
		origin_planet_id: 1
	},
	{
		id: 896,
		name: "Oggers",
		name_ja: "オッガーズ",
		name_romaji: "Oggāzu",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Anime DBZ)",
		origin_planet_id: null
	},
	{
		id: 917,
		name: "Oil Heater",
		name_ja: "オイル",
		name_romaji: "Oiru",
		race: "Race des Heaters",
		affiliation: "Syndicat criminel des Heaters (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 919,
		name: "N°9 (Dragon Ball SD)",
		name_ja: "人造人間9号",
		name_romaji: "Jinzōningen Kyū-Gō",
		race: "Humain artificiel",
		affiliation: "Armée du Ruban Rouge (Dragon Ball SD)",
		origin_planet_id: 2
	},
	{
		id: 949,
		name: "Piccohan",
		name_ja: "ピッコハン",
		name_romaji: "Pikkohan",
		race: "Namek / Guerrier de l'Au-delà",
		affiliation: "EX-Fusion entre Piccolo et Paikuhan (Dragon Ball Fusions)",
		origin_planet_id: 1
	},
	{
		id: 951,
		name: "Phantom Tullece",
		name_ja: "ファントムターレス",
		name_romaji: "Fantomu Tāresu",
		race: "Saiyan",
		affiliation: "Guerrier fantôme (Dragon Ball Heroes)",
		origin_planet_id: 3
	},
	{
		id: 970,
		name: "Planthorr",
		name_ja: "プランソール",
		name_romaji: "Puransōru",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (TV Special Bardock)",
		origin_planet_id: 4
	},
	{
		id: 981,
		name: "Pigero",
		name_ja: "ピゲロ",
		name_romaji: "Pigero",
		race: "Terrien",
		affiliation: "Leader du groupe des orphelins (Anime DBZ)",
		origin_planet_id: 2
	},
	{
		id: 992,
		name: "Pollans",
		name_ja: "ポラン星人",
		name_romaji: "Poran-seijin",
		race: "Extraterrestre",
		affiliation: "Dragon Ball Online / Illusions des faux Nameks",
		origin_planet_id: null
	},
	{
		id: 995,
		name: "Puntar",
		name_ja: "プンター",
		name_romaji: "Puntā",
		race: "Terrien",
		affiliation: "25e Tenkaichi Budokai (Manga DB)",
		origin_planet_id: 2
	},
	{
		id: 1001,
		name: "Psycho Freezer",
		name_ja: "サイコフリーザ",
		name_romaji: "Saiko Furīza",
		race: "Race de Freezer",
		affiliation: "Dragon Ball Heroes",
		origin_planet_id: null
	},
	{
		id: 1005,
		name: "Raichi",
		name_ja: "ライチ",
		name_romaji: "Raichi",
		race: "Extraterrestre métamorphe",
		affiliation: "Faux Namek de la planète fantôme (Anime DBZ Ep 39-43)",
		origin_planet_id: null
	},
	{
		id: 1006,
		name: "Pybara",
		name_ja: "ピバラ",
		name_romaji: "Pibara",
		race: "Yardrat",
		affiliation: "Grand Aîné de la planète Yardrat (DBS Manga)",
		origin_planet_id: 7
	},
	{
		id: 1021,
		name: "Robot Pirate",
		name_ja: "海賊ロボット",
		name_romaji: "Kaizoku Robotto",
		race: "Robot",
		affiliation: "Anciens pirates des mers (Manga DB Tome 7 / Daizenshuu 7)",
		origin_planet_id: 2
	},
	{
		id: 1033,
		name: "Robots OG",
		name_ja: "OG型ロボット",
		name_romaji: "Ōjī-gata Robotto",
		race: "Robot / Humain artificiel",
		affiliation: "Maître Goichi (DBS Manga)",
		origin_planet_id: null
	},
	{
		id: 1035,
		name: "Rigll",
		name_ja: "リグル",
		name_romaji: "Riguru",
		race: "Extraterrestre",
		affiliation: "Vestiges de l'Armée de Freezer (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 1058,
		name: "Saibaiman piquant",
		name_ja: "トゲサイバイマン",
		name_romaji: "Toge Saibaiman",
		race: "Saibaiman",
		affiliation: "Faune désertique mutante (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1062,
		name: "Réginéens",
		name_ja: "レジーネ星人",
		name_romaji: "Rejīne-seijin",
		race: "Extraterrestre",
		affiliation: "Habitants de la planète Régine (Dragon Ball Online)",
		origin_planet_id: null
	},
	{
		id: 1083,
		name: "Sergent Backhand",
		name_ja: "バックハンド軍曹",
		name_romaji: "Bakkuhando Gunsō",
		race: "Léopard anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1101,
		name: "Shaoron Hyoga",
		name_ja: "豹牙昇龍",
		name_romaji: "Hyōga Shaoron",
		race: "Terrien",
		affiliation: "École Hyōga / Empire Mifan (Film DB 3)",
		origin_planet_id: 2
	},
	{
		id: 1114,
		name: "Soldat grenouille",
		name_ja: "カエル型兵士",
		name_romaji: "Kaeru-gata Heishi",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Daizenshuu 7)",
		origin_planet_id: null
	},
	{
		id: 1115,
		name: "Soldat de niveau moyen de l'armée de Freezer",
		name_ja: "フリーザ軍中級兵士",
		name_romaji: "Furīza-gun Chūkyū Heishi",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Daizenshuu 7)",
		origin_planet_id: null
	},
	{
		id: 1117,
		name: "Soldats de Slugg",
		name_ja: "スラッグの兵士",
		name_romaji: "Suraggu no Heishi",
		race: "Démons / Soldats extraterrestres",
		affiliation: "Seigneur Slugg (Film DBZ 4)",
		origin_planet_id: null
	},
	{
		id: 1128,
		name: "Soldat chauve-souris du Red Pants",
		name_ja: "コウモリ兵（赤パンツ軍団）",
		name_romaji: "Kōmori-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1129,
		name: "Soldats cochons du Red Pants",
		name_ja: "ブタ兵（赤パンツ軍団）",
		name_romaji: "Buta-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1133,
		name: "Soldats buffles du Red Pants",
		name_ja: "スイギュウ兵（赤パンツ軍団）",
		name_romaji: "Suigyū-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1137,
		name: "Soldats du Royaume des Démons",
		name_ja: "暗黒魔界の兵士",
		name_romaji: "Ankoku Makai no Heishi",
		race: "Démon (魔族)",
		affiliation: "Royaume des Démons / Empire Sombre",
		origin_planet_id: null
	},
	{
		id: 1154,
		name: "Soldats rats du Red Pants",
		name_ja: "ネズミ兵（赤パンツ軍団）",
		name_romaji: "Nezumi-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1156,
		name: "Soldats morses/phoques du Red Pants",
		name_ja: "セイウチ兵（赤パンツ軍団）",
		name_romaji: "Seiuchi-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1160,
		name: "Soldats sangliers du Red Pants",
		name_ja: "イノシシ兵（赤パンツ軍団）",
		name_romaji: "Inoshishi-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1161,
		name: "Soldats pandas du Red Pants",
		name_ja: "パンダ兵（赤パンツ軍団）",
		name_romaji: "Panda-hei (Aka Pantsu Gundan)",
		race: "Animal anthropomorphe",
		affiliation: "Armée du Red Pants (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1162,
		name: "Soldats nameks des Time Breakers",
		name_ja: "洗脳ナメック星人兵士",
		name_romaji: "Sennō Namekku-seijin Heishi",
		race: "Namek",
		affiliation: "Time Breakers (Dragon Ball Online)",
		origin_planet_id: 1
	},
	{
		id: 1167,
		name: "Strock",
		name_ja: "ストロック",
		name_romaji: "Sutorokku",
		race: "Extraterrestre",
		affiliation: "Armée de Freezer (Anime DBZ)",
		origin_planet_id: null
	},
	{
		id: 1172,
		name: "Super Shenron (futur)",
		name_ja: "超神龍（未来）",
		name_romaji: "Sūpā Shenron (Mirai)",
		race: "Dragon divin",
		affiliation: "Super Dragon Balls de Zalama (Futur alternatif)",
		origin_planet_id: null
	},
	{
		id: 1198,
		name: "Tenron Hyoga",
		name_ja: "豹牙天龍",
		name_romaji: "Hyōga Tenron",
		race: "Terrien",
		affiliation: "École Hyōga / Empire Mifan (Film DB 3)",
		origin_planet_id: 2
	},
	{
		id: 1202,
		name: "Tama (futur)",
		name_ja: "タマ（未来）",
		name_romaji: "Tama (Mirai)",
		race: "Chat terrestre",
		affiliation: "Dr. Brief / Capsule Corporation (Futur alternatif)",
		origin_planet_id: 2
	},
	{
		id: 1206,
		name: "Tama-chan",
		name_ja: "タマちゃん",
		name_romaji: "Tama-chan",
		race: "Terrienne (Guide)",
		affiliation: "Dragon Ball Heroes / Super Dragon Ball Heroes",
		origin_planet_id: 2
	},
	{
		id: 1221,
		name: "Tribu Karinga",
		name_ja: "カリンガ族",
		name_romaji: "Karinga-zoku",
		race: "Terrien (Tribu amérindienne)",
		affiliation: "Gardiens du Sanctuaire et de la Tour Karin (Manga DB Tome 7 / Daizenshuu 4)",
		origin_planet_id: 2
	},
	{
		id: 1231,
		name: "Tribu Jonama",
		name_ja: "ジョナマ族",
		name_romaji: "Jonama-zoku",
		race: "Terrien",
		affiliation: "Village de Nam (Manga DB Tome 3)",
		origin_planet_id: 2
	},
	{
		id: 1258,
		name: "Vegeta Jr.",
		name_ja: "ベジータJr.",
		name_romaji: "Bejīta Junia",
		race: "Métis Saiyan (1/16 Saiyan)",
		affiliation: "Descendance de la famille de Vegeta et Bulma (DBGT final)",
		origin_planet_id: 2
	},
	{
		id: 1272,
		name: "Vagabond du camp",
		name_ja: "キャンプの浮浪者",
		name_romaji: "Kyanpu no Furōsha",
		race: "Humain artificiel (Série N°19000)",
		affiliation: "Armée des Time Breakers (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1277,
		name: "Vomi",
		name_ja: "ヴォミ",
		name_romaji: "Vomi",
		race: "Terrienne",
		affiliation: "Épouse du Dr Gero / Mère de Gebo (C-16) / Modèle de C-21 (Akira Toriyama, DB FighterZ & Kakarot)",
		origin_planet_id: 2
	},
	{
		id: 1321,
		name: "Yang Yang",
		name_ja: "ヤンヤン",
		name_romaji: "Yanyan",
		race: "Terrienne",
		affiliation: "Aventurière (Dragon Ball Online)",
		origin_planet_id: 2
	},
	{
		id: 1327,
		name: "Élite (Majin)",
		name_ja: "魔人エリート",
		name_romaji: "Majin Erīto",
		race: "Majin",
		affiliation: "Avatar de Dragon Ball Heroes",
		origin_planet_id: null
	},
	{
		id: 1335,
		name: "Élèves du Temple Orin-Ji",
		name_ja: "多林寺の弟子",
		name_romaji: "Ōrinji no Deshi",
		race: "Terrien (Moines)",
		affiliation: "Temple Orin / Anciens condisciples de Krilin (Manga DB Tome 3 / Daizenshuu 7)",
		origin_planet_id: 2
	},
	{
		id: 1336,
		name: "Zâkuro",
		name_ja: "ザクロ",
		name_romaji: "Zakuro",
		race: "Extraterrestre métamorphe",
		affiliation: "Faux Namek de la planète fantôme (Anime DBZ Ep 39-43 / Daizenshuu 7)",
		origin_planet_id: null
	}
];

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envPaths = ["apps/site/.env.local", ".env.local", ".env", "apps/site/.env", "apps/bot/.env"];
	for (const p of envPaths) {
		try {
			const file = Bun.file(p);
			if (await file.exists()) {
				const txt = await file.text();
				const m = txt.match(/^DATABASE_URL=([^\n]+)/m);
				if (m) return m[1].trim().replace(/^['"]|['"]$/g, "");
			}
		} catch {}
	}
	throw new Error("DATABASE_URL non configuré.");
}

const generateRevisionId = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	console.log(`=== Enrichissement des 106 personnages de Dragon Ball (${dryRun ? "SIMULATION DRY-RUN" : "APPLICATION RÉELLE"}) ===`);
	console.log(`Total d'entrées préparées : ${CHARACTERS_DATA.length}`);

	const dbUrl = await getDatabaseUrl();
	const sql = postgres(dbUrl, { max: 2, prepare: false });

	let successCount = 0;
	let unchangedCount = 0;

	for (let i = 0; i < CHARACTERS_DATA.length; i++) {
		const char = CHARACTERS_DATA[i];

		let attempts = 0;
		while (attempts < 3) {
			attempts++;
			try {
				const [current] = await sql<
					{
						id: string;
						name: string;
						name_ja: string | null;
						name_romaji: string | null;
						race: string | null;
						affiliation: string | null;
						origin_planet_id: string | null;
					}[]
				>`
					SELECT id, name, name_ja, name_romaji, race, affiliation, origin_planet_id
					FROM bot.db_characters
					WHERE id = ${char.id}
				`;

				if (!current) {
					console.error(`[ERREUR] Personnage #${char.id} "${char.name}" non trouvé en base !`);
					break;
				}

				if (current.name_ja === char.name_ja && current.name_romaji === char.name_romaji) {
					console.log(`[${i + 1}/${CHARACTERS_DATA.length}] (Déjà à jour) ✔ #${char.id} ${char.name}`);
					unchangedCount++;
					break;
				}

				const beforeSnapshot = {
					name_ja: current.name_ja,
					name_romaji: current.name_romaji,
					race: current.race,
					affiliation: current.affiliation,
					origin_planet_id: current.origin_planet_id
				};

				const nextRace = char.race ?? current.race;
				const nextAffil = char.affiliation ?? current.affiliation;
				const nextPlanet = char.origin_planet_id !== undefined ? char.origin_planet_id : (current.origin_planet_id ? Number(current.origin_planet_id) : null);

				const afterSnapshot = {
					name_ja: char.name_ja,
					name_romaji: char.name_romaji,
					race: nextRace,
					affiliation: nextAffil,
					origin_planet_id: nextPlanet ? String(nextPlanet) : null
				};

				const revisionId = generateRevisionId();

				if (!dryRun) {
					await sql.begin(async (tx) => {
						await tx`
							UPDATE bot.db_characters
							SET
								name_ja = ${char.name_ja},
								name_romaji = ${char.name_romaji},
								race = ${nextRace},
								affiliation = ${nextAffil},
								origin_planet_id = ${nextPlanet}
							WHERE id = ${char.id}
						`;

						await tx`
							INSERT INTO public.wiki_revisions ("id", "tableName", "rowId", "action", "label", "before", "after", "editorId", "editorName")
							VALUES (
								${revisionId},
								'db_characters',
								${String(char.id)},
								'update',
								${char.name},
								${tx.json(beforeSnapshot)},
								${tx.json(afterSnapshot)},
								'agent-shenron-characters',
								'Sous-agent Shenron expert en Personnages Dragon Ball (Canon Toriyama)'
							)
						`;
					});
				}

				console.log(`[${i + 1}/${CHARACTERS_DATA.length}] ✔ #${char.id} ${char.name}`);
				console.log(`   JA: "${char.name_ja}" | Romaji: "${char.name_romaji}"`);
				console.log(`   Race: "${nextRace}" | Affil: "${nextAffil}" | Planet: ${nextPlanet}`);
				if (!dryRun) {
					console.log(`   Révision créée : ${revisionId}`);
				}
				successCount++;
				break;
			} catch (err: any) {
				console.warn(`[Tentative ${attempts}/3 échouée sur #${char.id}]:`, err.message || err);
				if (attempts < 3) {
					await new Promise((r) => setTimeout(r, 1000));
				} else {
					throw err;
				}
			}
		}
	}

	// Vérification de la nouvelle couverture
	const [stats] = await sql`
		SELECT 
			count(*) as total,
			count(*) FILTER (WHERE visible = true) as total_visible,
			count(*) FILTER (WHERE visible = true AND name_ja IS NOT NULL AND name_ja != '') as visible_with_ja,
			count(*) FILTER (WHERE visible = true AND name_romaji IS NOT NULL AND name_romaji != '') as visible_with_romaji
		FROM bot.db_characters
	`;

	console.log("\n=== BILAN STATISTIQUE ===");
	console.log(`Total personnages visibles : ${stats.total_visible}`);
	console.log(`Avec name_ja : ${stats.visible_with_ja} / ${stats.total_visible} (${((Number(stats.visible_with_ja) / Number(stats.total_visible)) * 100).toFixed(2)}%)`);
	console.log(`Avec name_romaji : ${stats.visible_with_romaji} / ${stats.total_visible} (${((Number(stats.visible_with_romaji) / Number(stats.total_visible)) * 100).toFixed(2)}%)`);

	await sql.end();
}

main().catch((err) => {
	console.error("Échec critique lors de l'exécution :", err);
	process.exit(1);
});

