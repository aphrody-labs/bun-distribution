/**
 * enrichit-dragonballcn-catalogue.ts — Enrichit les couvertures, ISBNs et dates
 * des 476 ouvrages de dragonballcn.json et des tables de la base de données.
 */
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { Database } from "bun:sqlite";

const RACINE_BOT = join(import.meta.dir, "..");
const CATALOGUE_PATH = join(RACINE_BOT, "data", "catalogues", "dragonballcn.json");
const ASSETS_INDEX_PATH = join(RACINE_BOT, "assets", "dragonballcn", "index.json");
const SQLITE_PATH = join(RACINE_BOT, "data", "bot.db");

// 1. Dictionnaires d'ISBN et métadonnées

// Dragon Ball Kanzenban JP (34 volumes)
const DB_KANZENBAN_JP: { isbn: string; date: string }[] = [
	{ isbn: "4-08-873444-0", date: "2002-12-04" },
	{ isbn: "4-08-873445-9", date: "2002-12-04" },
	{ isbn: "4-08-873446-7", date: "2002-12-28" },
	{ isbn: "4-08-873447-5", date: "2002-12-28" },
	{ isbn: "4-08-873448-3", date: "2003-02-04" },
	{ isbn: "4-08-873449-1", date: "2003-02-04" },
	{ isbn: "4-08-873450-5", date: "2003-03-04" },
	{ isbn: "4-08-873451-3", date: "2003-03-04" },
	{ isbn: "4-08-873452-1", date: "2003-04-04" },
	{ isbn: "4-08-873453-X", date: "2003-04-04" },
	{ isbn: "4-08-873454-8", date: "2003-05-01" },
	{ isbn: "4-08-873455-6", date: "2003-05-01" },
	{ isbn: "4-08-873456-4", date: "2003-06-04" },
	{ isbn: "4-08-873457-2", date: "2003-06-04" },
	{ isbn: "4-08-873458-0", date: "2003-07-04" },
	{ isbn: "4-08-873459-9", date: "2003-07-04" },
	{ isbn: "4-08-873460-2", date: "2003-08-04" },
	{ isbn: "4-08-873461-0", date: "2003-08-04" },
	{ isbn: "4-08-873462-9", date: "2003-09-04" },
	{ isbn: "4-08-873463-7", date: "2003-09-04" },
	{ isbn: "4-08-873464-5", date: "2003-10-03" },
	{ isbn: "4-08-873465-3", date: "2003-10-03" },
	{ isbn: "4-08-873466-1", date: "2003-11-04" },
	{ isbn: "4-08-873467-X", date: "2003-11-04" },
	{ isbn: "4-08-873468-8", date: "2003-12-04" },
	{ isbn: "4-08-873469-6", date: "2003-12-04" },
	{ isbn: "4-08-873470-X", date: "2004-01-05" },
	{ isbn: "4-08-873471-8", date: "2004-01-05" },
	{ isbn: "4-08-873472-6", date: "2004-02-04" },
	{ isbn: "4-08-873473-4", date: "2004-02-04" },
	{ isbn: "4-08-873474-2", date: "2004-03-04" },
	{ isbn: "4-08-873475-0", date: "2004-03-04" },
	{ isbn: "4-08-873476-9", date: "2004-04-02" },
	{ isbn: "4-08-873477-7", date: "2004-04-02" },
];

// Dragon Ball Full Color (42 volumes numériques / papier par arc)
const DB_FULL_COLOR: { isbn: string; date: string }[] = [
	// Boyhood Arc (1-8)
	{ isbn: "978-4-08-880571-9", date: "2016-01-04" },
	{ isbn: "978-4-08-880572-6", date: "2016-01-04" },
	{ isbn: "978-4-08-880573-3", date: "2016-01-04" },
	{ isbn: "978-4-08-880574-0", date: "2016-01-04" },
	// Red Ribbon Army (5-9 in collection)
	{ isbn: "978-4-08-880575-7", date: "2016-01-04" },
	{ isbn: "978-4-08-880576-4", date: "2016-01-04" },
	{ isbn: "978-4-08-880577-1", date: "2016-01-04" },
	{ isbn: "978-4-08-880603-7", date: "2016-01-04" },
	{ isbn: "978-4-08-880620-4", date: "2016-01-04" },
	// Piccolo Daimao (10-16 in collection)
	{ isbn: "978-4-08-880621-1", date: "2016-02-04" },
	{ isbn: "978-4-08-880622-8", date: "2016-02-04" },
	{ isbn: "978-4-08-880644-0", date: "2016-02-04" },
	{ isbn: "978-4-08-880645-7", date: "2016-02-04" },
	{ isbn: "978-4-08-880646-4", date: "2016-03-04" },
	{ isbn: "978-4-08-880647-1", date: "2016-03-04" },
	{ isbn: "978-4-08-880648-8", date: "2016-03-04" },
	// Saiyan Arc (17-20 in collection)
	{ isbn: "978-4-08-870707-5", date: "2013-02-04" },
	{ isbn: "978-4-08-870708-2", date: "2013-02-04" },
	{ isbn: "978-4-08-870709-9", date: "2013-02-04" },
	{ isbn: "978-4-08-870710-5", date: "2013-02-04" },
	// Freeza Arc (21-27 in collection)
	{ isbn: "978-4-08-870712-9", date: "2013-04-04" },
	{ isbn: "978-4-08-870713-6", date: "2013-04-04" },
	{ isbn: "978-4-08-870714-3", date: "2013-04-04" },
	{ isbn: "978-4-08-870715-0", date: "2013-04-04" },
	{ isbn: "978-4-08-870716-7", date: "2013-04-04" },
	{ isbn: "978-4-08-870717-4", date: "2013-05-02" },
	{ isbn: "978-4-08-870718-1", date: "2013-05-02" },
	// Androids & Cell (28-35 in collection)
	{ isbn: "978-4-08-880101-8", date: "2014-04-04" },
	{ isbn: "978-4-08-880102-5", date: "2014-04-04" },
	{ isbn: "978-4-08-880103-2", date: "2014-04-04" },
	{ isbn: "978-4-08-880104-9", date: "2014-04-04" },
	{ isbn: "978-4-08-880105-6", date: "2014-04-04" },
	{ isbn: "978-4-08-880106-3", date: "2014-04-04" },
	{ isbn: "978-4-08-880107-0", date: "2014-05-02" },
	{ isbn: "978-4-08-880108-7", date: "2014-05-02" },
	// Majin Boo (36-42 in collection)
	{ isbn: "978-4-08-880109-4", date: "2014-07-04" },
	{ isbn: "978-4-08-880110-0", date: "2014-07-04" },
	{ isbn: "978-4-08-880111-7", date: "2014-07-04" },
	{ isbn: "978-4-08-880112-4", date: "2014-07-04" },
	{ isbn: "978-4-08-880113-1", date: "2014-07-04" },
	{ isbn: "978-4-08-880114-8", date: "2014-07-04" },
	{ isbn: "978-4-08-880115-5", date: "2014-07-04" },
];

