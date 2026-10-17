// Endpoint/mirror index for bep: seeded from plugins/consoles/mirrors.json, extended with the
// Arch, CachyOS and Libreboot mirror lists, probed concurrently and stored in bun:sqlite so
// downloads try the fastest healthy URL first.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { usrRoot } from "./usr";

interface Service {
  kind: string;
  urls: string[];
  list?: string;
  path?: string;
  paths?: Record<string, string>;
}

export interface Endpoint {
  service: string;
  kind: string;
  url: string;
  origin: string;
  ok: number | null;
  status: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
}

let database: Database | undefined;
function db(): Database {
  if (database) return database;
  const dir = join(usrRoot(), "var", "lib", "bep");
  mkdirSync(dir, { recursive: true });
  database = new Database(join(dir, "index.db"), { create: true, strict: true });
  database.run(
    "CREATE TABLE IF NOT EXISTS endpoints (service TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, origin TEXT NOT NULL, ok INTEGER, status INTEGER, latencyMs INTEGER, checkedAt TEXT, PRIMARY KEY (service, url))",
  );
  return database;
}

async function seed(): Promise<Record<string, Service>> {
  const file = join(import.meta.dir, "..", "plugins", "consoles", "mirrors.json");
  return ((await Bun.file(file).json()) as { services: Record<string, Service> }).services;
}

async function text(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "bep" }, signal: AbortSignal.timeout(20_000) });
  return response.ok ? response.text() : "";
}

/** Mirror URLs published by each service's list endpoint. */
async function discovered(service: string, entry: Service): Promise<string[]> {
  if (!entry.list) return [];
  const body = await text(entry.list).catch(() => "");
  if (service === "archlinux" && body) {
    const json = JSON.parse(body) as { urls: Array<{ url: string; protocol: string; active: boolean }> };
    return json.urls.filter(m => m.protocol === "https" && m.active).map(m => m.url.replace(/\/$/, ""));
  }
  if (service === "cachyos")
    return [...body.matchAll(/^#?\s*Server\s*=\s*(https:\/\/\S+?)\/repo\//gm)].map(m => m[1]!);
  if (service === "libreboot")
    return [...new Set([...body.matchAll(/https:\/\/[A-Za-z0-9.-]+\/[^"<\s]*libreboot\/?/g)].map(m => m[0].replace(/\/$/, "")))].filter(
      url => !url.includes("codeberg.org") && !url.includes("spi-inc.org"),
    );
  return [];
}

/** Rebuilds the index from the seed plus every discovered mirror list. */
export async function indexMirrors(): Promise<Record<string, number>> {
  const services = await seed();
  const insert = db().query(
    "INSERT OR IGNORE INTO endpoints (service, kind, url, origin) VALUES ($service, $kind, $url, $origin)",
  );
  const counts: Record<string, number> = {};
  for (const [service, entry] of Object.entries(services)) {
    const urls = [
      ...entry.urls.map(url => ({ url, origin: "seed" })),
      ...(await discovered(service, entry)).map(url => ({ url, origin: entry.list! })),
    ];
    for (const { url, origin } of urls) insert.run({ service, kind: entry.kind, url, origin });
    counts[service] = urls.length;
  }
  return counts;
}

/** HEAD-probes every indexed endpoint (bounded concurrency) and records status and latency. */
export async function probeMirrors(service?: string, concurrency = 16): Promise<Endpoint[]> {
  const rows = db()
    .query<Endpoint, [string, string]>("SELECT * FROM endpoints WHERE (?1 = '' OR service = ?2)")
    .all(service ?? "", service ?? "");
  const update = db().query(
    "UPDATE endpoints SET ok = $ok, status = $status, latencyMs = $latencyMs, checkedAt = $checkedAt WHERE service = $service AND url = $url",
  );
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const row = rows[next++]!;
      const started = performance.now();
      let status = 0;
      try {
        const response = await fetch(row.url, {
          method: "HEAD",
          redirect: "manual",
          headers: { "user-agent": "bep" },
          signal: AbortSignal.timeout(8_000),
        });
        status = response.status;
      } catch {
        status = 0;
      }
      const ok = status > 0 && status < 500 ? 1 : 0;
      Object.assign(row, { ok, status, latencyMs: Math.round(performance.now() - started), checkedAt: new Date().toISOString() });
      update.run({ ok, status, latencyMs: row.latencyMs, checkedAt: row.checkedAt, service: row.service, url: row.url });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return rows.sort((a, b) => (b.ok ?? 0) - (a.ok ?? 0) || (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));
}

/** Healthy endpoints of a service, fastest first (seed order when never probed). */
export function bestMirrors(service: string): string[] {
  const rows = db()
    .query<Endpoint, [string]>("SELECT * FROM endpoints WHERE service = ? ORDER BY ok DESC, latencyMs IS NULL, latencyMs")
    .all(service);
  return rows.filter(row => row.ok !== 0).map(row => row.url);
}

export function listMirrors(service?: string): Endpoint[] {
  return db()
    .query<Endpoint, [string, string]>("SELECT * FROM endpoints WHERE (?1 = '' OR service = ?2) ORDER BY service, ok DESC, latencyMs")
    .all(service ?? "", service ?? "");
}

/** Fetches `path` from the first healthy mirror of `service` that answers 200. */
export async function fetchFromMirrors(service: string, path: string): Promise<Response> {
  const mirrors = bestMirrors(service);
  const errors: string[] = [];
  for (const base of mirrors.length ? mirrors : (await seed())[service]?.urls ?? []) {
    try {
      const response = await fetch(`${base}${path}`, { headers: { "user-agent": "bep" } });
      if (response.ok) return response;
      errors.push(`${base}: ${response.status}`);
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no ${service} mirror served ${path}: ${errors.join("; ")}`);
}
