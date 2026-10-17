// SPDX-License-Identifier: Apache-2.0
/**
 * Instant game search from public sources only: a local `bun:sqlite` FTS5 index of every app the
 * host knows (PICS `app_info`, store `appdetails`, cached store search results) merged with the
 * live keyless `store.steampowered.com/api/storesearch` endpoint. Apps installed on this PC or on
 * a remote host (`search-index --host vps`) are flagged. SteamDB's search backend is never used.
 *
 * `searchApps` is the typed entry point for as-you-type callers (play.aphrody.app WebSocket).
 */
import type { Database } from "bun:sqlite";
import { USER_AGENT } from "./apiindex.js";
import { installedGames } from "./libraries.js";
import { resolveSteamRoot } from "./paths.js";
import { kvObj, kvStr, parseTextKv } from "./vdf.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_catalog (appid INTEGER PRIMARY KEY, name TEXT NOT NULL, aliases TEXT, type TEXT,
  release TEXT, developer TEXT, publisher TEXT, tags TEXT, price TEXT, image TEXT, sources TEXT, updated_at TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS app_fts USING fts5(appid UNINDEXED, name, aliases, developer, publisher, tags, type,
  tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS installed_app (host TEXT NOT NULL, appid INTEGER NOT NULL, name TEXT, library TEXT,
  updated_at TEXT NOT NULL, PRIMARY KEY(host, appid));
`;

export interface SearchHit {
  appid: number;
  name: string;
  type: string | null;
  release: string | null;
  developer: string | null;
  publisher: string | null;
  tags: string[];
  price: { currency: string; initial: number; final: number } | null;
  image: string | null;
  /** Hosts where the app is installed (`local` = this machine). */
  installed: string[];
  /** `fts`, `store` (live store search). */
  sources: string[];
  score: number;
}

export interface SearchOptions {
  /** Query the live store search too (default true). */
  live?: boolean | undefined;
  limit?: number | undefined;
  /** Store country code (prices) and language. */
  cc?: string | undefined;
  lang?: string | undefined;
}

interface CatalogRow {
  appid: number;
  name: string;
  aliases?: string | null;
  type?: string | null;
  release?: string | null;
  developer?: string | null;
  publisher?: string | null;
  tags?: string[] | null;
  price?: SearchHit["price"];
  image?: string | null;
  source: string;
}

export function ensureSearchSchema(db: Database): void {
  db.run(SCHEMA);
}

/** Upserts catalog rows and their FTS entries (fields only overwrite when the new value is set). */
export function upsertCatalog(db: Database, rows: CatalogRow[]): void {
  ensureSearchSchema(db);
  const get = db.query("SELECT * FROM app_catalog WHERE appid = ?");
  const put = db.query(
    `INSERT OR REPLACE INTO app_catalog(appid, name, aliases, type, release, developer, publisher, tags, price, image, sources, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const ftsDel = db.query("DELETE FROM app_fts WHERE appid = ?");
  const ftsIns = db.query(
    "INSERT INTO app_fts(appid, name, aliases, developer, publisher, tags, type) VALUES (?,?,?,?,?,?,?)",
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const r of rows) {
      if (!r.name) continue;
      const old = get.get(r.appid) as Record<string, string | null> | null;
      const pick = <T>(
        v: T | null | undefined,
        k: string,
      ): T | string | null =>
        v === undefined || v === null || v === "" ? (old?.[k] ?? null) : v;
      const tags = r.tags?.length
        ? JSON.stringify(r.tags)
        : (old?.tags ?? null);
      const sources = [
        ...new Set([
          ...(old?.sources ? JSON.parse(old.sources) : []),
          r.source,
        ]),
      ];
      const row = [
        r.appid,
        r.name,
        pick(r.aliases, "aliases"),
        pick(r.type, "type"),
        pick(r.release, "release"),
        pick(r.developer, "developer"),
        pick(r.publisher, "publisher"),
        tags,
        r.price ? JSON.stringify(r.price) : (old?.price ?? null),
        pick(r.image, "image"),
        JSON.stringify(sources),
        now,
      ] as const;
      put.run(...row);
      ftsDel.run(r.appid);
      ftsIns.run(
        r.appid,
        r.name,
        row[2],
        row[5],
        row[6],
        tags ? (JSON.parse(tags) as string[]).join(" ") : null,
        row[3],
      );
    }
  })();
}

const tableExists = (db: Database, name: string): boolean =>
  !!db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);

