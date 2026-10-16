/**
 * Crawl zukan.inazuma.jp chara_param pages, extract image hashes + stats, match to DB.
 * Run with: bun src/scripts/map-zukan-images.ts
 *
 * Pipeline:
 *   1. Fetch chara_param pages (EN + JA) — includes name, image, pos, elem, 7 stats Lv50
 *   2. Parse HTML with cheerio
 *   3. Multi-phase strict matching to inagle_characters (pos+elem+stats)
 *   4. Update zukan_hash column in DB
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  assignBest,
  createMatchContext,
  descriptionSimilarity,
  ERAS,
  matchGroupsStrict,
  matchScore,
  normElem,
  normPos,
  zukanGameToSeries,
} from "../../src/zukan/matcher.ts";
import * as cheerio from "cheerio";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — no types for kuroshiro
import Kuroshiro from "kuroshiro";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — no types for kuroshiro-analyzer-kuromoji
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import { iecodeDataPath } from "../../src/core/roots.ts";
import { getInagleDatabaseURL } from "@rosegriffon/db/pg";

const DATA_ROOT = iecodeDataPath("zukan");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 300;

// ============================================================================
// Types
// ============================================================================

/** 9 game keys matching the zukan appeared-works columns */
const GAME_KEYS = ["ie1", "ie2", "ie3", "go1", "go2", "go3", "ars", "ori", "vic"] as const;
type GameKey = (typeof GAME_KEYS)[number];

const GAME_KEY_TO_SERIES: Record<GameKey, string> = {
  ie1: "Inazuma Eleven",
  ie2: "Inazuma Eleven 2",
  ie3: "Inazuma Eleven 3",
  go1: "Inazuma Eleven GO",
  go2: "Chrono Stone",
  go3: "Galaxy",
  ars: "Ares",
  ori: "Orion",
  vic: "Victory Road",
};

interface ZukanEntry {
  name: string;
  nickname?: string;
  zukanHash?: string;
  position?: string;
  element?: string;
  stats?: {
    kick: number;
    control: number;
    technique: number;
    pressure: number;
    physical: number;
    agility: number;
    intelligence: number;
  };
  game?: string;
  gender?: string;
  description?: string;
}

/** Game appearance data from chara_list pages */
interface ListEntry {
  zukanHash: string;
  name: string;
  gameAppearances: GameKey[];
}

interface DbChar {
  id: string;
  name_ja: string;
  name_en: string;
  name_fr: string;
  position: string;
  element: string;
  gender: string | null;
  rarity_label: string;
  series: string | null;
  zukan_hash: string | null;
  stat_frappe: number | null;
  stat_controle: number | null;
  stat_technique: number | null;
  stat_pression: number | null;
  stat_physique: number | null;
  stat_agilite: number | null;
  stat_intelligence: number | null;
  description_en: string | null;
}

