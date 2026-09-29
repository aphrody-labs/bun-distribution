#!/usr/bin/env bun
/**
 * seed-canon — peuple races/sagas/arcs/games avec le canon Dragon Ball
 * (data manuelle vérifiée, source = kanzenshuu + Daizenshuu).
 */
import { db } from "./_db";
import { dbRaces, dbSagas, dbArcs, dbGames } from "../../src/db/schema";
import { eq } from "drizzle-orm";

const RACES = [
	{
		slug: "saiyan",
		name: "Saiyan",
		nameJa: "サイヤ人",
		homePlanetId: null,
		description:
			"Race guerrière disparue après la destruction de Vegeta. Mutants capables de Super Saiyan.",
	},
	{
		slug: "human",
		name: "Humain (Terrien)",
		nameJa: "地球人",
		homePlanetId: null,
		description: "Race indigène de la Terre.",
	},
	{
		slug: "namekian",
		name: "Namek (Namékien)",
		nameJa: "ナメック星人",
		homePlanetId: null,
		description: "Race verte pacifique. Capables de générer les Dragon Balls.",
	},
	{
		slug: "frieza-race",
		name: "Race de Freezer",
		nameJa: "フリーザ一族",
		homePlanetId: null,
		description: "Race froide aux multiples formes (Freezer, Cooler, Cold, Frost).",
	},
	{
		slug: "android",
		name: "Cyborg / Androïde",
		nameJa: "人造人間",
		homePlanetId: null,
		description: "Êtres modifiés ou entièrement mécaniques créés par le Dr Gero.",
	},
	{
		slug: "majin",
		name: "Majin",
		nameJa: "魔人",
		homePlanetId: null,
		description: "Démons rosés créés par Bibidi. Boo et ses formes.",
	},
	{
		slug: "god-of-destruction",
		name: "Dieu de la Destruction",
		nameJa: "破壊神",
		homePlanetId: null,
		description: "12 dieux veillant à l'équilibre cosmique (Beerus, Champa, Quitela…).",
	},
	{
		slug: "angel",
		name: "Ange",
		nameJa: "天使",
		homePlanetId: null,
		description: "Serviteurs des Dieux de la Destruction (Whis, Vados, Marcarita…).",
	},
	{
		slug: "kaioshin",
		name: "Kaioshin (Supreme Kai)",
		nameJa: "界王神",
		homePlanetId: null,
		description: "Dieux créateurs supervisant chaque univers.",
	},
	{
		slug: "demon",
		name: "Démon",
		nameJa: "魔族",
		homePlanetId: null,
		description: "Race démoniaque (Piccolo Daimaô, Dabra, Démons du Mahô-fû).",
	},
	{
		slug: "namek-shenron",
		name: "Race de Shenron",
		nameJa: "神龍",
		homePlanetId: null,
		description: "Dragons divins créés par les Namek.",
	},
	{
		slug: "yardrat",
		name: "Yardratien",
		nameJa: "ヤードラット星人",
		homePlanetId: null,
		description: "Race pacifique maîtrisant le Shunkan Idou (téléportation).",
	},
	{
		slug: "metamorian",
		name: "Métamoran",
		nameJa: "メタモル星人",
		homePlanetId: null,
		description: "Race verte pacifique inventrice de la Fusion Dance.",
	},
	{
		slug: "cerealian",
		name: "Céréalien",
		nameJa: "シリアル星人",
		homePlanetId: null,
		description: "Race violette presque éteinte. Granolah survivant.",
	},
	{
		slug: "core-person",
		name: "Personne-cœur (Daima)",
		nameJa: "芯人",
		homePlanetId: 66,
		description: "Habitants du Monde des Démons dans Daima.",
	},
];