/** Rebuilds the catalog from the local PICS index (`app_info`) and store `appdetails` (`store_app`). */
export function rebuildCatalog(db: Database): number {
  ensureSearchSchema(db);
  const rows: CatalogRow[] = [];
  if (tableExists(db, "app_info"))
    for (const a of db
      .query(
        "SELECT appid, name, type, developer, publisher, steam_release_date, kv_json FROM app_info WHERE name IS NOT NULL",
      )
      .all() as {
      appid: number;
      name: string;
      type: string | null;
      developer: string | null;
      publisher: string | null;
      steam_release_date: number | null;
      kv_json: string | null;
    }[]) {
      let aliases: string | null = null;
      try {
        const kv = a.kv_json ? JSON.parse(a.kv_json) : null;
        aliases =
          kvStr(kvObj(kv, "appinfo", "common"), "aliases") ??
          kvStr(kvObj(kv, "common"), "aliases");
      } catch {
        /* kv_json absent */
      }
      rows.push({
        appid: a.appid,
        name: a.name,
        aliases,
        type: a.type,
        developer: a.developer,
        publisher: a.publisher,
        release: a.steam_release_date
          ? new Date(a.steam_release_date * 1000).toISOString().slice(0, 10)
          : null,
        source: "pics",
      });
    }
  if (tableExists(db, "store_app"))
    for (const s of db
      .query(
        "SELECT appid, name, type, developers, publishers, release_date, genres, categories, price_initial, price_final, currency FROM store_app WHERE success = 1",
      )
      .all() as Record<string, string | number | null>[]) {
      const list = (v: unknown) =>
        typeof v === "string" ? (JSON.parse(v) as string[]) : [];
      rows.push({
        appid: Number(s.appid),
        name: String(s.name ?? ""),
        type: (s.type as string) ?? null,
        developer: list(s.developers).join(", ") || null,
        publisher: list(s.publishers).join(", ") || null,
        release: (s.release_date as string) ?? null,
        tags: [...list(s.genres), ...list(s.categories)],
        price: s.currency
          ? {
              currency: String(s.currency),
              initial: Number(s.price_initial),
              final: Number(s.price_final),
            }
          : null,
        source: "store",
      });
    }
  upsertCatalog(db, rows);
  return (
    db.query("SELECT COUNT(*) AS n FROM app_catalog").get() as { n: number }
  ).n;
}

/** Records the games installed on this machine (`local`) or listed by `manifests` of a remote host. */
export function recordInstalled(
  db: Database,
  host: string,
  games: { appid: number; name: string; library: string }[],
): number {
  ensureSearchSchema(db);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.query("DELETE FROM installed_app WHERE host = ?").run(host);
    const ins = db.query(
      "INSERT OR REPLACE INTO installed_app(host, appid, name, library, updated_at) VALUES (?,?,?,?,?)",
    );
    for (const g of games) ins.run(host, g.appid, g.name, g.library, now);
  })();
  upsertCatalog(
    db,
    games.map((g) => ({
      appid: g.appid,
      name: g.name,
      source: `installed:${host}`,
    })),
  );
  return games.length;
}

export function recordLocalInstalled(
  db: Database,
  steamRoot = resolveSteamRoot(),
): number {
  return recordInstalled(
    db,
    "local",
    installedGames(steamRoot).map((g) => ({
      appid: g.appId,
      name: g.name,
      library: g.library,
    })),
  );
}

/**
 * Reads the app manifests of an SSH host (read-only `cat` of `appmanifest_*.acf` in every library of
 * `<root>/config/libraryfolders.vdf`) and records them under `host`.
 */
export async function recordRemoteInstalled(
  db: Database,
  host: string,
  root = "~/.steam/steam",
): Promise<number> {
  const script = `for d in $(grep -o '"path"[[:space:]]*"[^"]*"' ${root}/config/libraryfolders.vdf | cut -d'"' -f4); do for f in "$d"/steamapps/appmanifest_*.acf; do [ -f "$f" ] && { echo "//LIB $d"; cat "$f"; }; done; done`;
  const proc = Bun.spawn(
    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, script],
    { stdout: "pipe", stderr: "ignore" },
  );
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const games: { appid: number; name: string; library: string }[] = [];
  for (const part of text.split("//LIB ").slice(1)) {
    const nl = part.indexOf("\n");
    const library = part.slice(0, nl).trim();
    const st = kvObj(parseTextKv(part.slice(nl + 1)), "AppState");
    const appid = Number(kvStr(st, "appid"));
    if (appid)
      games.push({ appid, name: kvStr(st, "name") ?? String(appid), library });
  }
  return recordInstalled(db, host, games);
}

