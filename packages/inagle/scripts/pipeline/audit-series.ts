/**
 * @file audit-series.ts
 * @description Scraper ultime — vérifie que chaque personnage du zukan officiel
 * est correctement assigné à sa série dans la base de données Azalee.
 *
 * Utilise https://zukan.inazuma.jp/en/chara_list/ (200 par page).
 * Chaque personnage a 9 colonnes appearedWorks (○/×) : ie1, ie2, ie3, go1, go2, go3, ars, ori, vic.
 * La série principale = le jeu le plus récent où le personnage apparaît.
 * Compare avec inagle_characters.series en BDD.
 *
 * Run: npx tsx src/scripts/audit-series.ts [--fresh] [--db]
 *   --fresh : re-crawl même si le cache existe
 *   --db    : appliquer les corrections en base de données
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import type { Client } from "pg";
import { createPgClient, getInagleDatabaseURL, isInagleDatabaseConfigured } from "@rosegriffon/db/pg";

const __dirname = import.meta.dir;
const PACKAGE_ROOT = resolve(__dirname, "../../..");
const DATA_ROOT = process.env.DATA_PATH ?? resolve(PACKAGE_ROOT, "data");

const CACHE_DIR = resolve(DATA_ROOT, "zukan/chara_list_cache_en");
const OUTPUT_PATH = resolve(DATA_ROOT, "zukan/series_audit.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 400;
const PER_PAGE = 200;
const MAX_PAGES = 40;

// ─── 9 jeux dans l'ordre des colonnes appearedWorks ──────────────────────────
// Ordre affiché sur le site : ie1, ie2, ie3, go1, go2, go3, ars, ori, vic

const GAME_KEYS = ["ie1", "ie2", "ie3", "go1", "go2", "go3", "ars", "ori", "vic"] as const;
type GameKey = (typeof GAME_KEYS)[number];

/** Série "principale" = jeu le plus récent (dernier de la liste) où ○ */
const GAME_TO_SERIES: Record<GameKey, string> = {
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ZukanCharacter {
  name: string;
  zukanHash: string | null;
  appearedIn: GameKey[]; // tous les jeux où le perso apparaît (○)
  primarySeries: string; // série Azalee correspondante (jeu le plus récent)
  singleGame: string | null; // label affiché si colspan=9 (perso d'un seul jeu)
}

interface AuditEntry {
  name: string;
  zukanHash: string | null;
  appearedIn: string[];
  zukanSeries: string;
  databaseSeries: string | null;
  databaseId: string | null;
  matchMethod: "hash" | "name" | null;
  status: "ok" | "wrong_series" | "not_found";
}

interface AuditReport {
  generatedAt: string;
  totalCrawled: number;
  totalMatched: number;
  totalWrongSeries: number;
  totalNotFound: number;
  bySeries: Record<string, { ok: number; wrong_series: number; not_found: number }>;
  anomalies: AuditEntry[];
}

// ─── Fetch + cache ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const HASH_RE = /cloudfront\.net\/1\/([^."]+)/;

async function fetchPage(page: number, forceFresh: boolean): Promise<string> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });

  const cachePath = resolve(CACHE_DIR, `page-${page}.html`);
  if (!forceFresh && existsSync(cachePath)) {
    const content = await readFile(cachePath, "utf-8");
    if (content.length > 1000) return content;
  }

  const url = `https://zukan.inazuma.jp/en/chara_list/?page=${page}&per_page=${PER_PAGE}`;
  console.log(`  Fetching page ${page}...`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(cachePath, html);
  return html;
}

