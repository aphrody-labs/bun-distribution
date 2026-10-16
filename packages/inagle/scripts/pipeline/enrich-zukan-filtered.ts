/**
 * Enrichit la base inagle_characters depuis une page zukan filtree.
 *
 * Accepte n'importe quelle URL chara_list filtree du zukan en argument :
 *   bun src/scripts/enrich-zukan-filtered.ts "https://zukan.inazuma.jp/en/chara_list/?q=...&per_page=200"
 *
 * Actions :
 *   1. Fetch la page HTML
 *   2. Parse chaque <tbody> pour extraire : name, zukanHash, position, element, gender, game,
 *      gameAppearances (9 colonnes), team, description
 *   3. Match par name_en dans inagle_characters (case-insensitive, dedup par pos+elem)
 *   4. Update : zukan_hash (si NULL), game_appearances (merge union), description_en (si vide)
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { createPgClient, getInagleDatabaseURL } from "@rosegriffon/db/pg";

// ─── Config ─────────────────────────────────────────────────

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GAME_KEYS = ["ie1", "ie2", "ie3", "go1", "go2", "go3", "ars", "ori", "vic"] as const;
type GameKey = (typeof GAME_KEYS)[number];

const GAME_LABEL_TO_KEY: [GameKey, (label: string) => boolean][] = [
  ["ie1", l => l === "Inazuma Eleven"],
  ["ie2", l => l.startsWith("Inazuma Eleven 2")],
  ["ie3", l => l.startsWith("Inazuma Eleven 3")],
  ["go1", l => l.startsWith("Inazuma Eleven GO") && !l.includes("Chrono") && !l.includes("Galaxy")],
  ["go2", l => l.includes("Chrono Stone") || l.startsWith("Inazuma Eleven GO2")],
  ["go3", l => l.includes("Galaxy")],
  ["ars", l => l.includes("Ares")],
  ["ori", l => l.includes("Orion")],
  ["vic", l => l.includes("Victory Road")],
];

// ─── Normalisation ──────────────────────────────────────────

/** Normalize to canonical EN (DB may have EN or FR values) */
const POS_MAP: Record<string, string> = {
  FW: "FW",
  MF: "MF",
  DF: "DF",
  GK: "GK",
  Attaquant: "FW",
  Milieu: "MF",
  Défenseur: "DF",
  Defenseur: "DF",
  Gardien: "GK",
};

const ELEM_MAP: Record<string, string> = {
  Fire: "Fire",
  Wind: "Wind",
  Forest: "Forest",
  Mountain: "Mountain",
  Void: "Void",
  Feu: "Fire",
  Vent: "Wind",
  Forêt: "Forest",
  Foret: "Forest",
  Montagne: "Mountain",
  Néant: "Void",
  Neant: "Void",
};

function normPos(p: string): string | null {
  return POS_MAP[p] || p || null;
}

function normElem(e: string): string | null {
  return ELEM_MAP[e] || e || null;
}

// ─── Types ──────────────────────────────────────────────────

interface ZukanEntry {
  name: string;
  nickname: string | null;
  zukanHash: string | null;
  position: string | null; // EN: GK, DF, MF, FW
  element: string | null; // EN: Fire, Wind, Forest, Mountain
  gender: string | null;
  team: string | null;
  description: string | null;
  gameAppearances: GameKey[];
}

interface DbChar {
  id: string;
  name_en: string | null;
  position: string | null; // FR: Gardien, Defenseur, Milieu, Attaquant
  element: string | null; // FR: Feu, Vent, Foret, Montagne
  zukan_hash: string | null;
  description_en: string | null;
  game_appearances: string[] | null;
}

// ─── HTML Parse ─────────────────────────────────────────────