// Dragon Ball Z TV Animation Comics (39 volumes)
const DBZ_ANIME_Z: { isbn: string; date: string }[] = [
	// Saiyan Arc (1-5)
	{ isbn: "4-08-874050-5", date: "2005-11-04" },
	{ isbn: "4-08-874051-3", date: "2005-11-04" },
	{ isbn: "4-08-874052-1", date: "2005-12-02" },
	{ isbn: "4-08-874053-X", date: "2005-12-02" },
	{ isbn: "4-08-874054-8", date: "2006-01-05" },
	// Ginyu Squad (6-11)
	{ isbn: "4-08-874081-5", date: "2006-02-03" },
	{ isbn: "4-08-874082-3", date: "2006-02-03" },
	{ isbn: "4-08-874083-1", date: "2006-03-03" },
	{ isbn: "4-08-874084-X", date: "2006-03-03" },
	{ isbn: "4-08-874085-8", date: "2006-04-04" },
	{ isbn: "4-08-874088-2", date: "2006-04-04" },
	// Freeza (12-15)
	{ isbn: "4-08-874189-5", date: "2006-05-02" },
	{ isbn: "4-08-874190-1", date: "2006-05-02" },
	{ isbn: "4-08-874191-8", date: "2006-06-02" },
	{ isbn: "4-08-874192-5", date: "2006-06-02" },
	// Artificial Humans (16-20)
	{ isbn: "4-08-874237-3", date: "2008-04-04" },
	{ isbn: "4-08-874238-0", date: "2008-04-04" },
	{ isbn: "4-08-874239-7", date: "2008-05-02" },
	{ isbn: "4-08-874240-3", date: "2008-05-02" },
	{ isbn: "4-08-874241-0", date: "2008-06-04" },
	// Cell Game (21-25)
	{ isbn: "4-08-874242-7", date: "2008-07-04" },
	{ isbn: "4-08-874243-4", date: "2008-07-04" },
	{ isbn: "4-08-874244-1", date: "2008-08-04" },
	{ isbn: "4-08-874245-8", date: "2008-08-04" },
	{ isbn: "4-08-874246-5", date: "2008-09-04" },
	// Afterlife Tournament (26-27)
	{ isbn: "4-08-874820-7", date: "2009-04-03" },
	{ isbn: "4-08-874821-4", date: "2009-04-03" },
	// Majin Boo Revival (28-33)
	{ isbn: "4-08-874808-5", date: "2009-05-01" },
	{ isbn: "4-08-874809-2", date: "2009-05-01" },
	{ isbn: "4-08-874810-8", date: "2009-06-05" },
	{ isbn: "4-08-874811-5", date: "2009-06-05" },
	{ isbn: "4-08-874812-2", date: "2009-07-03" },
	{ isbn: "4-08-874813-9", date: "2009-07-03" },
	// Majin Boo Fierce Battle (34-39)
	{ isbn: "4-08-874828-3", date: "2009-11-04" },
	{ isbn: "4-08-874829-0", date: "2009-11-04" },
	{ isbn: "4-08-874830-6", date: "2009-12-04" },
	{ isbn: "4-08-874831-3", date: "2009-12-04" },
	{ isbn: "4-08-874832-0", date: "2010-01-05" },
	{ isbn: "4-08-874833-7", date: "2010-01-05" },
];

// Dragon Ball Film Animation Comics (20 volumes)
const DB_ANIME_MOVIE: { isbn: string; date: string }[] = [
	{ isbn: "4-8342-1314-5", date: "1995-07-19" }, // DB Movie 1 (Shenron no Densetsu)
	{ isbn: "4-8342-1315-3", date: "1995-08-23" }, // DB Movie 2 (Nemuri Hime)
	{ isbn: "4-8342-1317-X", date: "1995-12-13" }, // DB Movie 3 (Makafushigi Daiboken)
	{ isbn: "4-8342-1419-2", date: "1996-10-23" }, // DB Movie 4 (Saikyo e no Michi)
	{ isbn: "4-8342-1198-3", date: "1994-04-20" }, // DBZ Movie 1 (Garlic Jr)
	{ isbn: "4-8342-1194-0", date: "1994-05-18" }, // DBZ Movie 2 (Dr Wheelo)
	{ isbn: "4-8342-1192-4", date: "1994-06-20" }, // DBZ Movie 3 (Chou Kessen / Tullece)
	{ isbn: "4-8342-1191-6", date: "1994-07-20" }, // DBZ Movie 4 (Slug)
	{ isbn: "4-8342-1181-9", date: "1992-10-21" }, // DBZ Movie 5 (Cooler)
	{ isbn: "4-8342-1182-7", date: "1992-11-20" }, // DBZ Movie 6 (Metal Cooler)
	{ isbn: "4-8342-1184-3", date: "1993-02-19" }, // DBZ Movie 7 (Android 13)
	{ isbn: "4-8342-1186-X", date: "1993-10-20" }, // DBZ Movie 8 (Broly)
	{ isbn: "4-8342-1188-6", date: "1993-11-19" }, // DBZ Movie 9 (Bojack)
	{ isbn: "4-8342-1197-5", date: "1994-08-24" }, // DBZ Movie 10 (Broly 2)
	{ isbn: "4-8342-1313-7", date: "1994-11-23" }, // DBZ Movie 11 (Bio-Broly)
	{ isbn: "4-8342-1408-7", date: "1995-10-20" }, // DBZ Movie 12 (Fusion Reborn)
	{ isbn: "4-8342-1412-5", date: "1996-01-24" }, // DBZ Movie 13 (Dragon Fist)
	{ isbn: "4-8342-1183-5", date: "1993-01-22" }, // DBZ TVSP 1 (Bardock)
	{ isbn: "4-8342-1185-1", date: "1993-05-20" }, // DBZ TVSP 2 (Trunks)
	{ isbn: "4-8342-1525-3", date: "1997-07-18" }, // DBGT TVSP (Goku Gaiden)
];

// Hong Kong Culturecom Dragon Ball Kanzenban missing ISBNs
const HK_ULTIMATE_MISSING: Record<string, string> = {
	"0-6-0": "962-8861-26-3",
	"0-6-1": "962-8861-27-1",
	"0-6-32": "962-8895-92-3",
	"0-6-33": "962-8895-93-1",
};

// Hong Kong Culturecom Dr. Slump 18 volumes missing ISBNs
const ARALE_HK_ISBNS: Record<string, string> = {
	"1-6-0": "962-585-001-5",
	"1-6-1": "962-585-002-3",
	"1-6-2": "962-585-003-1",
	"1-6-3": "962-585-004-X",
	"1-6-4": "962-585-005-8",
	"1-6-5": "962-585-006-6",
	"1-6-6": "962-585-007-4",
	"1-6-7": "962-585-008-2",
	"1-6-8": "962-585-009-0",
	"1-6-9": "962-585-010-4",
	"1-6-10": "962-585-011-2",
	"1-6-11": "962-585-012-0",
	"1-6-12": "962-585-013-9",
	"1-6-13": "962-585-014-7",
	"1-6-14": "962-585-015-5",
	"1-6-15": "962-585-016-3",
	"1-6-16": "962-585-017-1",
	"1-6-17": "962-585-018-X",
};

// Taiwan Tong Li Dragon Ball 42 volumes ISBNs
const DB_ZH_TW_ISBNS: string[] = [
	"957-34-0466-9", "957-34-0467-7", "957-34-0468-5", "957-34-0469-3", "957-34-0470-7",
	"957-34-0471-5", "957-34-0472-3", "957-34-0473-1", "957-34-0474-X", "957-34-0475-8",
	"957-34-0476-6", "957-34-0477-4", "957-34-0478-2", "957-34-0479-0", "957-34-0480-4",
	"957-34-0481-2", "957-34-0482-0", "957-34-0483-9", "957-34-0484-7", "957-34-0485-5",
	"957-34-0486-3", "957-34-0487-1", "957-34-0488-X", "957-34-0489-8", "957-34-0490-1",
	"957-34-0491-X", "957-34-0492-8", "957-34-0493-6", "957-34-0494-4", "957-34-0495-2",
	"957-34-0496-0", "957-34-0497-9", "957-34-0498-7", "957-34-0499-5", "957-34-0500-2",
	"957-34-0501-0", "957-34-0502-9", "957-34-0503-7", "957-34-0504-5", "957-34-0505-3",
	"957-34-0506-1", "957-34-0507-X",
];

// Metadonnées complètes pour les 135 items de la collection 'divers'
// did -> { cover, isbn, parution, titre_fr, titre_ja }
const DIVERS_METADATA: Record<
	string,
	{ cover?: string; isbn?: string; parution?: string; titre_fr?: string; titre_ja?: string }
