// SPDX-License-Identifier: Apache-2.0
/**
 * Steam API and product index built from public sources only (the same sources SteamDB itself
 * publishes or relies on; steamdb.info is never crawled):
 *
 * - Steam Web API `ISteamWebAPIUtil/GetSupportedAPIList` without a key (public methods);
 * - SteamTracking/SteamTracking `API/*.json` (Web API dumps, every interface/method/parameter);
 * - SteamTracking/Protobufs `steam/*.proto` (unified service RPCs behind the Web API and CM);
 * - the CM directory and the content server directory;
 * - store `api/appdetails` / `api/packagedetails` for apps and packages known locally;
 * - PICS app/package info from the local client cache (`appinfo.vdf`, `packageinfo.vdf`).
 *
 * Every item gets a content hash; each sync records added/changed/removed items (`api diff`).
 * HTTP sources are fetched with `If-None-Match` / `If-Modified-Since`, a per-host delay and a
 * User-Agent naming Bun OS. A Web API key is never used here.
 */
import type { Database } from "bun:sqlite";
import { contentServers, cmServers } from "./audit.js";
import { clientConfigPath, readVdf } from "./config.js";
import { resolveSteamRoot } from "./paths.js";
import { readAppInfo, readPackageInfo } from "./scan.js";
import { kvObj, kvStr } from "./vdf.js";
import { syncApiCatalog, syncStoreApps } from "./webapi.js";

export const USER_AGENT = "BunOS-bun-steam/1.4.4 (+https://aphrody.app; Steam index from public sources)";

/** Public sources with their licenses (recorded in `api_source`). */
export const API_SOURCES = {
  xpaw: {
    url: "https://github.com/xPaw/SteamWebAPIDocumentation",
    license: "MIT",
  },
  webapi: {
    url: "https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/",
    license: "Valve Steam Web API Terms of Use",
  },
  tracking: {
    url: "https://github.com/SteamTracking/SteamTracking",
    license: "no license file (public repository; facts only, files not redistributed)",
  },
  protobufs: {
    url: "https://github.com/SteamTracking/Protobufs",
    license: "Unlicense",
  },
  gametracking: {
    url: "https://github.com/SteamTracking/GameTracking",
    license: "no license file (recorded, not indexed)",
  },
  directory: {
    url: "https://api.steampowered.com/ISteamDirectory/GetCMListForConnect/v1/",
    license: "Valve Steam Web API Terms of Use",
  },
  store: {
    url: "https://store.steampowered.com/api/",
    license: "Steam Subscriber Agreement / store API terms",
  },
  pics: {
    url: "local appcache/appinfo.vdf, packageinfo.vdf",
    license: "local client cache",
  },
} as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_source (url TEXT PRIMARY KEY, kind TEXT NOT NULL, license TEXT, etag TEXT,
  last_modified TEXT, fetched_at TEXT, status INTEGER, items INTEGER);