const HASH_RE = /cloudfront\.net\/1\/([^."]+)/;

function parseCharacterListHtml(html: string): ZukanEntry[] {
  const $ = cheerio.load(html);
  const characters: ZukanEntry[] = [];

  $("tbody").each((_, tbody) => {
    const row = $(tbody).find("tr").first();
    const checkbox = row.find("input.my-team-checkbox");

    if (!checkbox.length) return;

    const name = (checkbox.attr("data-chara-name") || "").trim();
    const nickname = checkbox.attr("data-nickname")?.trim() || null;
    if (!name) return;

    // Image hash from CloudFront
    let zukanHash: string | null = null;
    const imgSrc =
      row.find("source[srcset*='cloudfront.net/1/']").attr("srcset") ||
      row.find("img[src*='cloudfront.net/1/']").attr("src");
    if (imgSrc) {
      const match = imgSrc.match(HASH_RE);
      if (match) zukanHash = match[1];
    }

    // Fields from cell indices
    const cells = row.find("td");
    const gender = cells.eq(5).text().trim() || null;
    const element = cells.eq(6).text().trim() || null;
    const position = cells.eq(7).text().trim() || null;
    const team = cells.eq(11).text().trim() || null;

    // Description
    const descEl = $(tbody).find("p.description");
    const description = descEl.length
      ? descEl
          .html()
          ?.replace(/<br\s*\/?>/g, " ")
          .replace(/<[^>]+>/g, "")
          .trim() || null
      : null;

    // Game appearances
    const gameAppearances: GameKey[] = [];
    const colspanCell = $(tbody).find("td[colspan='9']");
    if (colspanCell.length > 0) {
      const gameLabel = colspanCell.text().trim();
      for (const [key, test] of GAME_LABEL_TO_KEY) {
        if (test(gameLabel)) {
          gameAppearances.push(key);
          break;
        }
      }
    } else {
      $(tbody)
        .find("td.appearedWorks")
        .each((i, cell) => {
          if ($(cell).text().trim() === "\u25CB" && i < GAME_KEYS.length) {
            gameAppearances.push(GAME_KEYS[i]);
          }
        });
    }

    characters.push({
      name,
      nickname,
      zukanHash,
      position,
      element,
      gender,
      team,
      description,
      gameAppearances,
    });
  });

  return characters;
}

// ─── DB Matching ────────────────────────────────────────────

function buildNameIndex(dbChars: DbChar[]): Map<string, DbChar[]> {
  const index = new Map<string, DbChar[]>();
  for (const c of dbChars) {
    const key = (c.name_en || "").trim().toLowerCase();
    if (!key) continue;
    const arr = index.get(key) || [];
    arr.push(c);
    index.set(key, arr);
  }
  return index;
}

function findBestMatch(entry: ZukanEntry, candidates: DbChar[]): DbChar | null {
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates: score by position + element match
  const zPos = entry.position ? normPos(entry.position) : null;
  const zElem = entry.element ? normElem(entry.element) : null;

  let best: DbChar | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    let score = 0;
    if (zPos && c.position) {
      if (zPos === c.position) score += 10;
      else score -= 5;
    }
    if (zElem && c.element) {
      if (zElem === c.element) score += 10;
      else score -= 5;
    }
    // Prefer characters without zukan_hash (fill gaps first)
    if (!c.zukan_hash) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

// ─── Merge game appearances (union) ────────────────────────

function mergeAppearances(existing: string[] | null, incoming: GameKey[]): string[] {
  const set = new Set<string>(existing || []);
  for (const g of incoming) set.add(g);
  // Sort in canonical order
  return GAME_KEYS.filter(k => set.has(k));
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage:");
    console.error("  bun enrich-zukan-filtered.ts <URL>          # Fetch + enrich");
    console.error("  bun enrich-zukan-filtered.ts --dir <path>   # Parse local cache dir");
    console.error("  bun enrich-zukan-filtered.ts --all-games    # Parse all 9 game caches");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[MODE DRY-RUN] Aucune ecriture en base.\n");

  // ─── 1. Load HTML(s) ─────────────────────────────────────
  let entries: ZukanEntry[] = [];

  if (arg === "--all-games") {
    const PACKAGE_ROOT = resolve(import.meta.dirname || ".", "../..");
    const cacheRoot = resolve(PACKAGE_ROOT, "data/zukan/audit_series_cache");
    const games = ["ie1", "ie2", "ie3", "go1", "go2", "go3", "ares", "orion", "vr"];
    const { readdirSync, readFileSync } = await import("node:fs");
    for (const game of games) {
      const gameDir = resolve(cacheRoot, game);
      if (!existsSync(gameDir)) {
        console.log(`  ${game}: no cache`);
        continue;
      }
      const files = readdirSync(gameDir)
        .filter((f: string) => f.endsWith(".html"))
        .sort();
      let n = 0;
      for (const file of files) {
        const html = readFileSync(resolve(gameDir, file), "utf-8");
        n += parseCharacterListHtml(html).length;
        entries.push(...parseCharacterListHtml(html));
      }
      console.log(`  ${game}: ${files.length} pages, ${n} chars`);
    }
  } else if (arg === "--dir") {
    const dirPath = resolve(process.argv[3] || ".");
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync(dirPath)
      .filter((f: string) => f.endsWith(".html"))
      .sort();
    console.log(`Parsing ${files.length} files from ${dirPath}...`);
    for (const file of files) {
      entries.push(...parseCharacterListHtml(readFileSync(resolve(dirPath, file), "utf-8")));
    }
  } else if (arg.startsWith("http")) {
    console.log(`Fetching ${arg} ...`);
    const res = await fetch(arg, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    entries = parseCharacterListHtml(await res.text());
  } else {
    console.error("Arg invalide. URL, --dir <path>, ou --all-games");
    process.exit(1);
  }

  // Dedup by name+hash (same char across game pages)
  const seen = new Map<string, ZukanEntry>();
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}|${e.zukanHash || ""}`;
    const existing = seen.get(key);
    if (existing) {
      for (const g of e.gameAppearances) {
        if (!existing.gameAppearances.includes(g)) existing.gameAppearances.push(g);
      }
    } else {
      seen.set(key, e);
    }
  }
  entries = Array.from(seen.values());

  console.log(`\nPersonnages parses : ${entries.length} (dedup)`);
  const withHash = entries.filter(e => e.zukanHash).length;
  console.log(`  avec zukanHash : ${withHash}`);
  console.log(`  avec gameAppearances : ${entries.filter(e => e.gameAppearances.length > 0).length}\n`);

  // ─── 3. Connect DB ────────────────────────────────────────
  const client = createPgClient(getInagleDatabaseURL());
  await client.connect();
  console.log("Connecte a la base de donnees.\n");

  // ─── 4. Load DB characters ────────────────────────────────
  const { rows: dbChars } = await client.query<DbChar>(
    `SELECT id, name_en, position, element, zukan_hash, description_en, game_appearances
     FROM inagle_characters`,
  );
  console.log(`Personnages en base : ${dbChars.length}`);

  const nameIndex = buildNameIndex(dbChars);

  // Build first-word index for fallback matching
  // Zukan "Alexander Allegrov" → try DB "Alexander" if exact match fails
  const firstWordIndex = new Map<string, DbChar[]>();
  for (const c of dbChars) {
    const name = (c.name_en || "").trim().toLowerCase();
    if (!name || name.includes(" ")) continue; // Only index single-word DB names
    const arr = firstWordIndex.get(name) || [];
    arr.push(c);
    firstWordIndex.set(name, arr);
  }

  // ─── 5. Match & Update ────────────────────────────────────
  let hashUpdated = 0;
  let hashSkipped = 0;
  let hashAlreadyTaken = 0;
  let gaUpdated = 0;
  let descUpdated = 0;
  let nameUpdated = 0;
  let noMatch = 0;

  // Track existing hashes to avoid unique constraint violations
  const existingHashes = new Set<string>();
  for (const c of dbChars) {
    if (c.zukan_hash) existingHashes.add(c.zukan_hash);
  }

  const unmatched: string[] = [];

  for (const entry of entries) {
    const nameKey = entry.name.toLowerCase().trim();
    let candidates = nameIndex.get(nameKey);

    // Fallback: zukan "Alexander Allegrov" → try DB "Alexander" (first word)
    if (!candidates || candidates.length === 0) {
      const firstWord = nameKey.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 3) {
        candidates = firstWordIndex.get(firstWord);
      }
    }

    // Fallback 2: zukan "Basile Hardy" → try full name match in DB
    if (!candidates || candidates.length === 0) {
      const words = nameKey.split(/\s+/);
      if (words.length >= 2) {
        // Try last word as well
        const lastName = words[words.length - 1];
        if (lastName.length >= 3) {
          candidates = firstWordIndex.get(lastName);
        }
      }
    }

    if (!candidates || candidates.length === 0) {
      noMatch++;
      unmatched.push(entry.name);
      continue;
    }

    const match = findBestMatch(entry, candidates);
    if (!match) {
      noMatch++;
      unmatched.push(entry.name);
      continue;
    }

    // ─── Update zukan_hash (seulement si NULL en base) ──────
    if (entry.zukanHash && !match.zukan_hash) {
      if (existingHashes.has(entry.zukanHash)) {
        hashAlreadyTaken++;
      } else if (!dryRun) {
        try {
          const result = await client.query(
            `UPDATE inagle_characters SET zukan_hash = $1 WHERE id = $2 AND zukan_hash IS NULL`,
            [entry.zukanHash, match.id],
          );
          if (result.rowCount && result.rowCount > 0) {
            hashUpdated++;
            existingHashes.add(entry.zukanHash);
          }
        } catch (err: any) {
          // Unique constraint violation — hash already used
          if (err.code === "23505") {
            hashAlreadyTaken++;
          } else {
            throw err;
          }
        }
      } else {
        hashUpdated++;
      }
    } else if (entry.zukanHash && match.zukan_hash) {
      hashSkipped++;
    }

    // ─── Update game_appearances (merge union) ──────────────
    if (entry.gameAppearances.length > 0) {
      const merged = mergeAppearances(match.game_appearances, entry.gameAppearances);
      const existingStr = (match.game_appearances || []).sort().join(",");
      const mergedStr = merged.sort().join(",");

      if (existingStr !== mergedStr) {
        if (!dryRun) {
          const result = await client.query(`UPDATE inagle_characters SET game_appearances = $1 WHERE id = $2`, [
            merged,
            match.id,
          ]);
          if (result.rowCount && result.rowCount > 0) gaUpdated++;
        } else {
          gaUpdated++;
        }
      }
    }

    // ─── Update name_en (if zukan has a longer/fuller name) ──
    const dbName = (match.name_en || "").trim();
    const zukanName = entry.name.trim();
    if (zukanName.length > dbName.length && zukanName.toLowerCase().startsWith(dbName.toLowerCase())) {
      if (!dryRun) {
        await client.query(`UPDATE inagle_characters SET name_en = $1, name_fr = $1 WHERE id = $2`, [
          zukanName,
          match.id,
        ]);
        nameUpdated++;
      } else {
        nameUpdated++;
      }
    }

    // ─── Update description_en (seulement si vide) ──────────
    if (entry.description && (!match.description_en || match.description_en.trim() === "")) {
      if (!dryRun) {
        const result = await client.query(
          `UPDATE inagle_characters SET description_en = $1 WHERE id = $2 AND (description_en IS NULL OR description_en = '')`,
          [entry.description, match.id],
        );
        if (result.rowCount && result.rowCount > 0) descUpdated++;
      } else {
        descUpdated++;
      }
    }
  }

  // ─── 6. Rapport ───────────────────────────────────────────
  console.log("\n=== Rapport ===");
  console.log(`Personnages parses           : ${entries.length}`);
  console.log(`Matches trouves              : ${entries.length - noMatch}`);
  console.log(`Sans match en base           : ${noMatch}`);
  console.log(`zukan_hash mis a jour        : ${hashUpdated}`);
  console.log(`zukan_hash deja presents     : ${hashSkipped}`);
  console.log(`zukan_hash deja pris (unique): ${hashAlreadyTaken}`);
  console.log(`game_appearances mis a jour  : ${gaUpdated}`);
  console.log(`name_en enrichis (prenom→complet): ${nameUpdated}`);
  console.log(`description_en mis a jour    : ${descUpdated}`);

  if (unmatched.length > 0) {
    console.log(`\nPersonnages non trouves en base (${unmatched.length}) :`);
    for (const name of unmatched.slice(0, 30)) {
      console.log(`  - ${name}`);
    }
    if (unmatched.length > 30) console.log(`  ... et ${unmatched.length - 30} autres`);
  }

  // Stats finales
  if (!dryRun) {
    const {
      rows: [stats],
    } = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(zukan_hash) as with_hash,
        COUNT(*) - COUNT(zukan_hash) as without_hash,
        COUNT(game_appearances) FILTER (WHERE array_length(game_appearances, 1) > 0) as with_ga,
        COUNT(description_en) FILTER (WHERE description_en IS NOT NULL AND description_en != '') as with_desc
      FROM inagle_characters
    `);
    console.log(`\n=== Stats base apres enrichissement ===`);
    console.log(`Total personnages            : ${stats.total}`);
    console.log(`Avec zukan_hash              : ${stats.with_hash}`);
    console.log(`Sans zukan_hash              : ${stats.without_hash}`);
    console.log(`Avec game_appearances        : ${stats.with_ga}`);
    console.log(`Avec description_en          : ${stats.with_desc}`);
  }

  await client.end();
  console.log("\nTermine.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