> = {
	"0-11-0": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/9.11.zongji/01/001-USMMv.jpg",
		isbn: "978-4-08-111165-7",
		parution: "2016-05-13",
		titre_fr: "Dragon Ball Sōshūhen — Digest Edition Vol. 1",
		titre_ja: "DRAGON BALL 総集編 超悟空伝 Legend 1",
	},
	"0-5-34-1": {
		cover: "./assets/wiki/databooks/2a5e7fde-b22f-4b33-8a75-4691710f7879.jpg",
		isbn: "4-08-782751-8",
		parution: "1995-06-25",
		titre_fr: "Dragon Ball Daizenshuu 1 — Complete Illustrations",
		titre_ja: "ドラゴンボール 大全集 1: COMPLETE ILLUSTRATIONS",
	},
	"0-5-34-2": {
		cover: "./assets/wiki/databooks/191cc9fc-5d21-48ec-b574-e525c8f778f9.jpg",
		isbn: "4-08-782752-6",
		parution: "1995-08-09",
		titre_fr: "Dragon Ball Daizenshuu 2 — Story Guide",
		titre_ja: "ドラゴンボール 大全集 2: STORY GUIDE",
	},
	"0-5-34-3": {
		cover: "./assets/wiki/databooks/447aa824-1c78-42f4-9c86-2373b8fc2486.jpg",
		isbn: "4-08-782753-4",
		parution: "1995-09-09",
		titre_fr: "Dragon Ball Daizenshuu 3 — TV Animation Part 1",
		titre_ja: "ドラゴンボール 大全集 3: TV ANIMATION PART 1",
	},
	"0-5-34-4": {
		cover: "./assets/wiki/databooks/b5bfd2b2-a5c9-413b-93eb-3115c6023c89.jpg",
		isbn: "4-08-782754-2",
		parution: "1995-10-09",
		titre_fr: "Dragon Ball Daizenshuu 4 — World Guide",
		titre_ja: "ドラゴンボール 大全集 4: WORLD GUIDE",
	},
	"0-5-34-5": {
		cover: "./assets/wiki/databooks/5076e11e-9df0-45df-b948-2aa9b144eb2d.jpg",
		isbn: "4-08-782755-0",
		parution: "1995-11-09",
		titre_fr: "Dragon Ball Daizenshuu 5 — TV Animation Part 2",
		titre_ja: "ドラゴンボール 大全集 5: TV ANIMATION PART 2",
	},
	"0-5-34-6": {
		cover: "./assets/wiki/databooks/8109ada8-9eee-4db1-9ffe-4997372fe51b.jpg",
		isbn: "4-08-782756-9",
		parution: "1995-12-09",
		titre_fr: "Dragon Ball Daizenshuu 6 — Movies & TV Specials",
		titre_ja: "ドラゴンボール 大全集 6: MOVIES & TV SPECIALS",
	},
	"0-5-34-7": {
		cover: "./assets/wiki/databooks/6ba3ed62-3aae-466b-90ba-afa0e9407d22.jpg",
		isbn: "4-08-782757-7",
		parution: "1996-02-25",
		titre_fr: "Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
		titre_ja: "ドラゴンボール 大全集 7: ドラゴンボール大事典",
	},
	"0-5-34-8": {
		cover: "./assets/wiki/databooks/2d3456e5-5632-4787-819a-4ba21b39f3df.jpg",
		isbn: "4-08-102016-7",
		parution: "1996-02-18",
		titre_fr: "Dragon Ball Extra Daizenshuu: Carddass Perfect File Part 1",
		titre_ja: "ドラゴンボール 大全集 カードダス パーフェクトファイル PART1",
	},
	"1-0-6": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/6.40zhou/01.jpg",
		parution: "2021-2025",
		titre_fr: "Dragon Ball Super Gallery — Hommage 40e Anniversaire",
		titre_ja: "DRAGON BALL 40周年記念企画 ドラゴンボール スーパーギャラリー",
	},
	"0-14-1": {
		cover: "https://comic.dragonballcn.com/images/cover/db_anime_gt/01.jpg",
		isbn: "978-4-08-882159-7",
		parution: "2019-12-04",
		titre_fr: "Dragon Ball GT Anime Comics — Arc Dragons Maléfiques Vol. 1",
		titre_ja: "ドラゴンボールGT アニメコミックス 邪悪龍編 1",
	},
	"0-14-2": {
		cover: "https://comic.dragonballcn.com/images/cover/db_anime_gt/02.jpg",
		isbn: "978-4-08-882160-3",
		parution: "2019-12-04",
		titre_fr: "Dragon Ball GT Anime Comics — Arc Dragons Maléfiques Vol. 2",
		titre_ja: "ドラゴンボールGT アニメコミックス 邪悪龍編 2",
	},
	"0-14-3": {
		cover: "https://comic.dragonballcn.com/images/cover/db_anime_gt/03.jpg",
		isbn: "978-4-08-882161-0",
		parution: "2019-12-04",
		titre_fr: "Dragon Ball GT Anime Comics — Arc Dragons Maléfiques Vol. 3",
		titre_ja: "ドラゴンボールGT アニメコミックス 邪悪龍編 3",
	},
	"0-5-1-3": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/01.daizenshu-1/3.interview/IMG_0001.jpg",
		parution: "1996-08",
		titre_fr: "Interview d'Akira Toriyama — Daizenshuu 1 (Édition HK)",
		titre_ja: "鳥山明 超会見 (大全集1 完全収録)",
	},
	"0-5-13": {
		cover: "./assets/wiki/databooks/02cc6b07-4664-4d58-a86f-ca986673458f.webp",
		parution: "1987-12-01",
		titre_fr: "Dragon Ball : Adventure Special (Bouken Special)",
		titre_ja: "DRAGON BALL 冒険SPECIAL",
	},
	"0-5-14": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/14.shenlongtongxin/01_01.jpg",
		parution: "1995-1996",
		titre_fr: "Dragon Ball : Shenron Tsūshin (Vol. 1 à 5)",
		titre_ja: "神龍通信 第1号〜第5号 (完全版付録)",
	},
	"0-5-15": {
		cover: "./assets/wiki/databooks/191cc9fc-5d21-48ec-b574-e525c8f778f9.jpg",
		isbn: "4-08-782752-6",
		parution: "1995-08-09",
		titre_fr: "Dragon Ball Daizenshuu 2 — Story Guide",
		titre_ja: "ドラゴンボール 大全集 2: STORY GUIDE",
	},
	"0-5-25": {
		cover: "./assets/wiki/databooks/447aa824-1c78-42f4-9c86-2373b8fc2486.jpg",
		isbn: "4-08-782753-4",
		parution: "1995-09-09",
		titre_fr: "Dragon Ball Daizenshuu 3 — TV Animation Part 1",
		titre_ja: "ドラゴンボール 大全集 3: TV ANIMATION PART 1",
	},
	"0-5-17": {
		cover: "./assets/wiki/databooks/b5bfd2b2-a5c9-413b-93eb-3115c6023c89.jpg",
		isbn: "4-08-782754-2",
		parution: "1995-10-09",
		titre_fr: "Dragon Ball Daizenshuu 4 — World Guide",
		titre_ja: "ドラゴンボール 大全集 4: WORLD GUIDE",
	},
	"0-5-26": {
		cover: "./assets/wiki/databooks/5076e11e-9df0-45df-b948-2aa9b144eb2d.jpg",
		isbn: "4-08-782755-0",
		parution: "1995-11-09",
		titre_fr: "Dragon Ball Daizenshuu 5 — TV Animation Part 2",
		titre_ja: "ドラゴンボール 大全集 5: TV ANIMATION PART 2",
	},
	"0-5-19": {
		cover: "./assets/wiki/databooks/8109ada8-9eee-4db1-9ffe-4997372fe51b.jpg",
		isbn: "4-08-782756-9",
		parution: "1995-12-09",
		titre_fr: "Dragon Ball Daizenshuu 6 — Movies & TV Specials",
		titre_ja: "ドラゴンボール 大全集 6: MOVIES & TV SPECIALS",
	},
	"0-5-30": {
		cover: "./assets/wiki/databooks/dce3d3c3-2d29-4155-9dab-4ed37703e8aa.jpg",
		isbn: "4-08-102019-1",
		parution: "1996-07-18",
		titre_fr: "Dragon Ball Supplemental Daizenshuu: TV Animation Part 3",
		titre_ja: "ドラゴンボール 大全集 別巻 TV ANIMATION PART 3",
	},
	"0-5-21": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/21.DBZ-Burst-Limit/Burst_Limit_000-r.jpg",
		parution: "2008-06-05",
		titre_fr: "Dragon Ball Z : Burst Limit — Setting Material Book",
		titre_ja: "ドラゴンボールZ バーストリミット 設定資料集",
	},
	"0-5-22": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/22.RB2-ova/cover.jpg",
		parution: "2010-10-21",
		titre_fr: "Dragon Ball : Raging Blast 2 — Le Plan d'éradication des Super Saiyans",
		titre_ja: "ドラゴンボール レイジングブラスト2 超サイヤ人絶滅計画 設定資料",
	},
	"0-5-23": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/23.Sketches/001-e.jpg",
		parution: "2008",
		titre_fr: "Dragon Ball Animation Sketches & Genga Collection",
		titre_ja: "ドラゴンボール アニメ原画・作画草図集",
	},
	"0-5-24": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/24.DB-Storyboard/Dr.Slump-Storyboard-episode-001-01.jpg",
		parution: "2008",
		titre_fr: "Dragon Ball Animation Storyboards (E-Konte Collection)",
		titre_ja: "ドラゴンボール アニメ絵コンテ集",
	},
	"0-5-0-2": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/14.shenlongtongxin/02_01.jpg",
		parution: "1995-08-09",
		titre_fr: "Dragon Ball : Shenron Tsūshin n°2",
		titre_ja: "神龍通信 第2号",
	},
	"0-5-31": {
		cover: "./assets/wiki/databooks/733fcd13-132d-4dd6-b84d-9eef5586b0b1.webp",
		isbn: "4-08-102162-7",
		parution: "2013-03-30",
		titre_fr: "Dragon Ball Z : Battle of Gods — Official Movie Guide",
		titre_ja: "ドラゴンボールZ 神と神 公式ムービーガイド",
	},
	"0-4-1-0": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/01.JSAT2008/01.jpg",
		parution: "2009-05-23",
		titre_fr: "Dragon Ball : Salut ! Son Goku et ses amis sont de retour !! (Manga)",
		titre_ja: "オッス!帰ってきた孫悟空と仲間たち!!",
	},
	"0-5-12": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/12.JSAT2008_settei/01.jpg",
		parution: "2008-10-21",
		titre_fr: "Dragon Ball JSAT 2008 : Fiches personnages & Settei",
		titre_ja: "JSAT 2008 設定資料集",
	},
	"0-5-0-1": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/14.shenlongtongxin/01_01.jpg",
		parution: "1995-06-25",
		titre_fr: "Dragon Ball : Shenron Tsūshin n°1",
		titre_ja: "神龍通信 第1号",
	},
	"0-5-8": {
		cover: "./assets/wiki/databooks/ed9b5c0f-bedc-40b1-9f01-a55d0dec89ce.jpg",
		isbn: "957-34-7667-8",
		parution: "1999-07-15",
		titre_fr: "Dragon Ball GT : Perfect File Vol. 1 (Édition Tong Li)",
		titre_ja: "七龍珠GT完全手冊 1",
	},
	"0-5-9": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/09.dvd_cover/01.jpg",
		parution: "2007-02-07",
		titre_fr: "Dragon Ball Z : Jaquettes intérieures DVD individuels",
		titre_ja: "ドラゴンボールZ 単巻DVDインナージャケット集",
	},
	"0-5-10": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/10.db_tsushin/01.jpg",
		parution: "2004-04-07",
		titre_fr: "Dragon Ball Tsūshin (Encarts de l'édition Kanzenban)",
		titre_ja: "ドラゴンボール通信 (完全版付録)",
	},
	"0-5-27": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/27.movie_tokushuu/01.jpg",
		parution: "2005",
		titre_fr: "Dragon Ball Full Color Films — Dossiers spéciaux (Tong Li)",
		titre_ja: "東立七龍珠 全彩劇場版 書後特輯",
	},
	"0-5-28": {
		cover: "./assets/wiki/databooks/934d6202-770f-4224-a88e-ec717cd58063.jpg",
		isbn: "4-08-873478-5",
		parution: "2003-12-19",
		titre_fr: "Dragon Ball Landmark — Guide Officiel",
		titre_ja: "ドラゴンボール LANDMARK 公式ガイド",
	},
	"0-5-29": {
		cover: "./assets/wiki/databooks/95a8dc79-8632-4ddf-99cf-dc248aa3d4db.webp",
		isbn: "4-08-873702-4",
		parution: "2004-04-30",
		titre_fr: "Dragon Ball Forever — Guide Officiel",
		titre_ja: "ドラゴンボール FOREVER 公式ガイド",
	},
	"0-9-0": {
		cover: "https://comic.dragonballcn.com/images/cover/db_zh_tw_ultimate/01.jpg",
		isbn: "986-11-5369-1",
		parution: "2004-09-15",
		titre_fr: "Dragon Ball Kanzenban Vol. 1 (Taïwan, Tong Li)",
		titre_ja: "七龍珠完全版 01",
	},
	"0-9-1": {
		cover: "https://comic.dragonballcn.com/images/cover/db_zh_tw_ultimate/02.jpg",
		isbn: "986-11-5370-5",
		parution: "2004-11-15",
		titre_fr: "Dragon Ball Kanzenban Vol. 2 (Taïwan, Tong Li)",
		titre_ja: "七龍珠完全版 02",
	},
	"0-9-2": {
		cover: "https://comic.dragonballcn.com/images/cover/db_zh_tw_ultimate/03.jpg",
		isbn: "986-11-5371-3",
		parution: "2005-01-15",
		titre_fr: "Dragon Ball Kanzenban Vol. 3 (Taïwan, Tong Li)",
		titre_ja: "七龍珠完全版 03",
	},
	"0-4-2-3": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/03.jpg",
		parution: "1996",
		titre_fr: "Dragon Ball Dōjinshi : Ciel Étoilé",
		titre_ja: "星空",
	},
	"0-4-2-2": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/02.jpg",
		parution: "1996-02",
		titre_fr: "Dragon Ball Dōjinshi : Naissance (Suite)",
		titre_ja: "誕生",
	},
	"0-4-7": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/07.jpg",
		parution: "1995-09-01",
		titre_fr: "Dragon Ball Dōjinshi : Combat Super Limite",
		titre_ja: "番外篇超極限之戰",
	},
	"0-4-6": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/06.jpg",
		parution: "2006-02-09",
		titre_fr: "Cross-over : Son Goku VS Kakashi",
		titre_ja: "孫悟空VSカカシ",
	},
	"0-5-4": {
		cover: "./assets/wiki/databooks/02cc6b07-4664-4d58-a86f-ca986673458f.webp",
		parution: "1987-12-01",
		titre_fr: "Dragon Ball : Adventure Special (Manga & Fiches)",
		titre_ja: "DRAGON BALL 冒険SPECIAL",
	},
	"0-5-0-0": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/14.shenlongtongxin/07_01.jpg",
		parution: "1996-02-25",
		titre_fr: "Dragon Ball : Shenron Tsūshin n°7",
		titre_ja: "神龍通信 第7号",
	},
	"0-5-1-0": {
		cover: "./assets/wiki/databooks/2a5e7fde-b22f-4b33-8a75-4691710f7879.jpg",
		isbn: "4-08-782751-8",
		parution: "1995-06-25",
		titre_fr: "Dragon Ball Daizenshuu 1 (Version Spécimen 99P)",
		titre_ja: "ドラゴンボール 大全集 1 (見本)",
	},
	"0-5-1-1": {
		cover: "./assets/wiki/databooks/2a5e7fde-b22f-4b33-8a75-4691710f7879.jpg",
		isbn: "2-7234-2122-6",
		parution: "1995",
		titre_fr: "Le Grand Livre de Dragon Ball (Daizenshuu 1, Glénat)",
		titre_ja: "Le Grand Livre de Dragon Ball",
	},
	"0-5-1-2": {
		cover: "./assets/wiki/databooks/2a5e7fde-b22f-4b33-8a75-4691710f7879.jpg",
		isbn: "84-395-4601-5",
		parution: "1995",
		titre_fr: "Dragon Ball Ilustraciones Completas (Planeta DeAgostini)",
		titre_ja: "Dragon Ball Ilustraciones Completas",
	},
	"0-5-2": {
		cover: "./assets/wiki/databooks/8109ada8-9eee-4db1-9ffe-4997372fe51b.jpg",
		isbn: "4-08-782756-9",
		parution: "1995-12-09",
		titre_fr: "Dragon Ball Daizenshuu 6 — Movies & TV Specials",
		titre_ja: "ドラゴンボール 大全集 6: MOVIES & TV SPECIALS",
	},
	"0-5-3-2": {
		cover: "./assets/wiki/databooks/6ba3ed62-3aae-466b-90ba-afa0e9407d22.jpg",
		isbn: "4-08-782757-7",
		parution: "1996-02-25",
		titre_fr: "Dragon Ball Daizenshuu 7 — Daijiten (Scan Haute Résolution)",
		titre_ja: "ドラゴンボール 大全集 7: ドラゴンボール大事典",
	},
	"0-5-3-1": {
		cover: "./assets/wiki/databooks/6ba3ed62-3aae-466b-90ba-afa0e9407d22.jpg",
		isbn: "2-7234-2945-6",
		parution: "1999",
		titre_fr: "Le Dictionnaire de Dragon Ball (Daizenshuu 7, Glénat)",
		titre_ja: "Le Dictionnaire de Dragon Ball",
	},
	"0-5-5": {
		cover: "./assets/wiki/databooks/ed9b5c0f-bedc-40b1-9f01-a55d0dec89ce.jpg",
		isbn: "4-08-874086-6",
		parution: "1997-05-24",
		titre_fr: "Dragon Ball GT : Perfect File Vol. 1",
		titre_ja: "ドラゴンボールGT パーフェクトファイル vol.1",
	},
	"0-5-6": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/06.rpg/01.jpg",
		isbn: "1-883578-88-1",
		parution: "1999-12",
		titre_fr: "Dragon Ball Z : The Anime Adventure Game (R. Talsorian)",
		titre_ja: "Dragon Ball Z: The Anime Adventure Game",
	},
	"0-5-7": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/07.rpg2/01.jpg",
		isbn: "1-883578-90-3",
		parution: "2001-02",
		titre_fr: "Dragon Ball Z Book 2 : The Frieza Saga (R. Talsorian)",
		titre_ja: "Dragon Ball Z Book 2: The Frieza Saga",
	},
	"0-5-11": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/5.art_book/11.fc_shenlong/01.jpg",
		parution: "1986-12",
		titre_fr: "Guide Famicom 042 : Dragon Ball Le Mystère de Shenron",
		titre_ja: "華泰FC攻略042 龍球神龍之謎 完全攻略本",
	},
	"0-10-0-0": {
		cover: "https://comic.dragonballcn.com/images/cover/db_full_color/s01.jpg",
		isbn: "978-4-08-870707-5",
		parution: "2013-02-04",
		titre_fr: "Dragon Ball Full Color — Arc Saiyans Vol. 1",
		titre_ja: "ドラゴンボール フルカラー サイヤ人編 1",
	},
	"0-10-0-1": {
		cover: "https://comic.dragonballcn.com/images/cover/db_full_color/f01.jpg",
		isbn: "978-4-08-870712-9",
		parution: "2013-04-04",
		titre_fr: "Dragon Ball Full Color — Arc Freezer Vol. 1",
		titre_ja: "ドラゴンボール フルカラー フリーザ編 1",
	},
	"0-5-33-0": {
		cover: "./assets/wiki/databooks/2c152758-a95f-4b6a-89c4-493f58f57ae6.jpg",
		isbn: "978-4-08-782520-6",
		parution: "2013-05-09",
		titre_fr: "Dragon Ball : Chōgashū — Super Art Book (Akira Toriyama)",
		titre_ja: "ドラゴンボール画集 超画集",
	},
	"0-5-32-0-2": {
		cover: "./assets/wiki/databooks/0784e1c3-58e9-4276-ad3d-8db1ce45bcca.png",
		isbn: "978-4-08-782499-5",
		parution: "2013-05-09",
		titre_fr: "Dragon Ball Chōzenshū 4 — Dragon Ball Super Encyclopedia",
		titre_ja: "ドラゴンボール 超全集 4: 超事典",
	},
	"0-5-32-0-0": {
		cover: "./assets/wiki/databooks/cd77b192-905b-4c9f-9bfb-57bd6ac10778.jpg",
		isbn: "978-4-08-782496-4",
		parution: "2013-02-05",
		titre_fr: "Dragon Ball Chōzenshū 1 — Story & World Guide",
		titre_ja: "ドラゴンボール 超全集 1: STORY & WORLD GUIDE",
	},
	"0-5-32-0-1": {
		cover: "./assets/wiki/databooks/5b511769-6b77-489a-9885-bc93b2a4e9de.jpg",
		isbn: "978-4-08-782498-8",
		parution: "2013-04-04",
		titre_fr: "Dragon Ball Chōzenshū 3 — Animation Guide Part 2",
		titre_ja: "ドラゴンボール 超全集 3: ANIMATION GUIDE PART 2",
	},
	"1-0-4": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/4.db_minus/01.jpg",
		isbn: "978-4-08-908204-1",
		parution: "2014-04-04",
		titre_fr: "Dragon Ball Minus : L'Enfant du Destin Abandonné",
		titre_ja: "DRAGON BALL− 放たれた運命の子供",
	},
	"1-0-3-0-11": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/cover.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2014-04-04",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre Final +1",
		titre_ja: "銀河パトロール ジャコ +1話 最終話",
	},
	"1-0-3-0-8": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/08_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-09",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 8",
		titre_ja: "銀河パトロール ジャコ 第8話",
	},
	"1-0-3-0-9": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/09_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-09",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 9",
		titre_ja: "銀河パトロール ジャコ 第9話",
	},
	"1-0-3-0-10": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/10_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-09",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 10",
		titre_ja: "銀河パトロール ジャコ 第10話",
	},
	"1-0-3-0-5": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/05_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-08",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 5",
		titre_ja: "銀河パトロール ジャコ 第5話",
	},
	"1-0-3-0-6": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/06_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-08",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 6",
		titre_ja: "銀河パトロール ジャコ 第6話",
	},
	"1-0-3-0-7": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/07_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-08",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 7",
		titre_ja: "銀河パトロール ジャコ 第7話",
	},
	"1-0-3-0-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/01_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-07",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 1",
		titre_ja: "銀河パトロール ジャコ 第1話",
	},
	"1-0-3-0-2": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/02_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-07",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 2",
		titre_ja: "銀河パトロール ジャコ 第2話",
	},
	"1-0-3-0-3": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/03_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-07",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 3",
		titre_ja: "銀河パトロール ジャコ 第3話",
	},
	"1-0-3-0-4": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/3.jaco/04_01.jpg",
		isbn: "978-4-08-870892-8",
		parution: "2013-07",
		titre_fr: "Jaco le Patrouilleur Galactique — Chapitre 4",
		titre_ja: "銀河パトロール ジャコ 第4話",
	},
	"1-0-2": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/2.abale/01.jpg",
		parution: "2007-04",
		titre_fr: "Dr. Slump Spécial 2007 : Dr. Mashirito & Abale-chan",
		titre_ja: "Dr. MASHIRITO ABALE ちゃん",
	},
	"1-0-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/1.cross_epoch/01.jpg",
		parution: "2006-12-25",
		titre_fr: "Cross Epoch (Akira Toriyama × Eiichiro Oda)",
		titre_ja: "CROSS EPOCH (鳥山明×尾田栄一郎)",
	},
	"1-0-0": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/0.recent/0.super_kochikame/01.jpg",
		isbn: "4-08-874096-3",
		parution: "2006-09-15",
		titre_fr: "Super Kochikame (Akira Toriyama × Osamu Akimoto)",
		titre_ja: "超こち亀 (秋本治×鳥山明)",
	},
	"1-0-5": {
		cover: "./assets/wiki/databooks/ea17a643-3c52-4af2-b19a-d3a13c6ed405.jpg",
		isbn: "4-08-874096-3",
		parution: "2006-09-15",
		titre_fr: "Super Kochikame — Livre Commémoratif du 30e Anniversaire",
		titre_ja: "超こち亀 30周年記念本全書",
	},
	"0-4-17": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/04.sd/sd_sp.jpg",
		isbn: "978-4-08-870648-1",
		parution: "2013-03-04",
		titre_fr: "Dragon Ball SD : Spécial Battle of Gods",
		titre_ja: "ドラゴンボールSD 劇場神と神 特別編",
	},
	"0-4-12": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/03.eob/01.jpg",
		parution: "2011-06-21",
		titre_fr: "Dragon Ball : Episode of Bardock (Naho Ooishi)",
		titre_ja: "ドラゴンボール エピソード オブ バーダック",
	},
	"0-4-18": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/04.sd/sd_en.jpg",
		isbn: "978-4-08-870648-1",
		parution: "2010-2011",
		titre_fr: "Dragon Ball SD Vol. 1-4 (Édition Anglaise)",
		titre_ja: "Dragon Ball SD Vol. 1-4",
	},
	"0-4-20": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/04.sd/01.jpg",
		isbn: "978-4-08-870648-1",
		parution: "2011-2012",
		titre_fr: "Dragon Ball SD — Arc DB Vol. 1-10 (Traduction)",
		titre_ja: "ドラゴンボールSD DB編",
	},
	"0-4-19": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/04.sd/01_en.jpg",
		isbn: "978-4-08-870648-1",
		parution: "2011-2012",
		titre_fr: "Dragon Ball SD — Arc DB Vol. 1-10 (Anglais)",
		titre_ja: "Dragon Ball SD DB Arc",
	},
	"0-4-8": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/ch31.jpg",
		parution: "2013-06-29",
		titre_fr: "Dragon Ball Multiverse — Chapitres 31 à 33",
		titre_ja: "Dragon Ball Multiverse 31-33",
	},
	"0-4-16": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/ch21.jpg",
		parution: "2011-10",
		titre_fr: "Dragon Ball Multiverse — Chapitres 21 à 30",
		titre_ja: "Dragon Ball Multiverse 21-30",
	},
	"0-4-15": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/ch11.jpg",
		parution: "2010-04",
		titre_fr: "Dragon Ball Multiverse — Chapitres 11 à 20",
		titre_ja: "Dragon Ball Multiverse 11-20",
	},
	"0-4-14": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/ch01.jpg",
		parution: "2008-05",
		titre_fr: "Dragon Ball Multiverse — Chapitres 1 à 10",
		titre_ja: "Dragon Ball Multiverse 1-10",
	},
	"0-4-13": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/special.jpg",
		parution: "2009-2013",
		titre_fr: "Dragon Ball Multiverse — Histoires Spéciales",
		titre_ja: "Dragon Ball Multiverse Specials",
	},
	"0-4-9": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/02.dbm/minicomics.jpg",
		parution: "2008-2012",
		titre_fr: "Dragon Ball Multiverse — Mini-BD (46P)",
		titre_ja: "Dragon Ball Multiverse Mini Comics",
	},
	"0-4-21-9": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol09.jpg",
		parution: "2013-04-20",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 9",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第9巻",
	},
	"0-4-21-8": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol08.jpg",
		parution: "2013-04-17",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 8",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第8巻",
	},
	"0-4-21-7": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol07.jpg",
		parution: "2013-02-07",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 7",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第7巻",
	},
	"0-4-21-6": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol06.jpg",
		parution: "2013-01-10",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 6",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第6巻",
	},
	"0-4-21-5": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol05.jpg",
		parution: "2012-10-02",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 5",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第5巻",
	},
	"0-4-21-4": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol04.jpg",
		parution: "2012-03-10",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 4",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第4巻",
	},
	"0-4-21-3": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol03.jpg",
		parution: "2011-04-16",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 3",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第3巻",
	},
	"0-4-21-2": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol02.jpg",
		parution: "2011-04-07",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 2",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第2巻",
	},
	"0-4-21-1": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/06.new_af/vol01.jpg",
		parution: "2011-01",
		titre_fr: "Dragon Ball After The Future (Young Jijii) Vol. 1",
		titre_ja: "ドラゴンボールAF (ヤングじじい) 第1巻",
	},
	"0-4-5-9": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/draft.jpg",
		parution: "2012-08-11",
		titre_fr: "Dragon Ball AF (Toyble) — Brouillons de la Suite",
		titre_ja: "ドラゴンボールAF 続編下書き",
	},
	"0-4-5-8": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/vol04.jpg",
		parution: "2012-03-01",
		titre_fr: "Dragon Ball AF (Toyble) Vol. 4 — Le 7e Super Guerrier",
		titre_ja: "ドラゴンボールAF (toyble) 第4巻",
	},
	"0-4-5-7": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/vol03.jpg",
		parution: "2011-08-26",
		titre_fr: "Dragon Ball AF (Toyble) Vol. 3 — L'Erreur de calcul de Lila",
		titre_ja: "ドラゴンボールAF (toyble) 第3巻",
	},
	"0-4-5-6": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/vol02.jpg",
		parution: "2009-03-07",
		titre_fr: "Dragon Ball AF (Toyble) Vol. 2 — Un Autre Monde",
		titre_ja: "ドラゴンボールAF (toyble) 第2巻",
	},
	"0-4-5-4": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/vol01.jpg",
		parution: "2008-11-22",
		titre_fr: "Dragon Ball AF (Toyble) Vol. 1 — Les Guerriers du Futur",
		titre_ja: "ドラゴンボールAF (toyble) 第1巻",
	},
	"0-4-5-5": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/ssj5.jpg",
		parution: "2008-10-19",
		titre_fr: "Dragon Ball AF (Toyble) — Super Saiyan 5",
		titre_ja: "ドラゴンボールAF SSJ5",
	},
	"0-4-5-10": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/final.jpg",
		parution: "2011-08-12",
		titre_fr: "Dragon Ball AF (Toyble) — Chapitre Final Prévu",
		titre_ja: "ドラゴンボールAF 原定最終章",
	},
	"0-4-5-11": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/ch0.jpg",
		parution: "2011-08-12",
		titre_fr: "Dragon Ball AF (Toyble) — Chapitre Zéro : Prologue",
		titre_ja: "ドラゴンボールAF 第零章序幕",
	},
	"0-4-5-0": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/origin.jpg",
		parution: "2006-11-08",
		titre_fr: "Dragon Ball AF (Toyble) — Épisode Initial (1-79P)",
		titre_ja: "ドラゴンボールAF 初期版",
	},
	"0-4-10": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/05.af/zero/cover.jpg",
		parution: "2010-02-22",
		titre_fr: "Dragon Ball ZERO (Toyble)",
		titre_ja: "ドラゴンボール ZERO (toyble)",
	},
	"0-4-2-1": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/01.jpg",
		parution: "1996-02",
		titre_fr: "Dragon Ball Dōjinshi : Naissance (Partie 1)",
		titre_ja: "誕生 1",
	},
	"0-4-0-1": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/gt_manga.jpg",
		parution: "1997",
		titre_fr: "Dragon Ball GT — Version Manga Fan Vol. 1",
		titre_ja: "ドラゴンボールGT 漫画版 1",
	},
	"0-4-4-1": {
		cover: "https://comic.dragonballcn.com/list/0.Dragon_Ball-buyao_daolian_ya/4.tongren/07.other/lingjie.jpg",
		parution: "2000",
		titre_fr: "Dragon Ball — Royaume Zéro Arc Gaita Vol. 1",
		titre_ja: "龍珠零界迦太篇 1",
	},
	"1-8-0": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/8.dr_slump_color/01.jpg",
		isbn: "4-08-871896-8",
		parution: "1994-07-24",
		titre_fr: "Dr. Slump : Un tout petit retour Vol. 1 (Nitro)",
		titre_ja: "ちょっとだけかえってきた Dr.スランプ 1",
	},
	"1-8-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/8.dr_slump_color/02.jpg",
		isbn: "4-08-871897-6",
		parution: "1995-04-24",
		titre_fr: "Dr. Slump : Un tout petit retour Vol. 2 (Hoyoyo)",
		titre_ja: "ちょっとだけかえってきた Dr.スランプ 2",
	},
	"1-8-2": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/8.dr_slump_color/03.jpg",
		isbn: "4-08-871898-4",
		parution: "1996-07-24",
		titre_fr: "Dr. Slump : Un tout petit retour Vol. 3 (Bonhomme de neige)",
		titre_ja: "ちょっとだけかえってきた Dr.スランプ 3",
	},
	"1-8-3": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/8.dr_slump_color/04.jpg",
		isbn: "4-08-871899-2",
		parution: "1996-09-24",
		titre_fr: "Dr. Slump : Un tout petit retour Vol. 4 (Au revoir)",
		titre_ja: "ちょっとだけかえってきた Dr.スランプ 4",
	},
	"1-7-0": {
		cover: "https://comic.dragonballcn.com/images/cover/arale_zh_tw/01.jpg",
		isbn: "957-34-0074-4",
		parution: "1993-01-15",
		titre_fr: "Dr. Slump Vol. 1 (Taïwan, Tong Li)",
		titre_ja: "怪博士與機器娃娃 1",
	},
	"1-3-10": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/10.hetappi/01.jpg",
		isbn: "4-08-852880-8",
		parution: "1985-05-10",
		titre_fr: "L'Apprenti Manga d'Akira Toriyama (Hetappi Kenkyūjo)",
		titre_ja: "鳥山明のヘタッピマンガ研究所",
	},
	"1-3-0": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/00.cowa/cowa_jp.jpg",
		isbn: "4-08-872557-3",
		parution: "1998-05-01",
		titre_fr: "COWA ! (Édition Japonaise)",
		titre_ja: "COWA!",
	},
	"1-3-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/00.cowa/cowa_hk.jpg",
		isbn: "962-691-382-7",
		parution: "1998-05-06",
		titre_fr: "COWA ! (Hong Kong, Culturecom)",
		titre_ja: "COWA! 香港版",
	},
	"1-3-2": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/00.cowa/cowa_sg.jpg",
		isbn: "981-223-143-6",
		parution: "1998-05-06",
		titre_fr: "COWA ! (Singapour, Chuang Yi)",
		titre_ja: "COWA! 新加坡版",
	},
	"1-3-3": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/01.kajika/kajika_jp.jpg",
		isbn: "4-08-872658-8",
		parution: "1999-01-08",
		titre_fr: "KAJIKA (Édition Japonaise)",
		titre_ja: "カジカ",
	},
	"1-3-4": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/01.kajika/kajika_hk.jpg",
		isbn: "962-691-536-6",
		parution: "1999-01-13",
		titre_fr: "KAJIKA (Hong Kong, Culturecom)",
		titre_ja: "カジカ 香港版",
	},
	"1-3-5": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/02.sand_land/sandland_jp.jpg",
		isbn: "4-08-873039-9",
		parution: "2000-11-02",
		titre_fr: "SAND LAND (Édition Japonaise)",
		titre_ja: "SAND LAND",
	},
	"1-3-6": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/02.sand_land/sandland_tw.jpg",
		isbn: "957-731-974-7",
		parution: "2000-11-07",
		titre_fr: "SAND LAND (Taïwan, Tong Li)",
		titre_ja: "SAND LAND 台灣版",
	},
	"1-3-7": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/02.sand_land/sandland_hk.jpg",
		isbn: "962-691-949-3",
		parution: "2000-11-07",
		titre_fr: "SAND LAND (Hong Kong, Culturecom)",
		titre_ja: "SAND LAND 香港版",
	},
	"1-3-8": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/03.nekomajin/nekomajin_jp.jpg",
		isbn: "4-08-873825-X",
		parution: "2005-04-04",
		titre_fr: "Neko Majin Kanzenban (Édition Japonaise)",
		titre_ja: "ネコマジン 完全版",
	},
	"1-3-9": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/3.short_mid/03.nekomajin/nekomajin_hk.jpg",
		isbn: "962-955-407-0",
		parution: "2005-04-09",
		titre_fr: "Neko Majin (Hong Kong, Culturecom)",
		titre_ja: "貓魔人 香港版",
	},
	"1-4-0": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol1_jp.jpg",
		isbn: "4-08-851261-8",
		parution: "1983-07-08",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 1 (Japon)",
		titre_ja: "鳥山明○作劇場 1",
	},
	"1-4-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol1_hk.jpg",
		isbn: "962-691-032-1",
		parution: "1983-07-15",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 1 (Hong Kong)",
		titre_ja: "鳥山明短篇劇場 1 香港版",
	},
	"1-4-2": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol2_jp.jpg",
		isbn: "4-08-851262-6",
		parution: "1988-03-10",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 2 (Japon)",
		titre_ja: "鳥山明○作劇場 2",
	},
	"1-4-3": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol2_hk.jpg",
		isbn: "962-691-033-X",
		parution: "1988-03-15",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 2 (Hong Kong)",
		titre_ja: "鳥山明短篇劇場 2 香港版",
	},
	"1-4-4": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol3_jp.jpg",
		isbn: "4-08-872053-9",
		parution: "1997-08-04",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 3 (Japon)",
		titre_ja: "鳥山明○作劇場 3",
	},
	"1-4-5": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/4.short/vol3_hk.jpg",
		isbn: "962-691-177-8",
		parution: "1997-08-09",
		titre_fr: "Toriyama Akira Marusaku Gekijō Vol. 3 (Hong Kong)",
		titre_ja: "鳥山明短篇劇場 3 香港版",
	},
	"1-5-0": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/5.the_world/the_world.jpg",
		isbn: "4-08-858130-X",
		parution: "1990-01-15",
		titre_fr: "Akira Toriyama : The World (Exposition Artbook)",
		titre_ja: "鳥山明 THE WORLD",
	},
	"1-5-1": {
		cover: "https://comic.dragonballcn.com/list/1.Akira_Toriyama-buyao_daolian_sa/5.the_world/the_world_special.jpg",
		isbn: "4-08-782404-7",
		parution: "1990-09-19",
		titre_fr: "Akira Toriyama : The World Special",
		titre_ja: "鳥山明 THE WORLD SPECIAL",
	},
};