const SAGAS = [
	{
		slug: "pilaf",
		series: "DB",
		orderIdx: 1,
		name: "Saga de Pilaf",
		nameJa: "ピラフ編",
		description: "Quête des Dragon Balls par Goku enfant + Bulma. Apparition Pilaf Gang.",
	},
	{
		slug: "tournament-22",
		series: "DB",
		orderIdx: 2,
		name: "22e Tenkaichi Budôkai",
		nameJa: "第22回天下一武道会編",
		description: null,
	},
	{
		slug: "red-ribbon",
		series: "DB",
		orderIdx: 3,
		name: "Armée du Red Ribbon",
		nameJa: "レッドリボン軍編",
		description: "Goku vs Red Ribbon Army, première fiche cyborg.",
	},
	{
		slug: "uranai-baba",
		series: "DB",
		orderIdx: 4,
		name: "Uranai Baba",
		nameJa: "占いババ編",
		description: null,
	},
	{
		slug: "tournament-22b",
		series: "DB",
		orderIdx: 5,
		name: "22e Tournoi (Tenshinhan)",
		nameJa: null,
		description: null,
	},
	{
		slug: "piccolo-daimao",
		series: "DB",
		orderIdx: 6,
		name: "Piccolo Daimaô",
		nameJa: "ピッコロ大魔王編",
		description: "Mort de Krilin, premier vrai antagoniste majeur.",
	},
	{
		slug: "tournament-23",
		series: "DB",
		orderIdx: 7,
		name: "23e Tenkaichi Budôkai",
		nameJa: "第23回天下一武道会編",
		description: "Goku vs Piccolo Jr. Fin de la série Dragon Ball originale.",
	},
	{
		slug: "saiyan",
		series: "DBZ",
		orderIdx: 1,
		name: "Saga des Saiyans",
		nameJa: "サイヤ人編",
		description: "Arrivée Raditz, Nappa, Vegeta. Mort + résurrection Goku, mort Piccolo.",
	},
	{
		slug: "namek",
		series: "DBZ",
		orderIdx: 2,
		name: "Saga Namek / Freezer",
		nameJa: "ナメック星・フリーザ編",
		description: "Quête des Dragon Balls de Namek, combat épique contre Freezer.",
	},
	{
		slug: "trunks",
		series: "DBZ",
		orderIdx: 3,
		name: "Saga Garlic Jr / Trunks",
		nameJa: null,
		description: "Trunks du futur, mort Freezer + King Cold.",
	},
	{
		slug: "androids",
		series: "DBZ",
		orderIdx: 4,
		name: "Saga des Cyborgs",
		nameJa: "人造人間編",
		description: "Apparition C-17/C-18/C-19/C-20 (Dr Gero).",
	},
	{
		slug: "cell",
		series: "DBZ",
		orderIdx: 5,
		name: "Saga Cell",
		nameJa: "セル編",
		description: "Cell parfait, Cell Game, victoire Gohan SS2.",
	},
	{
		slug: "great-saiyaman",
		series: "DBZ",
		orderIdx: 6,
		name: "Saga Great Saiyaman",
		nameJa: null,
		description: "Inter-saga 25e Tenkaichi Budôkai.",
	},
	{
		slug: "buu",
		series: "DBZ",
		orderIdx: 7,
		name: "Saga Majin Boo",
		nameJa: "魔人ブウ編",
		description: "Babidi, Dabra, Boo + toutes ses formes, Gotenks, Vegitto.",
	},
	{
		slug: "gt-black-star",
		series: "DBGT",
		orderIdx: 1,
		name: "Saga Black Star Dragon Balls",
		nameJa: null,
		description: "Goku enfant + Trunks + Pan. Aventures spatiales.",
	},
	{
		slug: "gt-baby",
		series: "DBGT",
		orderIdx: 2,
		name: "Saga Baby",
		nameJa: null,
		description: "Tuffles, possession de Vegeta.",
	},
	{
		slug: "gt-super-17",
		series: "DBGT",
		orderIdx: 3,
		name: "Saga Super C-17",
		nameJa: null,
		description: "Évasion de l'Enfer, fusion C-17.",
	},
	{
		slug: "gt-shadow-dragons",
		series: "DBGT",
		orderIdx: 4,
		name: "Saga Dragons Maléfiques",
		nameJa: null,
		description: "Dragon Balls noires, Yi Xing Long.",
	},
	{
		slug: "god",
		series: "DBS",
		orderIdx: 1,
		name: "Saga de Battle of Gods",
		nameJa: "神と神編",
		description: "Beerus, première apparition Super Saiyan God.",
	},
	{
		slug: "golden-frieza",
		series: "DBS",
		orderIdx: 2,
		name: "Saga Résurrection F",
		nameJa: "復活のF編",
		description: "Retour Freezer, forme dorée.",
	},
	{
		slug: "champa",
		series: "DBS",
		orderIdx: 3,
		name: "Saga Univers 6",
		nameJa: "宇宙サバイバル編 (Champa)",
		description: "Tournoi entre univers 6 et 7.",
	},
	{
		slug: "future-trunks",
		series: "DBS",
		orderIdx: 4,
		name: "Saga Trunks du Futur (Black Goku)",
		nameJa: "未来トランクス編",
		description: "Goku Black, Zamasu, Trunks futur.",
	},
	{
		slug: "tournament-of-power",
		series: "DBS",
		orderIdx: 5,
		name: "Tournoi du Pouvoir",
		nameJa: "力の大会編",
		description: "8 univers, 80 combattants, Goku Ultra Instinct, Jiren.",
	},
	{
		slug: "broly",
		series: "DBS",
		orderIdx: 6,
		name: "Saga Broly (film)",
		nameJa: null,
		description: "Broly canon, Gogeta.",
	},
	{
		slug: "moro",
		series: "DBS_MANGA",
		orderIdx: 7,
		name: "Saga Moro",
		nameJa: "モロ編",
		description: "Manga only. Goku Ultra Instinct maîtrisé.",
	},
	{
		slug: "granolah",
		series: "DBS_MANGA",
		orderIdx: 8,
		name: "Saga Granolah le survivant",
		nameJa: "顆粒人グラノラ編",
		description: "Manga only. Heeters, Cerealiens, OG-73i.",
	},
	{
		slug: "super-hero",
		series: "DBS_MOVIE",
		orderIdx: 9,
		name: "Saga Super Hero",
		nameJa: null,
		description: "Film 2022. Gamma 1/2, Cell Max, Gohan Beast, Piccolo Orange.",
	},
	{
		slug: "black-frieza",
		series: "DBS_MANGA",
		orderIdx: 10,
		name: "Saga Black Frieza",
		nameJa: "ブラックフリーザ編",
		description: "Manga only. Freezer Noir, fin arc Granolah.",
	},
	{
		slug: "daima",
		series: "DB_DAIMA",
		orderIdx: 1,
		name: "Saga Daima",
		nameJa: "ドラゴンボールDAIMA",
		description: "Goku miniaturisé, Monde des Démons.",
	},
];

