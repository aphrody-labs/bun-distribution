/**
 * Crawl zukan.inazuma.jp EN chara_param pages to establish the official character order.
 * Outputs a JSON map: zukanHash -> { order, name, game, position, element }
 * Then updates inagle_characters.zukan_order in the database.
 *
 * Uses Cheerio 1.x `$.extract()` for declarative page parsing.
 *
 * Run: npx tsx scripts/crawl-zukan-order.ts [--fresh]
 *   --fresh : re-crawl even if cache exists
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildOrderMap } from "../../src/zukan/order.ts";
import { createPgClient, getInagleDatabaseURL, isInagleDatabaseConfigured } from "@rosegriffon/db/pg";
import * as cheerio from "cheerio";

const __dirname = import.meta.dir;
const PACKAGE_ROOT = resolve(__dirname, "../../..");

const DATA_ROOT = process.env.DATA_PATH ? resolve(process.env.DATA_PATH, "zukan") : resolve(PACKAGE_ROOT, "data/zukan");
const CACHE_DIR = resolve(DATA_ROOT, "chara_param_cache_en");
const OUTPUT_PATH = resolve(DATA_ROOT, "zukan_order_en.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 350;
const PER_PAGE = 200;
const MAX_PAGES = 30;

// ─── Types ───────────────────────────────────────────────────

interface ZukanOrderEntry {
  order: number;
  name: string;
  zukanHash: string | null;
  game: string;
  position: string;
  element: string;
}

// ─── Fetch ───────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPage(pageNum: number, forceFresh: boolean): Promise<string> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });

  const cachePath = resolve(CACHE_DIR, `page-${pageNum}.html`);

  if (!forceFresh && existsSync(cachePath)) {
    const info = await stat(cachePath);
    if (info.size > 1000) return readFile(cachePath, "utf-8");
  }

  const url = `https://zukan.inazuma.jp/en/chara_param/?page=${pageNum}&per_page=${PER_PAGE}`;
  console.log(`  Fetching page ${pageNum}...`);

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for page ${pageNum}`);

  const html = await res.text();
  await writeFile(cachePath, html);
  return html;
}

// ─── Parse (Cheerio 1.x extract) ────────────────────────────

const HASH_RE = /cloudfront\.net\/1\/([^."]+)/;

function parsePage(html: string, startIndex: number): ZukanOrderEntry[] {
  const $ = cheerio.load(html);

  const raw = $.extract({
    characters: [
      {
        selector: "ul.charaListBox > li",
        value: {
          // Name from img alt (clean, no furigana)
          imgAlt: { selector: "img[src*='cloudfront']", value: "alt" },
          // Hash from CloudFront image URL
          imgSrc: { selector: "img[src*='cloudfront.net/1/']", value: "src" },
          srcsetSrc: { selector: "source[srcset*='cloudfront.net/1/']", value: "srcset" },
          // Position & Element via :has() + :contains()
          position: "dl:has(dt:contains('Position')) dd p",
          element: "dl:has(dt:contains('Element')) dd p",
          // Game title
          game: "dl.appearedWorks dd",
        },
      },
    ],
  });

  return raw.characters.map((c, i) => {
    const src = c.imgSrc || c.srcsetSrc;
    const hashMatch = src?.match(HASH_RE);

    return {
      order: startIndex + i,
      name: c.imgAlt?.trim() || "?",
      zukanHash: hashMatch?.[1] ?? null,
      position: c.position?.trim() || "?",
      element: c.element?.trim() || "?",
      game: c.game?.trim() || "?",
    };
  });
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const forceFresh = process.argv.includes("--fresh");
  console.log(`Crawling zukan EN chara_param (${forceFresh ? "fresh" : "using cache"})...\n`);

  const allEntries: ZukanOrderEntry[] = [];
  let globalIndex = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(DELAY_MS);
    try {
      const html = await fetchPage(page, forceFresh);
      const entries = parsePage(html, globalIndex);
      if (entries.length === 0) {
        console.log(`  Page ${page}: empty — done.`);
        break;
      }
      allEntries.push(...entries);
      globalIndex += entries.length;
      if (page % 5 === 0 || page === 1) {
        console.log(`  Page ${page}: ${entries.length} entries (total: ${allEntries.length})`);
      }
    } catch (err) {
      console.error(`  Page ${page}: error — ${err}`);
      break;
    }
  }

  console.log(`\nTotal crawled: ${allEntries.length} characters in official order.`);

  const withHash = allEntries.filter(e => e.zukanHash).length;
  console.log(`With zukanHash: ${withHash}/${allEntries.length}`);

  // Game distribution
  const games = new Map<string, number>();
  for (const e of allEntries) games.set(e.game, (games.get(e.game) || 0) + 1);
  console.log("\nGame distribution:");
  for (const [game, count] of [...games.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)} ${game}`);
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(allEntries, null, 2));
  console.log(`\nSaved to ${OUTPUT_PATH}`);

  // ─── DB update ─────────────────────────────────────────────

  if (!isInagleDatabaseConfigured()) {
    console.log("\nNo valid INAGLE_DATABASE_URL/NIE_PG_URL — skipping DB update.");
    return;
  }

  const client = createPgClient(getInagleDatabaseURL());
  await client.connect();
  console.log("\nConnected to DB.");

  await client.query(`
		DO $$ BEGIN
			ALTER TABLE inagle_characters ADD COLUMN zukan_order INTEGER;
		EXCEPTION WHEN duplicate_column THEN NULL;
		END $$;
	`);
  await client.query(`
		CREATE INDEX IF NOT EXISTS idx_characters_zukan_order
		ON inagle_characters(zukan_order ASC NULLS LAST);
	`);

  // Build hash → order map (helper partagé du module order unifié)
  const orderMap = buildOrderMap(allEntries);

  // Batch update via single query
  const { rows: dbChars } = await client.query(
    "SELECT id, zukan_hash FROM inagle_characters WHERE zukan_hash IS NOT NULL",
  );

  let updated = 0;
  for (const row of dbChars) {
    const order = orderMap[row.zukan_hash];
    if (order !== undefined) {
      const result = await client.query(
        "UPDATE inagle_characters SET zukan_order = $1 WHERE id = $2 AND (zukan_order IS NULL OR zukan_order != $1)",
        [order, row.id],
      );
      if (result.rowCount && result.rowCount > 0) updated++;
    }
  }

  console.log(`Updated ${updated} characters with zukan_order.`);

  const {
    rows: [stats],
  } = await client.query(`
		SELECT
			COUNT(*) as total,
			COUNT(zukan_order) as with_order,
			COUNT(*) - COUNT(zukan_order) as without_order,
			MIN(zukan_order) as min_order,
			MAX(zukan_order) as max_order
		FROM inagle_characters
	`);
  console.log(
    `\nFinal: ${stats.with_order}/${stats.total} with zukan_order (range ${stats.min_order}–${stats.max_order})`,
  );

  const { rows: sample } = await client.query(`
		SELECT name_en, series, zukan_order FROM inagle_characters
		WHERE zukan_order IS NOT NULL ORDER BY zukan_order ASC LIMIT 10
	`);
  console.log("\nFirst 10 in official order:");
  for (const r of sample)
    console.log(`  #${String(r.zukan_order).padStart(4)} ${(r.name_en || "?").padEnd(25)} (${r.series})`);

  const { rows: sampleLast } = await client.query(`
		SELECT name_en, series, zukan_order FROM inagle_characters
		WHERE zukan_order IS NOT NULL ORDER BY zukan_order DESC LIMIT 10
	`);
  console.log("\nLast 10 in official order:");
  for (const r of sampleLast.reverse())
    console.log(`  #${String(r.zukan_order).padStart(4)} ${(r.name_en || "?").padEnd(25)} (${r.series})`);

  await client.end();
  console.log("\nDone.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