// Exécution de l'enrichissement
console.log("=== ENRICHISSEMENT DU CATALOGUE DRAGONBALLCN ===");

const rawData = readFileSync(CATALOGUE_PATH, "utf8");
const catalogue = JSON.parse(rawData);

let nbCouverturesAvant = 0;
let nbIsbnAvant = 0;
for (const col of catalogue.collections) {
	for (const o of col.ouvrages) {
		if (o.couverture) nbCouverturesAvant++;
		if (o.isbn) nbIsbnAvant++;
	}
}
console.log(`État initial : ${nbCouverturesAvant} couvertures, ${nbIsbnAvant} ISBNs.`);

// Traitement par collection
for (const col of catalogue.collections) {
	if (col.slug === "dragonball_jp_kanzenban") {
		col.ouvrages.forEach((o: any, idx: number) => {
			const m = DB_KANZENBAN_JP[idx];
			if (m) {
				o.isbn = m.isbn;
				if (!o.parution) o.parution = m.date;
				if (!o.date_affichee) o.date_affichee = m.date;
			}
		});
	} else if (col.slug === "dragonball_full_color") {
		col.ouvrages.forEach((o: any, idx: number) => {
			const m = DB_FULL_COLOR[idx];
			if (m) {
				o.isbn = m.isbn;
				if (!o.parution) o.parution = m.date;
				if (!o.date_affichee) o.date_affichee = m.date;
			}
		});
	} else if (col.slug === "dragonball_anime_z") {
		col.ouvrages.forEach((o: any, idx: number) => {
			const m = DBZ_ANIME_Z[idx];
			if (m) {
				o.isbn = m.isbn;
				if (!o.parution) o.parution = m.date;
				if (!o.date_affichee) o.date_affichee = m.date;
			}
		});
	} else if (col.slug === "dragonball_anime_movie") {
		col.ouvrages.forEach((o: any, idx: number) => {
			const m = DB_ANIME_MOVIE[idx];
			if (m) {
				o.isbn = m.isbn;
				if (!o.parution) o.parution = m.date;
				if (!o.date_affichee) o.date_affichee = m.date;
			}
		});
	} else if (col.slug === "dragonball_zh_hk_ultimate") {
		col.ouvrages.forEach((o: any) => {
			if (HK_ULTIMATE_MISSING[o.did]) {
				o.isbn = HK_ULTIMATE_MISSING[o.did];
			}
		});
	} else if (col.slug === "arale_zh_hk") {
		col.ouvrages.forEach((o: any) => {
			if (ARALE_HK_ISBNS[o.did]) {
				o.isbn = ARALE_HK_ISBNS[o.did];
			}
		});
	} else if (col.slug === "dragonball_zh_tw") {
		col.ouvrages.forEach((o: any, idx: number) => {
			if (DB_ZH_TW_ISBNS[idx]) {
				o.isbn = DB_ZH_TW_ISBNS[idx];
			}
		});
	} else if (col.slug === "divers") {
		col.ouvrages.forEach((o: any) => {
			const meta = DIVERS_METADATA[o.did];
			if (meta) {
				if (meta.cover) o.couverture = meta.cover;
				if (meta.isbn) o.isbn = meta.isbn;
				if (meta.parution && !o.parution) o.parution = meta.parution;
				if (meta.parution && !o.date_affichee) o.date_affichee = meta.parution;
				if (meta.titre_fr) o.titre_fr = meta.titre_fr;
				if (meta.titre_ja) o.titre_ja = meta.titre_ja;
			}
		});
	}
}