CREATE TABLE IF NOT EXISTS api_sync (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS api_item (key TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
  version INTEGER, httpmethod TEXT, auth TEXT, params TEXT, description TEXT, data TEXT, hash TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, removed INTEGER, license TEXT);
CREATE INDEX IF NOT EXISTS api_item_name ON api_item(name);
CREATE TABLE IF NOT EXISTS api_change (sync_id INTEGER NOT NULL, key TEXT NOT NULL, change TEXT NOT NULL,
  old_hash TEXT, new_hash TEXT, PRIMARY KEY(sync_id, key));
`;

/** Creates the index tables and adds columns introduced after the first release. */
function ensureSchema(db: Database): void {
  db.run(SCHEMA);
  const cols = (db.query("PRAGMA table_info(api_item)").all() as { name: string }[]).map(c => c.name);
  if (!cols.includes("license")) db.run("ALTER TABLE api_item ADD COLUMN license TEXT");
}

const licenseOf = (source: string): string | null =>
  (API_SOURCES as Record<string, { license: string }>)[source]?.license ?? null;

const lastHit = new Map<string, number>();
const DELAY: Record<string, number> = {
  "api.github.com": 1000,
  "raw.githubusercontent.com": 150,
  "store.steampowered.com": 1500,
  "api.steampowered.com": 500,
};

interface Fetched {
  status: number;
  text: string | null;
  etag: string | null;
  lastModified: string | null;
}

/** GET with a per-host delay, Bun OS User-Agent, conditional headers and 429/5xx backoff. */
async function politeGet(url: string, prev?: { etag?: string | null; lastModified?: string | null }): Promise<Fetched> {
  const host = new URL(url).host;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + (DELAY[host] ?? 500) - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    lastHit.set(host, Date.now());
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "application/json, text/plain, */*",
    };
    if (prev?.etag) headers["if-none-match"] = prev.etag;
    if (prev?.lastModified) headers["if-modified-since"] = prev.lastModified;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await Bun.sleep(2000 * 2 ** attempt);
      continue;
    }
    return {
      status: res.status,
      text: res.status === 304 ? null : await res.text(),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  }
  throw new Error(`rate limited: ${url}`);
}

const hash = (v: unknown): string => new Bun.CryptoHasher("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);

interface Item {
  key: string;
  source: string;
  kind: string;
  name: string;
  version?: number | null;
  httpmethod?: string | null;
  auth?: string | null;
  params?: unknown;
  description?: string | null;
  data?: unknown;
}

class Sync {
  readonly id: number;
  readonly counts: Record<string, number> = {};
  readonly fresh = new Set<string>();
  private readonly seen = new Set<string>();
  constructor(readonly db: Database) {
    ensureSchema(db);
    for (const [source, { license }] of Object.entries(API_SOURCES))
      db.query("UPDATE api_item SET license = ? WHERE source = ? AND license IS NULL").run(license, source);
    this.id = (
      db.query("INSERT INTO api_sync(started_at) VALUES (?) RETURNING id").get(new Date().toISOString()) as {
        id: number;
      }
    ).id;
  }

  source(url: string): { etag: string | null; lastModified: string | null } {
    return (
      (this.db.query("SELECT etag, last_modified AS lastModified FROM api_source WHERE url = ?").get(url) as {
        etag: string | null;
        lastModified: string | null;
      } | null) ?? { etag: null, lastModified: null }
    );
  }

  record(
    url: string,
    kind: string,
    license: string,
    f: Pick<Fetched, "status" | "etag" | "lastModified">,
    items: number | null,
  ): void {
    this.db
      .query(
        `INSERT INTO api_source(url, kind, license, etag, last_modified, fetched_at, status, items) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(url) DO UPDATE SET license=excluded.license, etag=COALESCE(excluded.etag, etag),
         last_modified=COALESCE(excluded.last_modified, last_modified), fetched_at=excluded.fetched_at, status=excluded.status,
         items=COALESCE(excluded.items, items)`,
      )
      .run(url, kind, license, f.etag, f.lastModified, new Date().toISOString(), f.status, items);
  }

  /** Upserts items of one source; `complete` marks the source fully listed (absent items are removed). */
  put(source: string, items: Item[]): void {
    const get = this.db.query("SELECT hash, removed, last_seen FROM api_item WHERE key = ?");
    const ins = this.db.query(
      `INSERT INTO api_item(key, source, kind, name, version, httpmethod, auth, params, description, data, hash, first_seen, last_seen, removed, license)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)
       ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, name=excluded.name, version=excluded.version, httpmethod=excluded.httpmethod,
       auth=excluded.auth, params=excluded.params, description=excluded.description, data=excluded.data, hash=excluded.hash,
       last_seen=excluded.last_seen, removed=NULL, license=excluded.license`,
    );
    const change = this.db.query(
      "INSERT OR REPLACE INTO api_change(sync_id, key, change, old_hash, new_hash) VALUES (?,?,?,?,?)",
    );
    this.db.transaction(() => {
      // The same key can appear twice in one source (a depot shared by several apps): last wins.
      const unique = [...new Map(items.map(i => [i.key, i])).values()];
      for (const it of unique) {
        const h = hash([it.kind, it.name, it.version, it.httpmethod, it.auth, it.params, it.description, it.data]);
        const old = get.get(it.key) as {
          hash: string;
          removed: number | null;
          last_seen: number;
        } | null;
        if (!old || old.removed) change.run(this.id, it.key, "added", old?.hash ?? null, h);
        else if (old.hash !== h && old.last_seen !== this.id) change.run(this.id, it.key, "changed", old.hash, h);
        ins.run(
          it.key,
          source,
          it.kind,
          it.name,
          it.version ?? null,
          it.httpmethod ?? null,
          it.auth ?? null,
          it.params === undefined ? null : JSON.stringify(it.params),
          it.description ?? null,
          it.data === undefined ? null : JSON.stringify(it.data),
          h,
          this.id,
          this.id,
          licenseOf(source),
        );
        this.seen.add(it.key);
      }
    })();
    this.counts[source] = (this.counts[source] ?? 0) + items.length;
  }

  /** After re-reading one file, items under `prefix` that the file no longer lists are removed. */
  removeMissing(prefix: string, keys: Set<string>): void {
    const rows = this.db
      .query("SELECT key, hash FROM api_item WHERE substr(key, 1, ?1) = ?2 AND removed IS NULL")
      .all(prefix.length, prefix) as { key: string; hash: string }[];
    const mark = this.db.query("UPDATE api_item SET removed = ? WHERE key = ?");
    const change = this.db.query(
      "INSERT OR REPLACE INTO api_change(sync_id, key, change, old_hash, new_hash) VALUES (?,?,'removed',?,NULL)",
    );
    for (const r of rows)
      if (!keys.has(r.key)) {
        mark.run(this.id, r.key);
        change.run(this.id, r.key, r.hash);
      }
  }

  /** Marks items of fully listed sources that were not seen in this sync as removed. */
  finish(completeSources: string[]): Record<string, number> {
    const rm = this.db.query("SELECT key, hash FROM api_item WHERE source = ? AND removed IS NULL AND last_seen < ?");
    const mark = this.db.query("UPDATE api_item SET removed = ? WHERE key = ?");
    const change = this.db.query(
      "INSERT OR REPLACE INTO api_change(sync_id, key, change, old_hash, new_hash) VALUES (?,?,'removed',?,NULL)",
    );
    this.db.transaction(() => {
      for (const s of completeSources)
        for (const r of rm.all(s, this.id) as { key: string; hash: string }[]) {
          mark.run(this.id, r.key);
          change.run(this.id, r.key, r.hash);
        }
    })();
    const changes = Object.fromEntries(
      (
        this.db
          .query("SELECT change, COUNT(*) AS n FROM api_change WHERE sync_id = ? GROUP BY change")
          .all(this.id) as {
          change: string;
          n: number;
        }[]
      ).map(r => [r.change, r.n]),
    );
    const summary = { sync: this.id, items: this.counts, changes };
    this.db
      .query("UPDATE api_sync SET finished_at = ?, summary = ? WHERE id = ?")
      .run(new Date().toISOString(), JSON.stringify(summary), this.id);
    return changes;
  }
}

/** One method of a Web API dump (GetSupportedAPIList or SteamTracking `API/*.json`). */
interface ApiMethod {
  name: string;
  version: number;
  httpmethod?: string;
  description?: string;
  parameters?: {
    name: string;
    type?: string;
    optional?: boolean;
    description?: string;
  }[];
}

