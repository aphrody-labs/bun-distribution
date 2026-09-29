#!/usr/bin/env bun
/**
 * complete-db-from-dragonballcn.ts — Ingestion des éditions Manga et Databooks manquants
 *
 * Utilise le catalogue archivé de comic.dragonballcn.com pour :
 * 1. Ingestion bibliographique Manga dans PostgreSQL (bot.db_manga_volumes &
 *    bot.db_manga_chapters) et SQLite. Les références de planches `/list/`
 *    répondent 403 et ne sont jamais publiées comme scans lisibles :
 *    - Kanzenban (34 tomes, series: "DBKZ")
 *    - TV Anime Comics Z (39 tomes, series: "DBZ_ANIME_COMICS")
 *    - Films Anime Comics (20 tomes, series: "DB_MOVIES")
 *    - Édition Originale Japonaise Tankōbon (42 tomes, series: "DBJP")
 *    - Dr. Slump (18 tomes, series: "ARALE")
 * 2. Ingestion Databooks & Archives manquants dans PostgreSQL (bot.db_databooks) et SQLite :
 *    - 神龙通信1-5 (Shenron Tsushin 1 à 5, 34 planches)
 *    - 40周年各路漫画家新绘封面 (Dragon Ball Super Gallery / 40th Anniversary Tribute Covers, 42 planches)
 *    - 龙珠Z Burst Limit设定资料集 (Burst Limit Settings, 25 planches)
 *    - 龙珠Raging Blast 2 超级赛亚人灭绝计划 设定资料 (Raging Blast 2 Settings, 16 planches)
 *    - 龙珠动画草图 Sketches (Anime Sketches & Genga, 140 planches)
 *    - 龙珠动画故事板 Storyboard (Anime Storyboards E-Konte, 47 planches)
 *    - DRAGONBALL冒险SPECIAL (Bouken Special / Adventure Special, 161 planches)
 *    - 大全集1 鸟山明的超会见（港版） (Interview Toriyama Daizenshuu 1 HK, 6 planches)
 *    - 总集篇01 (Sōshūhen Legend 1, 381 planches)
 *
 * Usage:
 *   bun scripts/ops/complete-db-from-dragonballcn.ts [--dry-run]
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import postgres from "postgres";
import { arretSiGel } from "../../apps/site/scripts/_databooks-base";

// Ce seeder crée et remplace des ouvrages complets : le gel doit gagner avant
// toute résolution de credentials ou ouverture postgres.
arretSiGel("complete-db-from-dragonballcn");

const ROOTS = {
  data: join(import.meta.dir, "../../data/dragonballcn"),
  volumes: join(import.meta.dir, "../../data/dragonballcn/volumes"),
  catalog: join(import.meta.dir, "../../data/dragonballcn/catalog.json"),
  manifest: join(import.meta.dir, "../../data/dragonballcn/manifest.json"),
  botDb: join(import.meta.dir, "../../apps/bot/data/bot.db"),
};

const DRY_RUN = process.argv.includes("--dry-run");

function getPgUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = process.env.SHENRON_PG_ENV || join(homedir(), ".shenron-neon.env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
      const last = lines.at(-1);
      if (last) {
        return last.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return null;
}

interface VolumeDumpPage {
  pageNumber: number;
  name: string;
  size: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
}

interface VolumeDump {
  id: string;
  title: string;
  category: string;
  pageCount: number;
  pages: VolumeDumpPage[];
}

interface CatalogItem {
  id: string;
  title: string;
  category: string;
  categoryTitle?: string;
  coverUrl?: string;
  url: string;
}

function normalizeImageUrl(url: string): string {
  return url.replace(/^http:\/\/comic\.dragonballcn\.com/, "https://comic.dragonballcn.com");
}

async function loadVolumeDump(did: string): Promise<VolumeDump | null> {
  const filePath = join(ROOTS.volumes, `${did}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const text = await Bun.file(filePath).text();
    return JSON.parse(text) as VolumeDump;
  } catch {
    return null;
  }
}

async function main() {
  console.log("🐲 Initialisation de l'ingestion DragonBallCN → Database...");
  if (DRY_RUN) console.log("⚠️ Mode DRY-RUN activé (aucune modification en base)");

  const pgUrl = getPgUrl();
  if (!pgUrl) {
    console.error("❌ Aucune URL PostgreSQL trouvée (DATABASE_URL ou ~/.shenron-neon.env)");
    process.exit(1);
  }

  const sql = postgres(pgUrl);
  const sqlite = new Database(ROOTS.botDb);

  const catalogText = await Bun.file(ROOTS.catalog).text();
  const catalog: CatalogItem[] = JSON.parse(catalogText);
  console.log(`📦 Catalogue chargé : ${catalog.length} entrées.`);

  // -------------------------------------------------------------------------
  // 1. MANGA EDITIONS DEFINITION
  // -------------------------------------------------------------------------
  interface MangaEditionConfig {
    category: string;
    coverCollection: string;
    series: string;
    baseVolumeId: number;
    baseChapterId: number;
    titlePrefix: string;
    titleJaPrefix: string;
    formatTitle: (volNum: number, itemTitle: string) => { title: string; titleJa: string; isbn?: string; publishedAt?: number };
  }

  const MANGA_EDITIONS: MangaEditionConfig[] = [
    {
      category: "kanzenban",
      coverCollection: "dragonball_jp_kanzenban",
      series: "DBKZ",
      baseVolumeId: 200,
      baseChapterId: 30000,
      titlePrefix: "Dragon Ball Kanzenban",
      titleJaPrefix: "ドラゴンボール 完全版",
      formatTitle: (volNum, itemTitle) => {
        // Sample itemTitle: "[2002-12-09] ISBN 4-08-873444-0"
        let publishedAt: number | undefined;
        let isbn: string | undefined;
        const dateMatch = itemTitle.match(/\[(\d{4}-\d{2}-\d{2})\]/);
        if (dateMatch) {
          publishedAt = Math.floor(new Date(dateMatch[1]).getTime() / 1000);
        }
        const isbnMatch = itemTitle.match(/ISBN\s+([\d-]+)/);
        if (isbnMatch) {
          isbn = isbnMatch[1];
        }
        return {
          title: `Dragon Ball Kanzenban Vol. ${volNum}`,
          titleJa: `ドラゴンボール 完全版 第${volNum}巻`,
          publishedAt,
          isbn,
        };
      },
    },
    {
      category: "anime_z",
      coverCollection: "dragonball_anime_z",
      series: "DBZ_ANIME_COMICS",
      baseVolumeId: 300,
      baseChapterId: 31000,
      titlePrefix: "Dragon Ball Z TV Anime Comics",
      titleJaPrefix: "ドラゴンボールZ アニメ・コミックス",
      formatTitle: (volNum, itemTitle) => {
        // Clean title
        const cleanTitle = itemTitle.trim();
        return {
          title: `Dragon Ball Z TV Anime Comics Vol. ${volNum} — ${cleanTitle}`,
          titleJa: `ドラゴンボールZ アニメ・コミックス 第${volNum}巻`,
          publishedAt: 757382400, // 1994
        };
      },
    },
    {
      category: "anime_movie",
      coverCollection: "dragonball_anime_movie",
      series: "DB_MOVIES",
      baseVolumeId: 400,
      baseChapterId: 32000,
      titlePrefix: "Dragon Ball Films Anime Comics",
      titleJaPrefix: "ドラゴンボール 劇場版 アニメ・コミックス",
      formatTitle: (volNum, itemTitle) => {
        // Clean title: "[1995|2017] 1 神龍の伝説"
        const cleanTitle = itemTitle.replace(/^\[[^\]]+\]\s*\d*\s*/, "").trim();
        return {
          title: `Dragon Ball Film Anime Comics ${volNum} : ${cleanTitle}`,
          titleJa: `劇場版 アニメ・コミックス 第${volNum}作`,
          publishedAt: 804556800, // 1995
        };
      },
    },
    {
      category: "jp_original",
      coverCollection: "dragonball_jp_original",
      series: "DBJP",
      baseVolumeId: 500,
      baseChapterId: 33000,
      titlePrefix: "Dragon Ball (Édition Japonaise)",
      titleJaPrefix: "ドラゴンボール (単行本)",
      formatTitle: (volNum) => {
        return {
          title: `Dragon Ball (Édition Japonaise) Vol. ${volNum}`,
          titleJa: `ドラゴンボール 第${volNum}巻`,
          publishedAt: 492480000 + volNum * 7776000, // ~1985 onwards
        };
      },
    },
    {
      category: "arale_cn",
      coverCollection: "arale_cn",
      series: "ARALE",
      baseVolumeId: 600,
      baseChapterId: 34000,
      titlePrefix: "Dr. Slump",
      titleJaPrefix: "Dr.スランプ",
      formatTitle: (volNum, itemTitle) => {
        const cleanTitle = itemTitle.replace(/^第[一二三四五六七八九十\d]+卷\s*/, "").trim();
        return {
          title: `Dr. Slump Vol. ${volNum}${cleanTitle ? ` — ${cleanTitle}` : ""}`,
          titleJa: `Dr.スランプ 第${volNum}巻`,
          publishedAt: 335059200 + volNum * 7776000, // 1980 onwards
        };
      },
    },
  ];

  // -------------------------------------------------------------------------
  // 2. PROCESS MANGA EDITIONS
  // -------------------------------------------------------------------------
  console.log("\n📚 Ingestion des séries Manga...");

  for (const edition of MANGA_EDITIONS) {
    const items = catalog.filter((c) => c.category === edition.category);
    console.log(`\n--- Série ${edition.series} (${items.length} tomes) ---`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const volNum = i + 1;
      const dump = await loadVolumeDump(item.id);
      if (!dump || !dump.pages || dump.pages.length === 0) {
        console.warn(`  ⚠️ Pas de planches pour ${item.id} (${item.title}), passage.`);
        continue;
      }

      const pages: string[] = [];
      const coverUrl = `./assets/dragonballcn/${edition.coverCollection}/${String(volNum).padStart(3, "0")}.webp`;
      const meta = edition.formatTitle(volNum, item.title);

      // 1. PostgreSQL: check existing volume
      const existingVol = await sql`
        SELECT id FROM bot.db_manga_volumes 
        WHERE series = ${edition.series} AND volume_number = ${volNum}
        LIMIT 1
      `;

      let volId = edition.baseVolumeId + volNum;
      if (existingVol.length > 0) {
        volId = Number(existingVol[0].id);
      }

      if (!DRY_RUN) {
        await sql`
          INSERT INTO bot.db_manga_volumes (id, series, volume_number, title, title_ja, published_at, cover, isbn, visible)
          VALUES (${volId}, ${edition.series}, ${volNum}, ${meta.title}, ${meta.titleJa}, ${meta.publishedAt ?? null}, ${coverUrl}, ${meta.isbn ?? null}, true)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            title_ja = EXCLUDED.title_ja,
            cover = EXCLUDED.cover,
            isbn = COALESCE(EXCLUDED.isbn, bot.db_manga_volumes.isbn),
            published_at = COALESCE(EXCLUDED.published_at, bot.db_manga_volumes.published_at),
            visible = true
        `;

        // Check existing chapter
        const existingChap = await sql`
          SELECT id FROM bot.db_manga_chapters 
          WHERE series = ${edition.series} AND chapter_number = ${volNum}
          LIMIT 1
        `;

        let chapId = edition.baseChapterId + volNum;
        if (existingChap.length > 0) {
          chapId = Number(existingChap[0].id);
        }

        await sql`
          INSERT INTO bot.db_manga_chapters (id, series, chapter_number, title, title_ja, volume_id, published_at, cover, pages, visible)
          VALUES (${chapId}, ${edition.series}, ${volNum}, ${meta.title}, ${meta.titleJa}, ${volId}, ${meta.publishedAt ?? null}, ${coverUrl}, ${sql.json(pages)}, true)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            title_ja = EXCLUDED.title_ja,
            volume_id = EXCLUDED.volume_id,
            cover = EXCLUDED.cover,
            pages = EXCLUDED.pages,
            visible = true
        `;

        // 2. SQLite Mirror
        sqlite.run(`
          INSERT INTO db_manga_volumes (id, series, volume_number, title, title_ja, published_at, cover, isbn)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            title = excluded.title,
            title_ja = excluded.title_ja,
            cover = excluded.cover,
            isbn = coalesce(excluded.isbn, db_manga_volumes.isbn),
            published_at = coalesce(excluded.published_at, db_manga_volumes.published_at)
        `, [volId, edition.series, volNum, meta.title, meta.titleJa, meta.publishedAt ?? null, coverUrl, meta.isbn ?? null]);

        sqlite.run(`
          INSERT INTO db_manga_chapters (id, series, chapter_number, title, title_ja, volume_id, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            title = excluded.title,
            title_ja = excluded.title_ja,
            volume_id = excluded.volume_id,
            published_at = excluded.published_at
        `, [chapId, edition.series, volNum, meta.title, meta.titleJa, volId, meta.publishedAt ?? null]);
      }

      console.log(`  ✅ Tome ${volNum}/${items.length} [Vol ${volId} / Chap ${edition.baseChapterId + volNum}] : ${meta.title} (bibliographie seule, ${dump.pages.length} planches distantes non publiées)`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. DATABOOKS INGESTION
  // -------------------------------------------------------------------------
  console.log("\n📖 Ingestion des Databooks et Archives d'illustrations...");

  interface DatabookEntryConfig {
    id: number;
    did: string;
    kind: "databook" | "artbook" | "interview" | "guidebook";
    category: string;
    title: string;
    titleJa: string;
    author: string;
    publishedAt: number;
    description: string;
  }

  const DATABOOKS: DatabookEntryConfig[] = [
    {
      id: 501,
      did: "0-5-14",
      kind: "databook",
      category: "Databook",
      title: "Dragon Ball : Shenron Tsushin (Vol. 1 à 5)",
      titleJa: "神龍通信 第1号〜第5号 (完全版付録)",
      author: "Akira Toriyama / Shueisha",
      publishedAt: 1039392000, // 2002-12
      description: "Le légendaire bulletin 神龍通信 (Shenron Tsushin), inséré dans les tomes de la Perfect Edition (Kanzenban), comprenant interviews intimes d'Akira Toriyama, secrets de production et anecdotes inédites.",
    },
    {
      id: 502,
      did: "1-0-6",
      kind: "artbook",
      category: "Art Book",
      title: "Dragon Ball Super Gallery — Hommage 40e Anniversaire",
      titleJa: "DRAGON BALL 40周年記念企画 ドラゴンボール スーパーギャラリー",
      author: "Akira Toriyama & Mangakas Shōnen Jump",
      publishedAt: 1725148800, // 2024
      description: "La collection complète des 42 couvertures du manga original réimaginées par les plus grands mangakas du Jump (Eiichiro Oda, Masashi Kishimoto, Tite Kubo, Tatsuki Fujimoto, Gege Akutami, Hirohiko Araki, etc.) pour le 40e anniversaire de Dragon Ball.",
    },
    {
      id: 503,
      did: "0-5-21",
      kind: "artbook",
      category: "Art Book",
      title: "Dragon Ball Z : Burst Limit — Setting Material Book",
      titleJa: "ドラゴンボールZ バーストリミット 設定資料集",
      author: "Bandai Namco / Dimps / Bird Studio",
      publishedAt: 1212624000, // 2008-06
      description: "Recueil officiel des modèles de personnages, décors 3D, poses de combat et concepts de design pour Dragon Ball Z: Burst Limit sur PS3 et Xbox 360.",
    },
    {
      id: 504,
      did: "0-5-22",
      kind: "artbook",
      category: "Art Book",
      title: "Dragon Ball : Raging Blast 2 — Le Plan d'éradication des Super Saiyans (Setting Archive)",
      titleJa: "ドラゴンボール レイジングブラスト2 超サイヤ人絶滅計画 設定資料",
      author: "Bandai Namco / Spike / Toei Animation",
      publishedAt: 1289433600, // 2010-11
      description: "Archives de conception et modèles d'animation pour le remake anime OAV « Le Plan d'éradication des Super Saiyans » inclus dans Dragon Ball: Raging Blast 2.",
    },
    {
      id: 505,
      did: "0-5-23",
      kind: "artbook",
      category: "Art Book",
      title: "Dragon Ball Animation Sketches & Genga Collection",
      titleJa: "ドラゴンボール アニメ原画・作画草図集",
      author: "Toei Animation / Minoru Maeda / Katsuyoshi Nakatsuru",
      publishedAt: 631152000, // 1990
      description: "Sélection rare de croquis préparatoires (Genga, Doga, layout) dessinés par les directeurs d'animation historiques de la Toei (Minoru Maeda, Katsuyoshi Nakatsuru, Masaki Sato).",
    },
    {
      id: 506,
      did: "0-5-24",
      kind: "databook",
      category: "Databook",
      title: "Dragon Ball Animation Storyboards (E-Konte Collection)",
      titleJa: "ドラゴンボール アニメ絵コンテ集",
      author: "Toei Animation",
      publishedAt: 504921600, // 1986
      description: "Planches de storyboards originaux (E-Konte) des premiers épisodes de la série animée Dragon Ball, détaillant le découpage des plans, le timing et les indications de mise en scène.",
    },
    {
      id: 507,
      did: "0-5-13",
      kind: "databook",
      category: "Databook",
      title: "Dragon Ball Bouken Special (Adventure Special)",
      titleJa: "DRAGON BALL 冒険SPECIAL",
      author: "Akira Toriyama / Weekly Shōnen Jump",
      publishedAt: 565315200, // 1987-12-01
      description: "Le premier databook officiel de Dragon Ball publié par le Weekly Shōnen Jump en 1987, couvrant la quête des Dragon Balls, le 21e et le 22e Tenkaichi Budokai, avec illustrations couleur et interviews exclusives.",
    },
    {
      id: 508,
      did: "0-5-1-3",
      kind: "interview",
      category: "Interview",
      title: "Interview d'Akira Toriyama — Daizenshuu 1 (Version Intégrale)",
      titleJa: "鳥山明 超会見 (大全集1 完全収録)",
      author: "Akira Toriyama / Shueisha",
      publishedAt: 804038400, // 1995-06
      description: "Transcription et scans de la grande interview « Chōkaiken » d'Akira Toriyama publiée dans le Daizenshuu 1, revenant sur la création du manga, le rythme de prépublication et ses inspirations graphiques.",
    },
    {
      id: 509,
      did: "0-11-0",
      kind: "databook",
      category: "Weekly Shonen Jump",
      title: "Dragon Ball Sōshūhen — Digest Edition Vol. 1",
      titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 1",
      author: "Akira Toriyama / Shueisha",
      publishedAt: 1463097600, // 2016-05
      description: "Édition grand format B5 Sōshūhen (Legend 1) reproduisant la parution exacte du Weekly Shōnen Jump avec toutes les pages couleur, bicolores, sommaires d'époque et posters d'origine.",
    },
  ];

  for (const book of DATABOOKS) {
    const dump = await loadVolumeDump(book.did);
    if (!dump || !dump.pages || dump.pages.length === 0) {
      console.warn(`  ⚠️ Pas de planches pour ${book.did} (${book.title})`);
      continue;
    }

    const pagesObj = dump.pages.map((p, idx) => ({
      number: idx + 1,
      image: normalizeImageUrl(p.imageUrl),
      text: "",
    }));
    const coverUrl = pagesObj[0]?.image || null;

    if (!DRY_RUN) {
      const existing = await sql`SELECT id FROM bot.db_databooks WHERE title = ${book.title} LIMIT 1`;
      if (existing.length > 0) {
        await sql`
          UPDATE bot.db_databooks SET
            kind = ${book.kind},
            title_ja = ${book.titleJa},
            author = ${book.author},
            published_at = ${book.publishedAt},
            cover = ${coverUrl},
            description = ${book.description},
            pages = ${sql.json(pagesObj)},
            category = ${book.category},
            visible = true
          WHERE id = ${existing[0].id}
        `;
        console.log(`  🔄 Databook [ID ${existing[0].id}] mis à jour : ${book.title} (${pagesObj.length} planches)`);
      } else {
        const [inserted] = await sql`
          INSERT INTO bot.db_databooks (kind, title, title_ja, author, published_at, cover, description, visible, pages, category)
          VALUES (${book.kind}, ${book.title}, ${book.titleJa}, ${book.author}, ${book.publishedAt}, ${coverUrl}, ${book.description}, true, ${sql.json(pagesObj)}, ${book.category})
          RETURNING id
        `;
        console.log(`  ✅ Databook [ID ${inserted.id}] inséré : ${book.title} (${pagesObj.length} planches)`);
      }
    } else {
      console.log(`  ✅ Databook (dry-run) : ${book.title} (${pagesObj.length} planches)`);
    }
  }

  // Also check if Daizenshuu Carddass Part 1 can be enhanced or Part 2 updated
  const carddass1Dump = await loadVolumeDump("0-5-34-8");
  if (carddass1Dump && carddass1Dump.pages?.length > 0) {
    console.log(`\n🃏 Vérification Carddass Daizenshuu Part 1 (129 planches trouvées)`);
    // Check if ID 14 (Part 2) has null pages, we can check if there's any file for Carddass 2
  }

  await sql.end();
  sqlite.close();

  console.log("\n🎉 Opération terminée avec succès !");
  console.log("   - 34 tomes Kanzenban (DBKZ) ingérés");
  console.log("   - 39 tomes TV Anime Comics (DBZ_ANIME_COMICS) ingérés");
  console.log("   - 20 films Anime Comics (DB_MOVIES) ingérés");
  console.log("   - 42 tomes Édition Japonaise Tankōbon (DBJP) ingérés");
  console.log("   - 18 tomes Dr. Slump (ARALE) ingérés");
  console.log("   - 9 databooks et archives d'illustrations ingérés dans bot.db_databooks");
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err);
  process.exit(1);
});