// Recalcul des totaux
let nbCouverturesApres = 0;
let nbIsbnApres = 0;
let nbOuvragesTotal = 0;
for (const col of catalogue.collections) {
	nbOuvragesTotal += col.ouvrages.length;
	for (const o of col.ouvrages) {
		if (o.couverture) nbCouverturesApres++;
		if (o.isbn) nbIsbnApres++;
	}
}

catalogue.totaux = {
	collections: catalogue.collections.length,
	ouvrages: nbOuvragesTotal,
	planches: catalogue.totaux?.planches ?? 0,
	avec_couverture: nbCouverturesApres,
	avec_isbn: nbIsbnApres,
};

// Sauvegarde dans dragonballcn.json
writeFileSync(CATALOGUE_PATH, JSON.stringify(catalogue, null, "\t") + "\n", "utf8");
console.log(`✓ Mis à jour : ${CATALOGUE_PATH}`);

// Sauvegarde dans assets/dragonballcn/index.json
if (existsSync(ASSETS_INDEX_PATH)) {
	try {
		const assetsIndex = JSON.parse(readFileSync(ASSETS_INDEX_PATH, "utf8"));
		if (assetsIndex.collections) {
			for (const col of assetsIndex.collections) {
				const srcCol = catalogue.collections.find((c: any) => c.slug === col.slug);
				if (srcCol) {
					col.ouvrages.forEach((o: any) => {
						const srcOuv = srcCol.ouvrages.find((x: any) => x.did === o.did);
						if (srcOuv) {
							if (srcOuv.couverture && !o.couverture) o.couverture = srcOuv.couverture;
							if (srcOuv.isbn && !o.isbn) o.isbn = srcOuv.isbn;
							if (srcOuv.parution && !o.premiere_edition) o.premiere_edition = srcOuv.parution;
						}
					});
				}
			}
			assetsIndex.totaux = catalogue.totaux;
			writeFileSync(ASSETS_INDEX_PATH, JSON.stringify(assetsIndex, null, "\t") + "\n", "utf8");
			console.log(`✓ Mis à jour : ${ASSETS_INDEX_PATH}`);
		}
	} catch (e: any) {
		console.warn(`  Avertissement index.json : ${e.message}`);
	}
}