const webApiItems = (source: string, iface: string, methods: ApiMethod[]): Item[] =>
  methods.map(m => ({
    key: `${source}|${iface}/${m.name}/v${m.version}`,
    source,
    kind: "webapi",
    name: `${iface}/${m.name}`,
    version: m.version,
    httpmethod: m.httpmethod ?? "GET",
    auth: (m.parameters ?? []).some(p => p.name === "key" && !p.optional)
      ? "key"
      : (m.parameters ?? []).some(p => p.name === "access_token")
        ? "access_token"
        : "none",
    params: (m.parameters ?? []).map(p => ({
      name: p.name,
      type: p.type ?? null,
      optional: !!p.optional,
      description: p.description ?? null,
    })),
    description: m.description ?? null,
  }));

const XPAW_RAW = "https://raw.githubusercontent.com/xPaw/SteamWebAPIDocumentation/master";

/**
 * xPaw/SteamWebAPIDocumentation (MIT): `api.json` maps every known interface to methods with
 * version, HTTP verb and typed parameters; `api_undocumented_methods.txt` flags undocumented ones.
 * Fetched with the raw file ETag, so an unchanged map costs one 304.
 */
async function syncXpaw(sync: Sync): Promise<{
  status: number;
  interfaces?: number;
  methods?: number;
  public?: number;
  undocumented?: number;
}> {
  const url = `${XPAW_RAW}/api.json`;
  const f = await politeGet(url, sync.source(url));
  sync.record(url, "xpaw", API_SOURCES.xpaw.license, f, null);
  if (f.status === 304 || f.text === null) return { status: f.status };
  const undocUrl = `${XPAW_RAW}/api_undocumented_methods.txt`;
  const u = await politeGet(undocUrl);
  const undocumented = new Set(
    (u.text ?? "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean),
  );
  sync.record(undocUrl, "xpaw", API_SOURCES.xpaw.license, u, undocumented.size);
  const map = JSON.parse(f.text) as Record<string, Record<string, ApiMethod & { _type?: string }>>;
  const items: Item[] = [];
  for (const [iface, methods] of Object.entries(map)) {
    const list = Object.entries(methods).map(([name, m]) => ({ ...m, name }));
    for (const [i, it] of webApiItems("xpaw", iface, list).entries()) {
      const m = list[i]!;
      it.data = {
        type: m._type ?? null,
        undocumented: m._type === "undocumented" || undocumented.has(`${iface}/${m.name}`),
        public: it.auth === "none",
      };
      items.push(it);
    }
  }
  sync.put("xpaw", items);
  sync.record(url, "xpaw", API_SOURCES.xpaw.license, f, items.length);
  return {
    status: 200,
    interfaces: Object.keys(map).length,
    methods: items.length,
    public: items.filter(i => i.auth === "none").length,
    undocumented: items.filter(i => (i.data as { undocumented: boolean }).undocumented).length,
  };
}

/** Lists a GitHub directory (contents API, ETag-conditional) and returns `{name, sha, download_url}`. */
async function githubDir(sync: Sync, repo: string, dir: string, license: string) {
  const url = `https://api.github.com/repos/${repo}/contents/${dir}`;
  const f = await politeGet(url, sync.source(url));
  if (f.status === 304) {
    sync.record(url, "github-dir", license, f, null);
    return null;
  }
  if (f.status !== 200 || !f.text) throw new Error(`${url}: HTTP ${f.status}`);
  const list = JSON.parse(f.text) as {
    name: string;
    sha: string;
    download_url: string | null;
    type: string;
  }[];
  sync.record(url, "github-dir", license, f, list.length);
  return list.filter(x => x.type === "file" && x.download_url);
}

/** Fetches changed files of a GitHub directory listing (per-file sha as the ETag). */
async function githubFiles(
  sync: Sync,
  files: { name: string; sha: string; download_url: string | null }[],
  license: string,
  onFile: (name: string, text: string) => void,
): Promise<{ fetched: number; unchanged: number }> {
  let fetched = 0;
  let unchanged = 0;
  for (const file of files) {
    const prev = sync.source(file.download_url!);
    if (prev.etag === `sha:${file.sha}`) {
      unchanged++;
      continue;
    }
    const f = await politeGet(file.download_url!);
    if (f.status !== 200 || f.text === null) continue;
    onFile(file.name, f.text);
    sync.record(file.download_url!, "github-file", license, { ...f, etag: `sha:${file.sha}` }, null);
    fetched++;
  }
  return { fetched, unchanged };
}

/** Service RPCs of a `.proto` file: `service Player { rpc GetOwnedGames (A) returns (B) {...} }`. */
export function protoRpcs(file: string, text: string): Item[] {
  const items: Item[] = [];
  for (const svc of text.matchAll(/service\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const service = svc[1]!;
    for (const rpc of svc[2]!.matchAll(
      /rpc\s+(\w+)\s*\(\s*\.?([\w.]+)\s*\)\s*returns\s*\(\s*\.?([\w.]+)\s*\)\s*(\{[\s\S]*?\}|;)/g,
    )) {
      const desc = rpc[4]!.match(/method_description\)\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
      const iface = `I${service}${service.endsWith("Service") ? "" : "Service"}`;
      items.push({
        key: `protobufs|${file}|${iface}/${rpc[1]}`,
        source: "protobufs",
        kind: "rpc",
        name: `${iface}/${rpc[1]}`,
        params: { request: rpc[2], response: rpc[3], file },
        description: desc,
      });
    }
  }
  return items;
}

export interface ApiSyncOptions {
  steamRoot?: string | undefined;
  /** Store pages fetched per sync (`appdetails` + `packagedetails`), spaced 1.5 s apart. */
  storeLimit?: number | undefined;
  log?: ((m: string) => void) | undefined;
}

/** Incremental sync of every public source into the index; returns counts and the change summary. */
export async function apiSync(db: Database, opts: ApiSyncOptions = {}) {
  const log = opts.log ?? (() => {});
  const sync = new Sync(db);
  const complete: string[] = [];
  const result: Record<string, unknown> = { sync: sync.id };

  log("Steam Web API: GetSupportedAPIList (no key)");
  const catalog = await syncApiCatalog(db);
  const methods = db.query("SELECT interface, name, version, httpmethod, description FROM api_method").all() as {
    interface: string;
    name: string;
    version: number;
    httpmethod: string;
    description: string | null;
  }[];
  const params = db.query(
    "SELECT name, type, optional, description FROM api_param WHERE interface=? AND method=? AND version=?",
  );
  const byIface = new Map<string, ApiMethod[]>();
  for (const m of methods) {
    const list = byIface.get(m.interface) ?? [];
    list.push({
      name: m.name,
      version: m.version,
      httpmethod: m.httpmethod,
      ...(m.description ? { description: m.description } : {}),
      parameters: (
        params.all(m.interface, m.name, m.version) as {
          name: string;
          type: string;
          optional: number;
          description: string | null;
        }[]
      ).map(p => ({
        name: p.name,
        type: p.type,
        optional: !!p.optional,
        ...(p.description ? { description: p.description } : {}),
      })),
    });
    byIface.set(m.interface, list);
  }
  sync.put(
    "webapi",
    [...byIface].flatMap(([i, ms]) => webApiItems("webapi", i, ms)),
  );
  sync.record(
    API_SOURCES.webapi.url,
    "webapi",
    API_SOURCES.webapi.license,
    { status: 200, etag: null, lastModified: null },
    catalog.methods,
  );
  complete.push("webapi");
  result.webapi = catalog;

  log("xPaw SteamWebAPIDocumentation api.json (primary Web API map)");
  result.xpaw = await syncXpaw(sync);
  if ((result.xpaw as { status: number }).status === 200) complete.push("xpaw");

  log("SteamTracking API dumps");
  const dumps = await githubDir(sync, "SteamTracking/SteamTracking", "API", API_SOURCES.tracking.license);
  if (dumps) {
    const t = await githubFiles(
      sync,
      dumps.filter(f => f.name.endsWith(".json")),
      API_SOURCES.tracking.license,
      (name, text) => {
        try {
          const j = JSON.parse(text) as {
            name?: string;
            methods?: ApiMethod[];
          };
          const iface = j.name ?? name.replace(/\.json$/, "");
          const items = webApiItems("tracking", iface, j.methods ?? []);
          sync.put("tracking", items);
          sync.removeMissing(`tracking|${iface}/`, new Set(items.map(i => i.key)));
        } catch {
          /* malformed dump */
        }
      },
    );
    result.tracking = { files: dumps.length, ...t };
  } else result.tracking = { unchanged: true };

  log("SteamTracking Protobufs (steam/)");
  const protos = await githubDir(sync, "SteamTracking/Protobufs", "steam", API_SOURCES.protobufs.license);
  if (protos) {
    const p = await githubFiles(
      sync,
      protos.filter(f => f.name.endsWith(".proto")),
      API_SOURCES.protobufs.license,
      (name, text) => {
        const items = protoRpcs(name, text);
        sync.put("protobufs", items);
        sync.removeMissing(`protobufs|${name}|`, new Set(items.map(i => i.key)));
      },
    );
    result.protobufs = { files: protos.length, ...p };
  } else result.protobufs = { unchanged: true };
  sync.record(
    API_SOURCES.gametracking.url,
    "github-repo",
    API_SOURCES.gametracking.license,
    { status: 0, etag: null, lastModified: null },
    0,
  );

  log("CM and content server directories");
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  const cell =
    Number(
      kvStr(
        kvObj(readVdf(clientConfigPath(steamRoot)), "InstallConfigStore", "Software", "Valve", "Steam"),
        "CellIDServerOverride",
      ) ?? 0,
    ) || 0;
  const [cms, servers] = await Promise.all([
    cmServers(cell, 100).catch(() => []),
    contentServers(cell, 50).catch(() => []),
  ]);
  sync.put("directory", [
    ...cms.map(c => ({
      key: `directory|cm/${c.endpoint}`,
      source: "directory",
      kind: "cm",
      name: c.endpoint,
      auth: "steam",
      data: { type: c.type, dc: c.dc },
    })),
    ...servers.map(s => ({
      key: `directory|content/${s.vhost}`,
      source: "directory",
      kind: "contentserver",
      name: s.vhost,
      auth: "cdn-token",
      data: { type: s.type, cell: s.cellId, https: s.https },
    })),
  ]);
  sync.record(
    API_SOURCES.directory.url,
    "directory",
    API_SOURCES.directory.license,
    { status: 200, etag: null, lastModified: null },
    cms.length + servers.length,
  );
  complete.push("directory");
  result.directory = { cell, cms: cms.length, contentServers: servers.length };

  log("PICS from the local client cache");
  const apps = await readAppInfo(db, steamRoot);
  const packages = await readPackageInfo(db, steamRoot);
  const pics: Item[] = [
    ...(
      db.query("SELECT appid, name, type, change_number FROM app_info").all() as {
        appid: number;
        name: string | null;
        type: string | null;
        change_number: number;
      }[]
    ).map(a => ({
      key: `pics|app/${a.appid}`,
      source: "pics",
      kind: "app",
      name: a.name ?? String(a.appid),
      version: a.change_number,
      data: { appid: a.appid, type: a.type },
    })),
    ...(
      db.query("SELECT appid, branch, buildid, timeupdated FROM app_info_branch").all() as {
        appid: number;
        branch: string;
        buildid: number;
        timeupdated: number;
      }[]
    ).map(b => ({
      key: `pics|build/${b.appid}/${b.branch}`,
      source: "pics",
      kind: "build",
      name: `${b.appid}/${b.branch}`,
      version: b.buildid,
      data: { timeupdated: b.timeupdated },
    })),
    ...(
      db.query("SELECT appid, depotid, name, public_gid FROM app_info_depot").all() as {
        appid: number;
        depotid: number;
        name: string | null;
        public_gid: string | null;
      }[]
    ).map(d => ({
      key: `pics|depot/${d.depotid}`,
      source: "pics",
      kind: "depot",
      name: d.name ?? String(d.depotid),
      data: { appid: d.appid, manifest: d.public_gid },
    })),
    ...(
      db.query("SELECT packageid, change_number, app_count, depot_count FROM package").all() as {
        packageid: number;
        change_number: number;
        app_count: number;
        depot_count: number;
      }[]
    ).map(p => ({
      key: `pics|package/${p.packageid}`,
      source: "pics",
      kind: "package",
      name: String(p.packageid),
      version: p.change_number,
      data: { apps: p.app_count, depots: p.depot_count },
    })),
  ];
  sync.put("pics", pics);
  complete.push("pics");
  result.pics = { apps, packages, items: pics.length };

  const limit = opts.storeLimit ?? 10;
  if (limit > 0) {
    log(`store appdetails / packagedetails (up to ${limit})`);
    const appIds = (
      db
        .query(
          "SELECT appid FROM app_info WHERE type IN ('Game','game','DLC','dlc','Application','application') AND appid NOT IN (SELECT appid FROM store_app WHERE fetched_at > datetime('now','-7 days')) ORDER BY change_number DESC LIMIT ?",
        )
        .all(limit) as { appid: number }[]
    ).map(r => r.appid);
    const ok = await syncStoreApps(db, appIds);
    sync.put(
      "store",
      (
        db
          .query(
            `SELECT appid, name, type, price_final, currency, release_date FROM store_app WHERE success = 1 AND appid IN (${appIds.map(() => "?").join(",") || "NULL"})`,
          )
          .all(...appIds) as {
          appid: number;
          name: string;
          type: string;
          price_final: number | null;
          currency: string | null;
          release_date: string | null;
        }[]
      ).map(a => ({
        key: `store|app/${a.appid}`,
        source: "store",
        kind: "store-app",
        name: a.name,
        data: {
          type: a.type,
          price: a.price_final,
          currency: a.currency,
          release: a.release_date,
        },
      })),
    );
    const pkgIds = (
      db
        .query("SELECT packageid FROM package WHERE packageid > 0 ORDER BY change_number DESC LIMIT ?")
        .all(Math.max(1, Math.floor(limit / 2))) as { packageid: number }[]
    ).map(r => r.packageid);
    const pkgItems: Item[] = [];
    for (const id of pkgIds) {
      const f = await politeGet(`https://store.steampowered.com/api/packagedetails?packageids=${id}`);
      const d = f.text
        ? (JSON.parse(f.text) as Record<string, { success: boolean; data?: Record<string, unknown> }>)[String(id)]
        : undefined;
      if (d?.success && d.data)
        pkgItems.push({
          key: `store|package/${id}`,
          source: "store",
          kind: "store-package",
          name: String(d.data.name ?? id),
          data: { apps: d.data.apps, price: d.data.price },
        });
    }
    sync.put("store", pkgItems);
    sync.record(
      API_SOURCES.store.url,
      "store",
      API_SOURCES.store.license,
      { status: 200, etag: null, lastModified: null },
      ok + pkgItems.length,
    );
    result.store = {
      apps: appIds.length,
      appsOk: ok,
      packages: pkgIds.length,
      packagesOk: pkgItems.length,
    };
  }

  result.changes = sync.finish(complete);
  result.totals = db
    .query(
      "SELECT source, kind, COUNT(*) AS n FROM api_item WHERE removed IS NULL GROUP BY source, kind ORDER BY source, kind",
    )
    .all();
  return result;
}

/** Full-text-ish search over names, descriptions and parameter names. */
export function apiSearch(db: Database, term: string, limit = 50) {
  ensureSchema(db);
  const like = `%${term}%`;
  return db
    .query(
      "SELECT key, source, kind, name, version, httpmethod, auth, description FROM api_item WHERE removed IS NULL AND (name LIKE ?1 OR description LIKE ?1 OR params LIKE ?1) ORDER BY kind, name LIMIT ?2",
    )
    .all(like, limit);
}

/** Every indexed variant of a name (`IPlayerService/GetOwnedGames`) or an exact key, with parameters. */
export function apiShow(db: Database, name: string) {
  ensureSchema(db);
  return (
    db
      .query("SELECT * FROM api_item WHERE key = ?1 OR name = ?1 OR name LIKE ?2 ORDER BY source")
      .all(name, `%/${name}`) as Record<string, unknown>[]
  ).map(r => ({
    ...r,
    params: r.params ? JSON.parse(String(r.params)) : null,
    data: r.data ? JSON.parse(String(r.data)) : null,
  }));
}

/** Changes recorded by a sync (default: the last one), i.e. what moved since the previous sync. */
export function apiDiff(db: Database, syncId?: number) {
  ensureSchema(db);
  const id =
    syncId ??
    (db.query("SELECT MAX(id) AS id FROM api_sync WHERE finished_at IS NOT NULL").get() as { id: number | null }).id;
  if (!id) return { sync: null, changes: [] };
  const meta = db.query("SELECT started_at, finished_at, summary FROM api_sync WHERE id = ?").get(id) as Record<
    string,
    string
  > | null;
  const changes = db
    .query(
      "SELECT c.change, c.key, i.kind, i.name, i.version FROM api_change c LEFT JOIN api_item i ON i.key = c.key WHERE c.sync_id = ? ORDER BY c.change, c.key",
    )
    .all(id);
  return {
    sync: id,
    ...meta,
    summary: meta?.summary ? JSON.parse(meta.summary) : null,
    changes,
  };
}

export const apiSources = (db: Database) => {
  ensureSchema(db);
  return db
    .query(
      "SELECT kind, COUNT(*) AS urls, MAX(fetched_at) AS fetched_at, license FROM api_source GROUP BY kind, license",
    )
    .all();
};

/** One Web API method merged across sources (xPaw first, then GetSupportedAPIList, then SteamTracking). */
export function apiMethod(db: Database, name: string, version?: number) {
  ensureSchema(db);
  const rows = db
    .query(
      "SELECT source, version, httpmethod, auth, params, license FROM api_item WHERE kind = 'webapi' AND removed IS NULL AND name = ? ORDER BY version DESC",
    )
    .all(name) as {
    source: string;
    version: number;
    httpmethod: string;
    auth: string;
    params: string | null;
    license: string | null;
  }[];
  const order = ["xpaw", "webapi", "tracking"];
  rows.sort((a, b) => b.version - a.version || order.indexOf(a.source) - order.indexOf(b.source));
  const pick = rows.find(r => version === undefined || r.version === version);
  if (!pick) return null;
  const same = rows.filter(r => r.version === pick.version);
  return {
    name,
    version: pick.version,
    httpmethod: pick.httpmethod,
    // Callable without a key only when no source requires one.
    public: same.every(r => r.auth === "none"),
    auth: [...new Set(same.map(r => r.auth))],
    sources: same.map(r => ({ source: r.source, license: r.license })),
    params: pick.params
      ? (JSON.parse(pick.params) as {
          name: string;
          type: string | null;
          optional: boolean;
        }[])
      : [],
  };
}

/**
 * Calls a public Web API method (no key, no access token) with Bun fetch, the Bun OS User-Agent
 * and the polite per-host delay. Methods that need a key are refused.
 */
export async function apiCall(db: Database, name: string, args: Record<string, string>, version?: number) {
  const m = apiMethod(db, name, version);
  if (!m) throw new Error(`${name}: not in the index (run bun-steam api sync)`);
  if (!m.public) throw new Error(`${name} v${m.version} needs ${m.auth.join("/")}; only public methods are callable`);
  for (const p of m.params)
    if (!p.optional && !(p.name in args)) throw new Error(`${name}: missing required parameter ${p.name}`);
  const base = `https://api.steampowered.com/${name}/v${m.version}/`;
  const query = new URLSearchParams({ format: "json", ...args });
  const host = "api.steampowered.com";
  const wait = (lastHit.get(host) ?? 0) + (DELAY[host] ?? 500) - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  lastHit.set(host, Date.now());
  const res = await fetch(m.httpmethod === "POST" ? base : `${base}?${query}`, {
    method: m.httpmethod === "POST" ? "POST" : "GET",
    headers: {
      "user-agent": USER_AGENT,
      ...(m.httpmethod === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(m.httpmethod === "POST" ? { body: query.toString() } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { method: name, version: m.version, status: res.status, body };
}