function parsePage(html: string): ZukanCharacter[] {
  const $ = cheerio.load(html);
  const chars: ZukanCharacter[] = [];

  // Chaque personnage = 2 lignes <tr> dans <tbody>
  // Ligne 1 : checkbox (data-chara-id = zukanHash), nom, nickname, jeux (○/× ou colspan texte), genre
  // Ligne 2 : position, element, stats Lv50
  $("table tbody tr").each((_, row) => {
    const $row = $(row);

    // Ignorer les lignes sans checkbox (ligne 2 de chaque perso)
    const checkbox = $row.find("input.my-team-checkbox");
    if (checkbox.length === 0) return;

    const zukanHash = checkbox.attr("data-chara-id") ?? null;
    const name = checkbox.attr("data-chara-name")?.trim() ?? "?";

    // Image fallback
    const imgSrc = $row.find("img[src*='cloudfront.net/1/']").attr("src") ?? "";
    const hashFromImg = imgSrc.match(HASH_RE)?.[1] ?? null;
    const finalHash = zukanHash || hashFromImg;

    // Jeux appeared works
    // Cas 1 : colspan="9" → un seul jeu, texte = nom du jeu
    const colspanCell = $row.find("td[colspan='9']");
    let appearedIn: GameKey[] = [];
    let singleGame: string | null = null;

    if (colspanCell.length > 0) {
      singleGame = colspanCell.text().trim();
      // Trouver la clé correspondante
      const key = Object.entries(GAME_TO_SERIES).find(([, v]) => {
        const label = singleGame ?? "";
        if (v === "Inazuma Eleven" && label === "Inazuma Eleven") return true;
        if (v === "Inazuma Eleven 2" && label.startsWith("Inazuma Eleven 2")) return true;
        if (v === "Inazuma Eleven 3" && label.startsWith("Inazuma Eleven 3")) return true;
        if (v === "Inazuma Eleven GO" && label.startsWith("Inazuma Eleven GO: Light")) return true;
        if (v === "Chrono Stone" && label.includes("Chrono Stone")) return true;
        if (v === "Galaxy" && label.includes("Galaxy")) return true;
        if (v === "Ares" && label.includes("Ares")) return true;
        if (v === "Orion" && label.includes("Orion")) return true;
        if (v === "Victory Road" && label.includes("Victory Road")) return true;
        return false;
      })?.[0] as GameKey | undefined;
      if (key) appearedIn = [key];
    } else {
      // Cas 2 : 9 cellules td.appearedWorks avec ○/×
      const cells = $row.find("td.appearedWorks");
      cells.each((i, cell) => {
        if ($(cell).text().trim() === "○" && i < GAME_KEYS.length) appearedIn.push(GAME_KEYS[i]);
      });
    }

    // Série principale = jeu le plus récent (dernier dans appearedIn selon l'ordre GAME_KEYS)
    let primaryKey: GameKey | null = null;
    for (let i = GAME_KEYS.length - 1; i >= 0; i--) {
      if (appearedIn.includes(GAME_KEYS[i])) {
        primaryKey = GAME_KEYS[i];
        break;
      }
    }
    const primarySeries = primaryKey ? GAME_TO_SERIES[primaryKey] : "?";

    chars.push({ name, zukanHash: finalHash, appearedIn, primarySeries, singleGame });
  });

  return chars;
}

// ─── Crawl ────────────────────────────────────────────────────────────────────

async function crawlAll(forceFresh: boolean): Promise<ZukanCharacter[]> {
  console.log(`\nCrawl zukan.inazuma.jp/en/chara_list/ (${forceFresh ? "frais" : "cache"})...\n`);
  const all: ZukanCharacter[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(DELAY_MS);
    try {
      const html = await fetchPage(page, forceFresh);
      const entries = parsePage(html);
      if (entries.length === 0) {
        console.log(`  Page ${page}: vide — terminé.`);
        break;
      }
      all.push(...entries);
      console.log(`  Page ${page}: +${entries.length} (total ${all.length})`);
      if (entries.length < PER_PAGE) break;
    } catch (err) {
      console.error(`  Page ${page}: erreur —`, err);
      break;
    }
  }

  console.log(`\n→ ${all.length} personnages crawlés.`);
  return all;
}

// ─── Audit vs BDD ─────────────────────────────────────────────────────────────

async function auditAgainstDB(characters: ZukanCharacter[], client: Client): Promise<AuditReport> {
  console.log("\nChargement de la BDD...");
  const { rows: dbChars } = await client.query<{
    id: string;
    name_en: string | null;
    series: string | null;
    zukan_hash: string | null;
  }>("SELECT id, name_en, series, zukan_hash FROM inagle_characters");
  console.log(`  ${dbChars.length} personnages en BDD.\n`);

  // Index hash
  const byHash = new Map<string, (typeof dbChars)[0]>();
  for (const r of dbChars) if (r.zukan_hash) byHash.set(r.zukan_hash, r);

  // Index nom (groupé)
  const byName = new Map<string, (typeof dbChars)[0][]>();
  for (const r of dbChars) {
    if (!r.name_en) continue;
    const k = r.name_en.toLowerCase().trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(r);
  }

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    totalCrawled: 0,
    totalMatched: 0,
    totalWrongSeries: 0,
    totalNotFound: 0,
    bySeries: {},
    anomalies: [],
  };

  for (const zChar of characters) {
    if (zChar.primarySeries === "?") continue;
    report.totalCrawled++;

    if (!report.bySeries[zChar.primarySeries])
      report.bySeries[zChar.primarySeries] = { ok: 0, wrong_series: 0, not_found: 0 };

    // Match 1 : hash
    let dbRow = zChar.zukanHash ? (byHash.get(zChar.zukanHash) ?? null) : null;
    let matchMethod: AuditEntry["matchMethod"] = dbRow ? "hash" : null;

    // Match 2 : nom exact
    if (!dbRow) {
      const candidates = byName.get(zChar.name.toLowerCase()) ?? [];
      if (candidates.length === 1) {
        dbRow = candidates[0];
        matchMethod = "name";
      } else if (candidates.length > 1) {
        const best = candidates.find(c => c.series === zChar.primarySeries);
        if (best) {
          dbRow = best;
          matchMethod = "name";
        }
      }
    }

    if (!dbRow) {
      report.totalNotFound++;
      report.bySeries[zChar.primarySeries].not_found++;
      report.anomalies.push({
        name: zChar.name,
        zukanHash: zChar.zukanHash,
        appearedIn: zChar.appearedIn,
        zukanSeries: zChar.primarySeries,
        databaseSeries: null,
        databaseId: null,
        matchMethod: null,
        status: "not_found",
      });
      continue;
    }

    if (dbRow.series !== zChar.primarySeries) {
      report.totalWrongSeries++;
      report.bySeries[zChar.primarySeries].wrong_series++;
      report.anomalies.push({
        name: zChar.name,
        zukanHash: zChar.zukanHash,
        appearedIn: zChar.appearedIn,
        zukanSeries: zChar.primarySeries,
        databaseSeries: dbRow.series,
        databaseId: dbRow.id,
        matchMethod,
        status: "wrong_series",
      });
    } else {
      report.totalMatched++;
      report.bySeries[zChar.primarySeries].ok++;
    }
  }

  return report;
}