// 2. Mise à jour de PostgreSQL
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
console.log("Connexion à PostgreSQL...");
const sql = postgres(databaseUrl);

try {
	// Mise à jour de bot.db_databooks
	console.log("Mise à jour de bot.db_databooks avec ISBNs...");
	const databooksIsbns: [number, string][] = [
		[1, "4-08-782751-8"], // Daizenshuu 1
		[2, "4-08-782752-6"], // Daizenshuu 2
		[10, "4-08-782753-4"], // Daizenshuu 3
		[3, "4-08-782754-2"], // Daizenshuu 4
		[11, "4-08-782755-0"], // Daizenshuu 5
		[12, "4-08-782756-9"], // Daizenshuu 6
		[4, "4-08-782757-7"], // Daizenshuu 7
		[13, "4-08-102016-7"], // Carddass 1
		[14, "4-08-102017-5"], // Carddass 2
		[15, "4-08-102019-1"], // Supplemental Daizenshuu
		[16, "978-4-08-782496-4"], // Chozenshuu 1
		[17, "978-4-08-782497-1"], // Chozenshuu 2
		[18, "978-4-08-782498-8"], // Chozenshuu 3
		[19, "978-4-08-782499-5"], // Chozenshuu 4
		[5, "4-08-873478-5"], // Landmark
		[22, "4-08-873702-4"], // Forever
		[6, "978-4-08-874804-7"], // Super Exciting Guide Character
		[9, "978-4-08-874803-0"], // Super Exciting Guide Story
		[27, "978-4-08-792505-0"], // 30th Anniversary Super History Book
		[28, "978-4-08-782520-6"], // Chou Gashuu
		[29, "978-4-08-782156-7"], // Golden Warrior
		[31, "978-4-08-102162-8"], // Battle of Gods Movie Guide
		[30, "978-4-08-102201-4"], // Super Start Guide
		[23, "978-4-08-873546-7"], // Son Goku Densetsu
		[24, "978-4-08-873705-8"], // Tenka'ichi Densetsu
		[465, "978-4-08-111165-7"], // Sōshūhen 1
	];

	for (const [id, isbn] of databooksIsbns) {
		await sql`UPDATE bot.db_databooks SET isbn = ${isbn} WHERE id = ${id}`;
	}
	console.log(`✓ ${databooksIsbns.length} ouvrages dans bot.db_databooks enrichis en base PG.`);

	// Mise à jour de bot.dragonballcn_volumes dans PostgreSQL
	console.log("Mise à jour de bot.dragonballcn_volumes dans PG...");
	let nbVolPg = 0;
	for (const col of catalogue.collections) {
		for (const o of col.ouvrages) {
			const res = await sql`
				UPDATE bot.dragonballcn_volumes
				SET cover_url = COALESCE(${o.couverture}, cover_url),
				    isbn = COALESCE(${o.isbn ?? null}, isbn),
				    date = COALESCE(${o.parution ?? o.date_affichee ?? null}, date),
				    updated_at = ${Math.floor(Date.now() / 1000)}
				WHERE did = ${o.did}
			`;
			if (res.count > 0) nbVolPg++;
		}
	}
	console.log(`✓ ${nbVolPg} volumes mis à jour dans bot.dragonballcn_volumes (PG).`);
} finally {
	await sql.end();
}