// ============================================================================
// Fetch & Parse
// ============================================================================

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchParamPage(pageNum: number, locale: string): Promise<string> {
  const cacheDir = path.join(DATA_ROOT, `chara_param_cache_${locale || "ja"}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `page-${pageNum}.html`);
  const cacheFile = Bun.file(cachePath);
  if ((await cacheFile.exists()) && cacheFile.size > 1000) {
    return cacheFile.text();
  }

  const prefix = locale ? `${locale}/` : "";
  const url = `https://zukan.inazuma.jp/${prefix}chara_param/?page=${pageNum}&per_page=200`;
  console.log(`  Fetching ${locale || "JA"} param page ${pageNum}...`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for page ${pageNum}`);
  const html = await res.text();
  await Bun.write(cachePath, html);
  return html;
}

function parseParamPage(html: string): ZukanEntry[] {
  const $ = cheerio.load(html);
  const entries: ZukanEntry[] = [];

  $("ul.charaListBox > li").each((_, li) => {
    const $li = $(li);

    // Name — use img alt (clean, no furigana) or strip rt from ruby
    const imgAlt = $li.find("img[src*='cloudfront']").attr("alt")?.trim();
    const nameSpan = $li.find(".nameBox .name").first();
    // Remove rt elements to get clean kanji name
    const nameClone = nameSpan.clone();
    nameClone.find("rt").remove();
    const nameRuby = imgAlt || nameClone.text().replace(/\s+/g, " ").trim();
    if (!nameRuby) return;

    // Nickname
    const nickname = $li.find(".lBox .name .nickname ruby").text().trim() || undefined;

    // Image hash from CloudFront
    let zukanHash: string | undefined;
    const imgSrc =
      $li.find("img[src*='cloudfront.net/1/']").attr("src") ||
      $li.find("source[srcset*='cloudfront.net/1/']").attr("srcset");
    if (imgSrc) {
      const match = imgSrc.match(/cloudfront\.net\/1\/([^."]+)/);
      if (match) zukanHash = match[1];
    }

    // Position & Element from ul.param
    const paramDls = $li.find("ul.param > li > dl");
    let position: string | undefined;
    let element: string | undefined;
    const statsObj: Record<string, number> = {};

    paramDls.each((_, dl) => {
      const dt = $(dl).find("dt").first().text().trim();
      const dd = $(dl).find("dd").first();

      if (dt === "Position" || dt === "ポジション") {
        position = dd.find("p").text().trim() || dd.text().trim();
      } else if (dt === "Element" || dt === "属性") {
        element = dd.find("p").text().trim() || dd.text().trim();
      } else {
        // Stats: the value is in a table td
        const val = parseInt(dd.find("td").last().text().trim(), 10);
        if (!Number.isNaN(val)) {
          const statMap: Record<string, string> = {
            Kick: "kick",
            Control: "control",
            Technique: "technique",
            Pressure: "pressure",
            Physical: "physical",
            Agility: "agility",
            Intelligence: "intelligence",
            キック: "kick",
            コントロール: "control",
            テクニック: "technique",
            プレッシャー: "pressure",
            フィジカル: "physical",
            スピード: "agility",
            スタミナ: "intelligence",
          };
          const key = statMap[dt];
          if (key) statsObj[key] = val;
        }
      }
    });

    // Gender from ul.basic
    let gender: string | undefined;
    $li.find("ul.basic > li > dl").each((_, dl) => {
      const dt = $(dl).find("dt").text().trim();
      if (dt === "Gender" || dt === "性別") {
        gender = $(dl).find("dd").text().trim();
      }
    });

    // Game
    const game = $li.find("dl.appearedWorks dd").text().trim() || undefined;

    // Description (source de vérité zukan)
    const description = $li.find(".description").first().text().trim() || undefined;

    const stats = Object.keys(statsObj).length >= 5 ? (statsObj as ZukanEntry["stats"]) : undefined;

    entries.push({
      name: nameRuby,
      nickname,
      zukanHash,
      position,
      element,
      stats,
      game,
      gender,
      description,
    });
  });

  return entries;
}

async function crawlParamPages(locale: string): Promise<ZukanEntry[]> {
  const label = locale || "JA";
  console.log(`\nCrawling chara_param (${label})...`);

  const allEntries: ZukanEntry[] = [];
  const maxPages = 30;

  for (let i = 1; i <= maxPages; i++) {
    if (i > 1) await sleep(DELAY_MS);
    try {
      const html = await fetchParamPage(i, locale);
      const entries = parseParamPage(html);
      if (entries.length === 0) {
        console.log(`  Page ${i}: empty — stopping.`);
        break;
      }
      allEntries.push(...entries);
      if (i === 1 || i % 5 === 0) console.log(`  ${label} page ${i}: total ${allEntries.length}`);
    } catch (err) {
      console.error(`  Page ${i}: error — ${err}`);
      break;
    }
  }

  console.log(`${label} total: ${allEntries.length} characters`);
  return allEntries;
}

// ============================================================================
// Main
// ============================================================================

// ============================================================================
// Parse chara_list pages for game appearances
// ============================================================================

function parseListPageAppearances(html: string): ListEntry[] {
  const $ = cheerio.load(html);
  const entries: ListEntry[] = [];
  const HASH_RE = /cloudfront\.net\/1\/([^."]+)/;

  $("tbody").each((_, tbody) => {
    const $tbody = $(tbody);
    const checkbox = $tbody.find("input.my-team-checkbox");
    if (!checkbox.length) return;

    const zukanHash = checkbox.attr("data-chara-id") || null;
    const name = checkbox.attr("data-chara-name")?.trim() || "";

    // Fallback hash from image
    const imgSrc = $tbody.find("img[src*='cloudfront.net/1/']").attr("src") || "";
    const hashFromImg = imgSrc.match(HASH_RE)?.[1] || null;
    const finalHash = zukanHash || hashFromImg;
    if (!finalHash) return;

    const gameAppearances: GameKey[] = [];
    const colspanCell = $tbody.find("td[colspan='9']");

    if (colspanCell.length > 0) {
      const gameLabel = colspanCell.text().trim();
      const key = (Object.entries(GAME_KEY_TO_SERIES) as [GameKey, string][]).find(([, v]) => {
        if (v === "Inazuma Eleven" && gameLabel === "Inazuma Eleven") return true;
        if (v === "Inazuma Eleven 2" && gameLabel.startsWith("Inazuma Eleven 2")) return true;
        if (v === "Inazuma Eleven 3" && gameLabel.startsWith("Inazuma Eleven 3")) return true;
        if (v === "Inazuma Eleven GO" && gameLabel.startsWith("Inazuma Eleven GO: Light")) return true;
        if (v === "Chrono Stone" && gameLabel.includes("Chrono Stone")) return true;
        if (v === "Galaxy" && gameLabel.includes("Galaxy")) return true;
        if (v === "Ares" && gameLabel.includes("Ares")) return true;
        if (v === "Orion" && gameLabel.includes("Orion")) return true;
        if (v === "Victory Road" && gameLabel.includes("Victory Road")) return true;
        return false;
      })?.[0];
      if (key) gameAppearances.push(key);
    } else {
      $tbody.find("td.appearedWorks").each((i, cell) => {
        if ($(cell).text().trim() === "○" && i < GAME_KEYS.length) {
          gameAppearances.push(GAME_KEYS[i]);
        }
      });
    }

    entries.push({ zukanHash: finalHash, name, gameAppearances });
  });

  return entries;
}

/**
 * Load game appearances from chara_list cache.
 * Returns TWO maps:
 * - byHash: zukanHash → GameKey[] (single entry's appearances)
 * - byName: normalized name → GameKey[] (aggregated across ALL zukan entries for that name)
 */
async function loadListAppearances(): Promise<{
  byHash: Map<string, GameKey[]>;
  byName: Map<string, GameKey[]>;
}> {
  const cacheDir = path.join(DATA_ROOT, "chara_list_cache_en");
  const byHash = new Map<string, GameKey[]>();
  const byName = new Map<string, GameKey[]>();

  if (!(await Bun.file(cacheDir).exists())) {
    console.log("  No chara_list cache found — skipping game appearances.");
    return { byHash, byName };
  }

  const files = fs
    .readdirSync(cacheDir)
    .filter((f: string) => f.endsWith(".html"))
    .sort();
  console.log(`\nParsing ${files.length} chara_list pages for game appearances...`);

  for (const file of files) {
    const html = fs.readFileSync(path.join(cacheDir, file), "utf-8");
    const entries = parseListPageAppearances(html);
    for (const e of entries) {
      if (e.gameAppearances.length > 0) {
        byHash.set(e.zukanHash, e.gameAppearances);
        // Aggregate by name — same character across games
        const nameKey = e.name.trim().toLowerCase();
        const existing = byName.get(nameKey) || [];
        for (const g of e.gameAppearances) {
          if (!existing.includes(g)) existing.push(g);
        }
        byName.set(nameKey, existing);
      }
    }
  }

  // Sort each byName array in GAME_KEYS order
  for (const [_key, games] of byName) {
    games.sort((a, b) => GAME_KEYS.indexOf(a) - GAME_KEYS.indexOf(b));
  }

  console.log(`Game appearances: ${byHash.size} hash entries, ${byName.size} unique names.`);
  return { byHash, byName };
}

async function main() {
  // Use cached data if available, otherwise crawl
  const enCachePath = path.join(DATA_ROOT, "param_en.json");
  const jaCachePath = path.join(DATA_ROOT, "param_ja.json");
  const useCache =
    process.argv.includes("--cache") &&
    (await Bun.file(enCachePath).exists()) &&
    (await Bun.file(jaCachePath).exists());

  let enEntries: ZukanEntry[];
  let jaEntries: ZukanEntry[];

  if (useCache) {
    console.log("Using cached zukan data...");
    enEntries = JSON.parse(await Bun.file(enCachePath).text());
    jaEntries = JSON.parse(await Bun.file(jaCachePath).text());
  } else {
    // Crawl EN + JA param pages
    enEntries = await crawlParamPages("en");
    jaEntries = await crawlParamPages("");

    // Save consolidated data
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    await Bun.write(enCachePath, JSON.stringify(enEntries, null, 2));
    await Bun.write(jaCachePath, JSON.stringify(jaEntries, null, 2));
  }

  const withHash = enEntries.filter(e => e.zukanHash).length;
  const jaWithHash = jaEntries.filter(e => e.zukanHash).length;
  console.log(`\nEN entries with hash: ${withHash}/${enEntries.length}`);
  console.log(`JA entries with hash: ${jaWithHash}/${jaEntries.length}`);

  // Connexion DB via Bun.SQL (natif, pas de dépendance pg)
  const sql = new Bun.SQL(getInagleDatabaseURL(), { prepare: false });
  console.log("\nConnected to DB.");

  const dbChars = await sql<DbChar[]>`
    SELECT id, name_ja, name_en, name_fr, position, element, gender, rarity_label, series, zukan_hash,
           stat_frappe, stat_controle, stat_technique, stat_pression,
           stat_physique, stat_agilite, stat_intelligence,
           description_en
    FROM inagle_characters
  `;
  console.log(`DB has ${dbChars.length} characters.`);

  const assigned = new Map<string, string>(); // id -> hash
  // Contexte de matching (set usedHashes propre à ce run) — enforce le 1:1 hash↔perso.
  const ctx = createMatchContext();
  const usedHashes = ctx.usedHashes;

  // ── Index zukan par hash (utilisé dans C/D/validation pour vérifier descriptions) ──
  const zukanByHash = new Map<string, ZukanEntry>();
  for (const e of [...jaEntries, ...enEntries]) {
    if (e.zukanHash) zukanByHash.set(e.zukanHash, e);
  }
  const dbById = new Map(dbChars.map(c => [c.id, c]));

  // ── Index zukan EN by name ──
  const enByName = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const key = e.name.trim().toLowerCase();
    if (!enByName.has(key)) enByName.set(key, []);
    enByName.get(key)!.push(e);
  }

  // ── Index zukan JA by name ──
  const jaByName = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash)) {
    const key = e.name.trim();
    if (!jaByName.has(key)) jaByName.set(key, []);
    jaByName.get(key)!.push(e);
  }

  // ── Index DB by name (EN + FR + JA) ──
  const dbByNameEn = new Map<string, DbChar[]>();
  const dbByNameFr = new Map<string, DbChar[]>();
  const dbByNameJa = new Map<string, DbChar[]>();

  for (const c of dbChars) {
    if (c.name_en) {
      const k = c.name_en.trim().toLowerCase();
      if (!dbByNameEn.has(k)) dbByNameEn.set(k, []);
      dbByNameEn.get(k)!.push(c);
    }
    if (c.name_fr) {
      const k = c.name_fr.trim().toLowerCase();
      if (!dbByNameFr.has(k)) dbByNameFr.set(k, []);
      dbByNameFr.get(k)!.push(c);
    }
    if (c.name_ja) {
      const k = c.name_ja.trim();
      if (!dbByNameJa.has(k)) dbByNameJa.set(k, []);
      dbByNameJa.get(k)!.push(c);
    }
  }

  // ═══════════════════════════════════════
  // Phase A: Exact EN name match (strict pos+elem+stats)
  // ═══════════════════════════════════════
  console.log("\n--- Phase A: Exact EN name match ---");
  for (const [name, zukanGroup] of enByName) {
    const dbGroup = dbByNameEn.get(name);
    if (dbGroup) matchGroupsStrict(ctx, zukanGroup, dbGroup, assigned);
  }
  console.log(`Phase A: ${assigned.size} matched`);

  // ═══════════════════════════════════════
  // Phase A2: Deduplicate — propagate hash within identical groups
  // Group by (name_en, position, element, series, rarity_label)
  // ═══════════════════════════════════════
  console.log("\n--- Phase A2: Group deduplication ---");
  const _beforeA2 = assigned.size;

  const identicalGroups = new Map<string, DbChar[]>();
  for (const c of dbChars) {
    const key = `${(c.name_en || "").toLowerCase()}|${c.position}|${c.element}|${c.series || ""}|${c.rarity_label}`;
    if (!identicalGroups.has(key)) identicalGroups.set(key, []);
    identicalGroups.get(key)!.push(c);
  }

  // Phase A2 DISABLED — propagating the same hash to multiple characters
  // causes wrong images on different players (e.g., Mark Evans IE1/GO/Ares
  // all get the same portrait). Each zukan_hash must be unique (1:1 mapping).
  // The remaining unmatched characters will fall back to bucket icons.
  console.log(`Phase A2: SKIPPED (1:1 hash policy)`);

  // ═══════════════════════════════════════
  // Phase B: EN zukan name -> DB FR name
  // ═══════════════════════════════════════
  console.log("\n--- Phase B: EN name -> FR name match ---");
  const beforeB = assigned.size;
  for (const [name, zukanGroup] of enByName) {
    const dbGroup = dbByNameFr.get(name);
    if (!dbGroup) continue;
    const unassigned = dbGroup.filter(c => !assigned.has(c.id));
    if (unassigned.length > 0) matchGroupsStrict(ctx, zukanGroup, unassigned, assigned);
  }
  console.log(`Phase B: +${assigned.size - beforeB} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase B1.5: Nickname match — zukan nickname ("Evans","Axel") → DB single-word name
  // ═══════════════════════════════════════
  console.log("\n--- Phase B1.5: Nickname match ---");
  const beforeB15 = assigned.size;

  // Index zukan by nickname (lowercase)
  // Only index if the nickname is the FIRST word of the full name.
  // This prevents false positives like "Mecha-Mark" (nickname "MARK") matching DB "Mark",
  // or "Fake Victor" (nickname "Victor") matching DB "Victor".
  const enByNickname = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash && e.nickname)) {
    const nick = e.nickname!.trim().toLowerCase();
    const firstWord = e.name
      .trim()
      .toLowerCase()
      .split(/[\s-]+/)[0];
    if (nick.length >= 2 && firstWord === nick) {
      if (!enByNickname.has(nick)) enByNickname.set(nick, []);
      enByNickname.get(nick)!.push(e);
    }
  }

  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const dbName = c.name_en.trim().toLowerCase();
    if (dbName.includes(" ")) continue;
    const zukanGroup = enByNickname.get(dbName);
    if (zukanGroup && zukanGroup.length > 0) {
      assignBest(ctx, c, zukanGroup, assigned);
    }
  }
  console.log(`Phase B1.5: +${assigned.size - beforeB15} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase B2: First-word match (zukan "Aaron Gachinsky" → DB "Aaron") strict pos+elem
  // ═══════════════════════════════════════
  console.log("\n--- Phase B2: First-word EN match ---");
  const beforeB2 = assigned.size;

  // Index zukan by first word
  const enByFirstWord = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const first = e.name.trim().split(/\s+/)[0].toLowerCase();
    if (first.length >= 3) {
      if (!enByFirstWord.has(first)) enByFirstWord.set(first, []);
      enByFirstWord.get(first)!.push(e);
    }
  }

  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const dbName = c.name_en.trim().toLowerCase();
    if (dbName.includes(" ")) continue;
    const zukanGroup = enByFirstWord.get(dbName);
    if (zukanGroup && zukanGroup.length > 0) {
      assignBest(ctx, c, zukanGroup, assigned);
    }
  }
  console.log(`Phase B2: +${assigned.size - beforeB2} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase B3: Last-word (surname) match — zukan "Cross Word Cryptix" → DB "Cross Word"
  // ═══════════════════════════════════════
  console.log("\n--- Phase B3: Surname match ---");
  const beforeB3 = assigned.size;

  // Index zukan by last word
  const enByLastWord = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const words = e.name.trim().split(/\s+/);
    if (words.length >= 2) {
      const last = words[words.length - 1].toLowerCase();
      if (last.length >= 3) {
        if (!enByLastWord.has(last)) enByLastWord.set(last, []);
        enByLastWord.get(last)!.push(e);
      }
    }
  }

  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_en) continue;
    const words = c.name_en.trim().split(/\s+/);
    if (words.length < 2) continue;
    // Try matching by last word of DB name
    const dbLast = words[words.length - 1].toLowerCase();
    const zukanGroup = enByLastWord.get(dbLast);
    if (!zukanGroup) continue;
    const dbFirst = words[0].toLowerCase();
    const filtered = zukanGroup.filter(z => z.name.toLowerCase().includes(dbFirst));
    if (filtered.length > 0) {
      assignBest(ctx, c, filtered, assigned);
    }
  }
  console.log(`Phase B3: +${assigned.size - beforeB3} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase B4: SKIP MixiMax — characters with × in name have no zukan page.
  // Assigning base form images to MixiMax entries causes wrong images.
  // These characters will use the fallback avatarUrl (bucket image).
  // ═══════════════════════════════════════
  console.log("\n--- Phase B4: MixiMax skipped (no zukan pages exist for MixiMax forms) ---");
  const mixiMaxCount = dbChars.filter(c => c.name_en && (c.name_en.includes("×") || c.name_en.includes("+"))).length;
  console.log(`Phase B4: ${mixiMaxCount} MixiMax characters excluded from zukan matching`);

  // ═══════════════════════════════════════
  // Phase JA-A: Exact JA name match (strict pos+elem+stats)
  // ═══════════════════════════════════════
  console.log("\n--- Phase JA-A: Exact JA name match ---");
  const beforeJA = assigned.size;
  for (const [name, zukanGroup] of jaByName) {
    const dbGroup = dbByNameJa.get(name);
    if (dbGroup) {
      const unassigned = dbGroup.filter(c => !assigned.has(c.id));
      if (unassigned.length > 0) matchGroupsStrict(ctx, zukanGroup, unassigned, assigned);
    }
  }
  console.log(`Phase JA-A: +${assigned.size - beforeJA} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase JA-B: JA nickname match — zukan JA nickname → DB name_ja single-word
  // ═══════════════════════════════════════
  console.log("\n--- Phase JA-B: JA nickname match ---");
  const beforeJAB = assigned.size;

  // Only index if the JA nickname appears at the start of the full JA name.
  // Prevents compound-name false positives (e.g., "飛張 益徳" nickname matching DB "飛").
  const jaByNickname = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash && e.nickname)) {
    const nick = e.nickname!.trim();
    const fullName = e.name.trim();
    if (nick.length >= 1 && fullName.startsWith(nick)) {
      if (!jaByNickname.has(nick)) jaByNickname.set(nick, []);
      jaByNickname.get(nick)!.push(e);
    }
  }

  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_ja) continue;
    const dbName = c.name_ja.trim();
    // Try matching by nickname for short names (no middle dot = likely single name)
    if (dbName.includes("・") || dbName.length > 8) continue;

    const zukanGroup = jaByNickname.get(dbName);
    if (!zukanGroup || zukanGroup.length === 0) continue;

    assignBest(ctx, c, zukanGroup, assigned);
  }
  console.log(`Phase JA-B: +${assigned.size - beforeJAB} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase JA-C: JA first-part match (before ・) — "チャオ・マオ" → zukan "チャオ マオ ..."
  // ═══════════════════════════════════════
  console.log("\n--- Phase JA-C: JA first-part match ---");
  const beforeJAC = assigned.size;

  // Index JA zukan by first word/part
  const jaByFirstPart = new Map<string, ZukanEntry[]>();
  for (const e of jaEntries.filter(e => e.zukanHash)) {
    // JA names may use spaces or middle dots
    const parts = e.name.trim().split(/[\s・]+/);
    if (parts[0] && parts[0].length >= 2) {
      if (!jaByFirstPart.has(parts[0])) jaByFirstPart.set(parts[0], []);
      jaByFirstPart.get(parts[0])!.push(e);
    }
  }

  for (const c of dbChars) {
    if (assigned.has(c.id) || !c.name_ja) continue;
    const parts = c.name_ja.trim().split(/[\s・]+/);
    if (parts.length < 2 || !parts[0] || parts[0].length < 2) continue;

    const zukanGroup = jaByFirstPart.get(parts[0]);
    if (!zukanGroup) continue;

    // Filter: zukan name must also contain second part of DB name
    const dbSecond = parts[1];
    const filtered = zukanGroup.filter(z => {
      if (!z.zukanHash) return false;
      const zParts = z.name.trim().split(/[\s・]+/);
      return zParts.some(p => p === dbSecond);
    });
    if (filtered.length > 0) {
      assignBest(ctx, c, filtered, assigned);
    }
  }
  console.log(`Phase JA-C: +${assigned.size - beforeJAC} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase JA-R: Romaji transliteration match
  // Convert unmatched DB name_ja → romaji, match against EN zukan entries
  // ═══════════════════════════════════════
  console.log("\n--- Phase JA-R: Romaji transliteration match ---");
  const beforeJAR = assigned.size;

  console.log("  Initializing Kuroshiro...");
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new KuromojiAnalyzer());

  // Build a normalized EN zukan index: lowercase, no diacritics, no punctuation
  function normalizeForMatch(s: string): string {
    return s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const enNormIndex = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const norm = normalizeForMatch(e.name);
    if (!enNormIndex.has(norm)) enNormIndex.set(norm, []);
    enNormIndex.get(norm)!.push(e);
    // Also index by first word
    const first = norm.split(" ")[0];
    if (first.length >= 3) {
      const fKey = `_first:${first}`;
      if (!enNormIndex.has(fKey)) enNormIndex.set(fKey, []);
      enNormIndex.get(fKey)!.push(e);
    }
  }

  // Convert unmatched DB chars' JA names to romaji and try matching
  const unmatched = dbChars.filter(c => !assigned.has(c.id) && c.name_ja);
  console.log(`  Converting ${unmatched.length} JA names to romaji...`);

  for (const c of unmatched) {
    const romaji = (await kuroshiro.convert(c.name_ja, {
      to: "romaji",
      romajiSystem: "hepburn",
    })) as string;
    const normRomaji = normalizeForMatch(romaji);
    if (!normRomaji || normRomaji.length < 2) continue;

    // Try exact match
    let zukanGroup = enNormIndex.get(normRomaji);

    // Try first-word match
    if (!zukanGroup) {
      const firstWord = normRomaji.split(" ")[0];
      if (firstWord.length >= 3) {
        zukanGroup = enNormIndex.get(`_first:${firstWord}`);
      }
    }

    if (!zukanGroup || zukanGroup.length === 0) continue;

    const candidates = zukanGroup
      .filter(z => z.zukanHash)
      .map(z => ({ z, score: matchScore(z, c) }))
      .filter(p => p.score >= 20)
      .sort((a, b) => b.score - a.score);
    if (candidates.length > 0) {
      assigned.set(c.id, candidates[0].z.zukanHash!);
    }
  }
  console.log(`Phase JA-R: +${assigned.size - beforeJAR} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase C: Inherit from same-name siblings (strict pos+elem+rarity)
  // ═══════════════════════════════════════
  console.log("\n--- Phase C: Inherit from siblings (strict) ---");
  const beforeC = assigned.size;

  for (const c of dbChars) {
    if (assigned.has(c.id)) continue;
    // Try EN siblings, then JA siblings
    const siblings = dbByNameEn.get(c.name_en?.trim().toLowerCase() || "") || dbByNameJa.get(c.name_ja?.trim() || "");
    if (siblings) {
      // Helper: check that sibling hash is not from a different era
      const sameEraOrUnknown = (s: DbChar) => {
        if (!c.series || !s.series) return true; // Can't verify era
        const cEra = ERAS[c.series];
        const sEra = ERAS[s.series];
        return !cEra || !sEra || cEra === sEra;
      };
      // descOk : le hash hérité ne doit pas avoir sim=0 avec la description DB du receveur
      const descOk = (s: DbChar) => {
        const hash = assigned.get(s.id);
        if (!hash) return false;
        const z = zukanByHash.get(hash);
        if (!z?.description || !c.description_en) return true; // pas de description → pas de rejet
        return descriptionSimilarity(z.description, c.description_en) > 0;
      };
      const withHash =
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.series === c.series &&
            s.rarity_label === c.rarity_label &&
            descOk(s),
        ) ||
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.series === c.series &&
            descOk(s),
        ) ||
        siblings.find(
          s =>
            assigned.has(s.id) &&
            s.position === c.position &&
            s.element === c.element &&
            s.rarity_label === c.rarity_label &&
            sameEraOrUnknown(s) &&
            descOk(s),
        );
      if (withHash) {
        assigned.set(c.id, assigned.get(withHash.id)!);
      }
    }
  }
  console.log(`Phase C: +${assigned.size - beforeC} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase D: Relaxed sibling inheritance (same name + series + position)
  // Position check prevents cross-position hash assignment (ex: GK hash → MF variant)
  // MixiMax characters (× in name) are excluded to avoid wrong base form images
  // ═══════════════════════════════════════
  console.log("\n--- Phase D: Relaxed sibling inheritance (series + position) ---");
  const beforeD = assigned.size;

  for (const c of dbChars) {
    if (assigned.has(c.id)) continue;
    // Skip MixiMax — no zukan page exists for them
    if (c.name_en && (c.name_en.includes("×") || c.name_en.includes("+"))) continue;
    // Try EN siblings, then JA siblings
    const siblings = dbByNameEn.get(c.name_en?.trim().toLowerCase() || "") || dbByNameJa.get(c.name_ja?.trim() || "");
    if (siblings) {
      const withHash = siblings.find(
        s =>
          assigned.has(s.id) &&
          s.series &&
          c.series &&
          s.series === c.series &&
          s.position === c.position &&
          (() => {
            const hash = assigned.get(s.id);
            if (!hash) return false;
            const z = zukanByHash.get(hash);
            if (!z?.description || !c.description_en) return true;
            return descriptionSimilarity(z.description, c.description_en) > 0;
          })(),
      );
      if (withHash) {
        assigned.set(c.id, assigned.get(withHash.id)!);
      }
    }
  }
  console.log(`Phase D: +${assigned.size - beforeD} (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Phase E: Era correction — swap hashes when a better-era match exists
  // Some characters have different portraits across eras (IE vs GO vs Modern).
  // If the assigned hash belongs to the wrong era but a correct-era hash exists
  // for the same name+pos+elem, swap to the correct one.
  // ═══════════════════════════════════════
  console.log("\n--- Phase E: Era correction ---");
  let eraSwaps = 0;

  // Index ALL zukan entries by name+pos+elem (not just unused)
  const zukanByNamePosElem = new Map<string, ZukanEntry[]>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    const pos = normPos(e.position);
    const elem = normElem(e.element);
    const key = `${e.name.trim().toLowerCase()}|${pos}|${elem}`;
    if (!zukanByNamePosElem.has(key)) zukanByNamePosElem.set(key, []);
    zukanByNamePosElem.get(key)!.push(e);
  }

  // Reverse lookup: hash → zukan entry
  const zukanHashToEntry = new Map<string, ZukanEntry>();
  for (const e of enEntries.filter(e => e.zukanHash)) {
    zukanHashToEntry.set(e.zukanHash!, e);
  }

  const ERA_ORDER: Record<string, number> = { OG: 1, GO: 2, Modern: 3 };

  for (const c of dbChars) {
    if (!assigned.has(c.id) || !c.series) continue;

    const currentHash = assigned.get(c.id)!;
    const currentZukan = zukanHashToEntry.get(currentHash);
    if (!currentZukan) continue;

    const zSeries = zukanGameToSeries(currentZukan.game);
    const dbEra = ERAS[c.series];
    const zEra = zSeries ? ERAS[zSeries] : null;
    const isHero = c.rarity_label === "Héros";

    // For heroes: swap to EARLIEST era image (OG portraits for returning OG characters)
    // For regular players: swap only if current hash is wrong era
    if (isHero) {
      const currentOrder = ERA_ORDER[zEra || ""] || 0;
      const key = `${(c.name_en || "").trim().toLowerCase()}|${c.position}|${c.element}`;
      const alternatives = zukanByNamePosElem.get(key);
      if (!alternatives) continue;

      let bestAlt: ZukanEntry | null = null;
      let bestOrder = currentOrder;
      for (const alt of alternatives) {
        if (alt.zukanHash === currentHash) continue;
        const altSeries = zukanGameToSeries(alt.game);
        const altEra = altSeries ? ERAS[altSeries] : null;
        const altOrder = ERA_ORDER[altEra || ""] || 0;
        if (altOrder < bestOrder) {
          bestOrder = altOrder;
          bestAlt = alt;
        }
      }
      if (bestAlt?.zukanHash) {
        assigned.set(c.id, bestAlt.zukanHash);
        eraSwaps++;
      }
    } else {
      // Regular player: fix wrong-era assignments
      if (!dbEra || !zEra || dbEra === zEra) continue;

      const key = `${(c.name_en || "").trim().toLowerCase()}|${c.position}|${c.element}`;
      const alternatives = zukanByNamePosElem.get(key);
      if (!alternatives) continue;

      let bestAlt: ZukanEntry | null = null;
      let bestScore = 0;
      for (const alt of alternatives) {
        if (alt.zukanHash === currentHash) continue;
        const altSeries = zukanGameToSeries(alt.game);
        const altEra = altSeries ? ERAS[altSeries] : null;
        let score = 0;
        if (altSeries === c.series) score = 100;
        else if (altEra === dbEra) score = 50;
        if (score > bestScore) {
          bestScore = score;
          bestAlt = alt;
        }
      }
      if (bestAlt?.zukanHash) {
        assigned.set(c.id, bestAlt.zukanHash);
        eraSwaps++;
      }
    }
  }
  console.log(`Phase E: ${eraSwaps} era corrections applied`);

  // ═══════════════════════════════════════
  // Validation: remove assignments where position OR element mismatch
  // ═══════════════════════════════════════
  console.log("\n--- Validation: post-assignment audit ---");
  let removed = 0;
  // zukanByHash et dbById déjà construits plus haut

  for (const [id, hash] of assigned) {
    const db = dbById.get(id);
    const z = zukanByHash.get(hash);
    if (!db || !z) continue;

    const zPos = normPos(z.position);
    const zElem = normElem(z.element);
    const dPos = db.position ? normPos(db.position) : null;
    const dElem = db.element ? normElem(db.element) : null;

    // Hard reject: element mismatch
    if (zElem && dElem && zElem !== dElem) {
      assigned.delete(id);
      usedHashes.delete(hash);
      removed++;
      continue;
    }
    // Hard reject: position mismatch
    if (zPos && dPos && zPos !== dPos) {
      assigned.delete(id);
      usedHashes.delete(hash);
      removed++;
    }
  }
  console.log(`Validation: removed ${removed} bad assignments (total: ${assigned.size})`);

  // ═══════════════════════════════════════
  // Validation description — log les matches suspects
  // ═══════════════════════════════════════
  console.log("\n--- Validation description ---");
  let descRejected = 0;
  for (const [id, hash] of assigned) {
    const db = dbById.get(id);
    const z = zukanByHash.get(hash);
    if (!db?.description_en || !z?.description) continue;
    const sim = descriptionSimilarity(z.description, db.description_en);
    if (sim === 0) {
      console.warn(
        `  REJET: ${db.name_en} (${db.series}) → zukan "${z.name}" | sim=0\n    DB: "${db.description_en.slice(0, 80)}"\n    Zukan: "${z.description.slice(0, 80)}"`,
      );
      assigned.delete(id);
      usedHashes.delete(hash);
      descRejected++;
    }
  }
  if (descRejected === 0) console.log("  Tous les matches avec description sont cohérents.");
  else console.log(`  ${descRejected} match(es) rejetés (sim=0 entre descriptions EN).`);

  // ═══════════════════════════════════════
  // Manual overrides — applied after all phases
  // Format: { charId: { hash, name? } } — name optionnel quand absent du cache local
  // ═══════════════════════════════════════
  const MANUAL_OVERRIDES: Record<string, { hash: string; name?: string }> = {
    "0x3F14143F": { hash: "k/p/j/pjw-aty8hpc", name: "Lucas Star" }, // Lucas (Orion BASARA)
    "0x24F07F94": { hash: "k/p/j/pjw-aty8hpc", name: "Lucas Star" }, // Lucas (Orion Héros)
    "0xB380F082": { hash: "k/p/j/pjw-aty8hpc", name: "Lucas Star" }, // Lucas (Orion Normal)
  };
  for (const [id, { hash, name }] of Object.entries(MANUAL_OVERRIDES)) {
    assigned.set(id, hash);
    if (name) {
      await sql`UPDATE inagle_characters SET name_en = ${name} WHERE id = ${id}`;
    }
  }
  console.log(`Manual overrides: ${Object.keys(MANUAL_OVERRIDES).length} applied`);

  // ═══════════════════════════════════════
  // Apply updates — clear stale first, then set new
  // ═══════════════════════════════════════
  console.log(`\nClearing stale zukan_hash values...`);
  const cleared = await sql`UPDATE inagle_characters SET zukan_hash = NULL WHERE zukan_hash IS NOT NULL RETURNING id`;
  if (cleared.length > 0) console.log(`Cleared ${cleared.length} existing zukan_hash values.`);

  // Maps hash → description par locale (source de vérité zukan)
  const descByHashEn = new Map<string, string>();
  const descByHashJa = new Map<string, string>();
  for (const e of enEntries) {
    if (e.zukanHash && e.description) descByHashEn.set(e.zukanHash, e.description);
  }
  for (const e of jaEntries) {
    if (e.zukanHash && e.description) descByHashJa.set(e.zukanHash, e.description);
  }

  console.log(`Applying ${assigned.size} updates...`);
  let applied = 0;
  let dupeSkipped = 0;
  let nameUpdated = 0;
  let descUpdated = 0;
  const appliedHashes = new Set<string>();
  for (const [id, hash] of assigned) {
    // Skip duplicate hashes (Phase C/D can assign same hash to siblings)
    if (appliedHashes.has(hash)) {
      dupeSkipped++;
      continue;
    }
    const [updated] = await sql`UPDATE inagle_characters SET zukan_hash = ${hash} WHERE id = ${id} RETURNING id`;
    if (updated) {
      applied++;
      appliedHashes.add(hash);
    }

    // Mettre à jour name_en + descriptions depuis le zukan (source de vérité)
    const zukanEntry = zukanByHash.get(hash);
    if (zukanEntry?.name) {
      const db = dbById.get(id);
      if (db && zukanEntry.name.trim().toLowerCase() !== (db.name_en || "").trim().toLowerCase()) {
        await sql`UPDATE inagle_characters SET name_en = ${zukanEntry.name.trim()} WHERE id = ${id}`;
        nameUpdated++;
      }
    }

    const descEn = descByHashEn.get(hash) ?? null;
    const descJa = descByHashJa.get(hash) ?? null;
    if (descEn || descJa) {
      await sql`UPDATE inagle_characters SET description_en = COALESCE(${descEn}, description_en), description_ja = COALESCE(${descJa}, description_ja) WHERE id = ${id}`;
      descUpdated++;
    }
  }
  console.log(`Applied ${applied} zukan_hash updates (${dupeSkipped} inherited dupes skipped).`);
  console.log(`Updated ${nameUpdated} name_en from zukan (source de vérité).`);
  console.log(`Updated ${descUpdated} descriptions (EN/JA) from zukan.`);

  // ═══════════════════════════════════════
  // Game Appearances: parse chara_list and update DB
  // Aggregate by character name (not hash) — Mark Evans appears in IE1, GO1, VR etc.
  // ═══════════════════════════════════════
  const { byHash: _gaByHash, byName: gaByName } = await loadListAppearances();

  if (gaByName.size > 0) {
    console.log(`\nUpdating game_appearances for all characters...`);
    let gaUpdated = 0;

    // Strategy: match DB character by name_en → aggregated appearances
    for (const c of dbChars) {
      const nameKey = (c.name_en || "").trim().toLowerCase();
      const appearances = gaByName.get(nameKey);
      if (appearances && appearances.length > 0) {
        const pgArr = `{${appearances.join(",")}}`;
        const [ga] =
          await sql`UPDATE inagle_characters SET game_appearances = ${pgArr}::text[] WHERE id = ${c.id} RETURNING id`;
        if (ga) gaUpdated++;
      }
    }

    console.log(`Game appearances: ${gaUpdated} characters updated.`);
  }

  // Verify
  const [stats] = await sql<{ total: number; without: number }[]>`
    SELECT COUNT(*) FILTER (WHERE zukan_hash IS NOT NULL) as total,
           COUNT(*) FILTER (WHERE zukan_hash IS NULL) as without
    FROM inagle_characters
  `;
  console.log(`\nFinal: ${stats.total} with zukan_hash, ${stats.without} without.`);

  const [gaStats] = await sql<{ ga_count: number }[]>`
    SELECT COUNT(*) FILTER (WHERE game_appearances IS NOT NULL AND array_length(game_appearances, 1) > 0) as ga_count
    FROM inagle_characters
  `;
  console.log(`Game appearances: ${gaStats.ga_count} characters with data.`);

  // Show unmatched
  const unmatchedSample = await sql<
    {
      name_ja: string;
      name_fr: string;
      name_en: string;
      id: string;
      position: string;
      element: string;
    }[]
  >`
    SELECT name_ja, name_fr, name_en, id, position, element
    FROM inagle_characters WHERE zukan_hash IS NULL ORDER BY id LIMIT 20
  `;
  if (unmatchedSample.length > 0) {
    console.log(`\nStill unmatched (${unmatchedSample.length} shown):`);
    for (const u of unmatchedSample) {
      console.log(
        `  ${(u.name_ja || "").padEnd(15)} ${(u.name_en || "").padEnd(20)} ${(u.name_fr || "").padEnd(20)} ${u.position}/${u.element} (${u.id})`,
      );
    }
  }

  await sql.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