/** `"tok"*` prefix terms joined by AND; quotes are stripped so user text cannot break the query. */
const ftsQuery = (term: string): string =>
  term
    .replace(/["*^():]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" AND ");

let lastStoreHit = 0;

/** Live keyless store search (`api/storesearch`), one request at most every 300 ms. */
export async function storeSearch(
  term: string,
  cc = "FR",
  lang = "english",
): Promise<CatalogRow[]> {
  const wait = lastStoreHit + 300 - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  lastStoreHit = Date.now();
  const res = await fetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=${encodeURIComponent(lang)}&cc=${encodeURIComponent(cc)}`,
    {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) return [];
  const j = (await res.json()) as {
    items?: {
      id: number;
      name: string;
      type: string;
      price?: { currency: string; initial: number; final: number };
      tiny_image?: string;
    }[];
  };
  return (j.items ?? []).map((i) => ({
    appid: i.id,
    name: i.name,
    // The store reports "app" for every title; keep the PICS type (Game, DLC, ...) when known.
    type: i.type === "app" ? null : i.type,
    price: i.price ?? null,
    image: i.tiny_image ?? null,
    source: "store-search",
  }));
}

/**
 * Searches apps: exact app id or exact name first, then name prefix, then FTS5 rank, then live
 * store results; installed apps are flagged and slightly boosted. Live results are cached into the
 * local index so later searches find them offline.
 */
export async function searchApps(
  db: Database,
  term: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  ensureSearchSchema(db);
  const q = term.trim();
  if (!q) return [];
  const limit = opts.limit ?? 20;
  const live =
    opts.live !== false
      ? storeSearch(q, opts.cc, opts.lang).catch(() => [])
      : Promise.resolve([] as CatalogRow[]);
  const hits = new Map<number, SearchHit>();
  const installed = new Map<number, string[]>();
  for (const r of db.query("SELECT appid, host FROM installed_app").all() as {
    appid: number;
    host: string;
  }[])
    installed.set(r.appid, [...(installed.get(r.appid) ?? []), r.host]);
  const lower = q.toLowerCase();
  const score = (appid: number, name: string, base: number) =>
    (String(appid) === q ? 1000 : 0) +
    (name.toLowerCase() === lower
      ? 900
      : name.toLowerCase().startsWith(lower)
        ? 400
        : 0) +
    base +
    (installed.has(appid) ? 25 : 0);
  const toHit = (
    r: Record<string, unknown>,
    source: string,
    base: number,
  ): SearchHit => ({
    appid: Number(r.appid),
    name: String(r.name),
    type: (r.type as string) ?? null,
    release: (r.release as string) ?? null,
    developer: (r.developer as string) ?? null,
    publisher: (r.publisher as string) ?? null,
    tags: typeof r.tags === "string" ? JSON.parse(r.tags) : [],
    price:
      typeof r.price === "string"
        ? JSON.parse(r.price)
        : ((r.price as SearchHit["price"]) ?? null),
    image: (r.image as string) ?? null,
    installed: installed.get(Number(r.appid)) ?? [],
    sources: [source],
    score: score(Number(r.appid), String(r.name), base),
  });
  if (/^\d+$/.test(q)) {
    const row = db
      .query("SELECT * FROM app_catalog WHERE appid = ?")
      .get(Number(q)) as Record<string, unknown> | null;
    if (row) hits.set(row.appid as number, toHit(row, "fts", 0));
  }
  const fts = ftsQuery(q);
  if (fts)
    for (const [i, r] of (
      db
        .query(
          "SELECT c.*, bm25(app_fts, 0, 10, 5, 1, 1, 1, 0.5) AS rank FROM app_fts f JOIN app_catalog c ON c.appid = f.appid WHERE app_fts MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(fts, limit * 2) as Record<string, unknown>[]
    ).entries())
      if (!hits.has(r.appid as number))
        hits.set(r.appid as number, toHit(r, "fts", 300 - i));
  const liveRows = await live;
  if (liveRows.length) upsertCatalog(db, liveRows);
  for (const [i, r] of liveRows.entries()) {
    const seen = hits.get(r.appid);
    if (seen) {
      seen.sources.push("store");
      seen.price ??= r.price ?? null;
      seen.image ??= r.image ?? null;
      seen.score += 50;
    } else
      hits.set(
        r.appid,
        toHit(r as unknown as Record<string, unknown>, "store", 200 - i),
      );
  }
  return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