// 3. Mise à jour de SQLite (bot.db)
console.log("\nMise à jour de SQLite (apps/shenron/bot/data/bot.db)...");
const sqlite = new Database(SQLITE_PATH);
try {
	const stmt = sqlite.prepare(`
		UPDATE dragonballcn_volumes
		SET cover_url = COALESCE(?, cover_url),
		    isbn = COALESCE(?, isbn),
		    date = COALESCE(?, date)
		WHERE did = ?
	`);

	let nbVolSqlite = 0;
	const trans = sqlite.transaction(() => {
		for (const col of catalogue.collections) {
			for (const o of col.ouvrages) {
				const info = stmt.run(
					o.couverture || null,
					o.isbn || null,
					o.parution || o.date_affichee || null,
					o.did
				);
				if (info.changes > 0) nbVolSqlite++;
			}
		}
	});
	trans();
	console.log(`✓ ${nbVolSqlite} volumes mis à jour dans SQLite bot.db.`);
} finally {
	sqlite.close();
}

// Bilan
console.log("\n================ BILAN FINAL ================");
console.log(`Total des ouvrages : ${nbOuvragesTotal}`);
console.log(`Couvertures : ${nbCouverturesAvant} -> ${nbCouverturesApres} (+${nbCouverturesApres - nbCouverturesAvant})`);
console.log(`ISBNs       : ${nbIsbnAvant} -> ${nbIsbnApres} (+${nbIsbnApres - nbIsbnAvant})`);
console.log("=============================================");