const GAMES = [
	{
		slug: "kakarot",
		title: "Dragon Ball Z: Kakarot",
		titleJa: "ドラゴンボールZ KAKAROT",
		platforms: "PS4,PS5,XBO,XSX,Switch,PC",
		releaseDate: new Date("2020-01-16"),
		developer: "CyberConnect2",
		officialUrl: "https://en.bandainamcoent.eu/dragon-ball/dragon-ball-z-kakarot",
	},
	{
		slug: "sparking-zero",
		title: "Dragon Ball: Sparking! Zero",
		titleJa: "ドラゴンボール Sparking! ZERO",
		platforms: "PS5,XSX,PC",
		releaseDate: new Date("2024-10-11"),
		developer: "Spike Chunsoft",
		officialUrl: "https://en.bandainamcoent.eu/dragon-ball/dragon-ball-sparking-zero",
	},
	{
		slug: "xenoverse-2",
		title: "Dragon Ball Xenoverse 2",
		titleJa: "ドラゴンボール ゼノバース2",
		platforms: "PS4,XBO,Switch,PC",
		releaseDate: new Date("2016-10-25"),
		developer: "Dimps",
		officialUrl: "https://en.bandainamcoent.eu/dragon-ball/dragon-ball-xenoverse-2",
	},
	{
		slug: "fighterz",
		title: "Dragon Ball FighterZ",
		titleJa: "ドラゴンボール ファイターズ",
		platforms: "PS4,XBO,Switch,PC",
		releaseDate: new Date("2018-01-26"),
		developer: "Arc System Works",
		officialUrl: "https://en.bandainamcoent.eu/dragon-ball/dragon-ball-fighterz",
	},
	{
		slug: "the-breakers",
		title: "Dragon Ball: The Breakers",
		titleJa: "ドラゴンボール ザ・ブレイカーズ",
		platforms: "PS4,XBO,Switch,PC",
		releaseDate: new Date("2022-10-14"),
		developer: "Dimps",
		officialUrl: "https://en.bandainamcoent.eu/dragon-ball/dragon-ball-the-breakers",
	},
	{
		slug: "dokkan-battle",
		title: "Dragon Ball Z Dokkan Battle",
		titleJa: "ドラゴンボールZ ドッカンバトル",
		platforms: "iOS,Android",
		releaseDate: new Date("2015-01-30"),
		developer: "Akatsuki",
		officialUrl: "https://dbz-dokkanbattle.bn-am.com/",
	},
	{
		slug: "legends",
		title: "Dragon Ball Legends",
		titleJa: "ドラゴンボール レジェンズ",
		platforms: "iOS,Android",
		releaseDate: new Date("2018-05-31"),
		developer: "Dimps",
		officialUrl: "https://legends.dbz.com/",
	},
	{
		slug: "heroes",
		title: "Super Dragon Ball Heroes World Mission",
		titleJa: "スーパードラゴンボールヒーローズ",
		platforms: "Switch,PC",
		releaseDate: new Date("2019-04-04"),
		developer: "Dimps",
	},
	{
		slug: "tenkaichi-3",
		title: "Dragon Ball Z: Budokai Tenkaichi 3",
		titleJa: "ドラゴンボールZ Sparking! METEOR",
		platforms: "PS2,Wii",
		releaseDate: new Date("2007-10-04"),
		developer: "Spike",
	},
	{
		slug: "budokai-3",
		title: "Dragon Ball Z: Budokai 3",
		titleJa: "ドラゴンボールZ3",
		platforms: "PS2",
		releaseDate: new Date("2004-11-16"),
		developer: "Dimps",
	},
];

let r = 0;
for (const x of RACES) {
	const exists = await db.select().from(dbRaces).where(eq(dbRaces.slug, x.slug)).limit(1);
	if (exists.length === 0) {
		await db.insert(dbRaces).values(x);
		r++;
	}
}
let s = 0;
const sagaIdMap: Record<string, number> = {};
for (const x of SAGAS) {
	const existing = await db.select().from(dbSagas).where(eq(dbSagas.slug, x.slug)).limit(1);
	if (existing.length === 0) {
		const inserted = await db
			.insert(dbSagas)
			.values({ ...x, image: null })
			.returning();
		sagaIdMap[x.slug] = inserted[0]!.id;
		s++;
	} else {
		sagaIdMap[x.slug] = existing[0]!.id;
	}
}
let g = 0;
for (const x of GAMES) {
	const exists = await db.select().from(dbGames).where(eq(dbGames.slug, x.slug)).limit(1);
	if (exists.length === 0) {
		await db.insert(dbGames).values({
			...x,
			publisher: "Bandai Namco Entertainment",
			description: null,
			cover: null,
		});
		g++;
	}
}
console.log(`seed-canon : +${r} races, +${s} sagas, +${g} games`);