// ─── Corrections BDD ──────────────────────────────────────────────────────────

async function applyCorrections(report: AuditReport, client: Client): Promise<void> {
  const toFix = report.anomalies.filter(a => a.status === "wrong_series" && a.databaseId);
  if (toFix.length === 0) {
    console.log("Aucune correction nécessaire.");
    return;
  }

  console.log(`\nCorrection de ${toFix.length} séries...`);
  let fixed = 0;
  for (const a of toFix) {
    await client.query("UPDATE inagle_characters SET series = $1 WHERE id = $2", [a.zukanSeries, a.databaseId]);
    fixed++;
  }
  console.log(`  ✓ ${fixed} personnages corrigés.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  return total ? ((n / total) * 100).toFixed(1) : "0.0";
}

async function main() {
  const forceFresh = process.argv.includes("--fresh");
  const applyFix = process.argv.includes("--db");

  console.log("═════════════════════════════════════════════════════════════════");
  console.log("  Audit Zukan — Vérification des séries Azalee vs zukan.inazuma.jp");
  console.log("═════════════════════════════════════════════════════════════════");
  console.log(`Mode : ${forceFresh ? "crawl frais" : "cache"} | ${applyFix ? "correction BDD" : "rapport seul"}`);

  const characters = await crawlAll(forceFresh);

  // Stats distribution séries
  const dist = new Map<string, number>();
  for (const c of characters) dist.set(c.primarySeries, (dist.get(c.primarySeries) ?? 0) + 1);
  console.log("\nDistribution par série principale :");
  for (const [s, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${s}`);

  if (!isInagleDatabaseConfigured()) {
    console.warn("\nNo valid INAGLE_DATABASE_URL/NIE_PG_URL — database audit skipped.");
    await writeFile(OUTPUT_PATH, JSON.stringify({ characters }, null, 2));
    return;
  }

  const client = createPgClient(getInagleDatabaseURL());
  await client.connect();
  const report = await auditAgainstDB(characters, client);

  console.log("\n═════════════════════════════════════════════════════════════════");
  console.log(`Total crawlé  : ${report.totalCrawled}`);
  console.log(`Matchés OK    : ${report.totalMatched}  (${pct(report.totalMatched, report.totalCrawled)}%)`);
  console.log(`Série erronée : ${report.totalWrongSeries}  (${pct(report.totalWrongSeries, report.totalCrawled)}%)`);
  console.log(`Non trouvé    : ${report.totalNotFound}  (${pct(report.totalNotFound, report.totalCrawled)}%)`);
  console.log("─────────────────────────────────────────────────────────────────");
  console.log("Détail par série :");
  for (const [series, s] of Object.entries(report.bySeries)) {
    const total = s.ok + s.wrong_series + s.not_found;
    const icon = s.wrong_series > 0 ? "⚠" : s.not_found > 5 ? "○" : "✓";
    console.log(
      `  ${icon} ${series.padEnd(22)}  OK:${String(s.ok).padStart(4)}  ` +
        `Erreurs:${String(s.wrong_series).padStart(4)}  Manquants:${String(s.not_found).padStart(4)}  ` +
        `(${pct(s.ok, total)}%)`,
    );
  }

  if (report.anomalies.length) {
    const wrongs = report.anomalies.filter(a => a.status === "wrong_series");
    const missing = report.anomalies.filter(a => a.status === "not_found");
    if (wrongs.length) {
      console.log(`\n⚠ Exemples séries incorrectes :`);
      wrongs.slice(0, 15).forEach(a => {
        console.log(`  ✗ "${a.name}"  BDD="${a.databaseSeries}" → attendu="${a.zukanSeries}" [${a.matchMethod}]`);
      });
    }
    if (missing.length) {
      console.log(`\n○ Exemples non trouvés :`);
      missing.slice(0, 10).forEach(a => {
        console.log(`  ? "${a.name}"  (${a.zukanSeries})`);
      });
    }
  }

  if (applyFix) await applyCorrections(report, client);
  else if (report.totalWrongSeries > 0)
    console.log(`\n→ Relancer avec --db pour corriger ${report.totalWrongSeries} séries.`);

  await client.end();
  await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nRapport : ${OUTPUT_PATH}`);
  console.log("═════════════════════════════════════════════════════════════════");
}

main().catch(console.error);
