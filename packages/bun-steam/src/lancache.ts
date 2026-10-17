// SPDX-License-Identifier: Apache-2.0
// Steam LAN cache in Bun: the Steam client sends its depot downloads to `lancache.steamcontent.com`
// over HTTP when that name resolves to a private address. This proxy answers there, serves depot
// chunks from a content-addressed disk cache, fetches misses from Valve's CDN (resolved through
// public DNS, never through the local override) while streaming them to the client, and records
// every transfer in bun:sqlite for the audit. Only Bun-native APIs: Bun.serve, fetch, node:dns
// (c-ares), Bun.file/Bun.write, bun:sqlite.
import { Database } from "bun:sqlite";
import { Resolver } from "node:dns/promises";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface LancacheOptions {
  /** Address to listen on (the redirect target, e.g. 127.0.0.1). */
  hostname: string;
  port: number;
  /** Cache root; chunks live in `<root>/depot/<depot>/<sha1[0..2]>/<sha1>`. */
  root: string;
  /** Public resolvers for upstream names (the local hosts file points at this proxy). */
  resolvers: string[];
  /** Upstream when the client addresses the cache name itself. */
  upstreamHost: string;
}

const CHUNK = /^\/depot\/(\d+)\/chunk\/([0-9a-f]{40})$/;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer",
]);

export function openLancacheDb(root: string): Database {
  const db = new Database(join(root, "lancache.db"), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS transfer (
    ts INTEGER NOT NULL, depot INTEGER, chunk TEXT, path TEXT NOT NULL, host TEXT NOT NULL,
    upstream TEXT, status INTEGER NOT NULL, bytes INTEGER NOT NULL, hit INTEGER NOT NULL,
    ms REAL NOT NULL, client TEXT)`);
  db.run("CREATE INDEX IF NOT EXISTS transfer_depot ON transfer(depot)");
  return db;
}

/** Upstream addresses of a CDN name from public DNS, cached for the record TTL. */
class UpstreamResolver {
  #resolver = new Resolver();
  #cache = new Map<
    string,
    { addresses: string[]; until: number; next: number }
  >();
  constructor(servers: string[]) {
    this.#resolver.setServers(servers);
  }
  async pick(host: string): Promise<string> {
    const now = Date.now();
    let entry = this.#cache.get(host);
    if (!entry || entry.until < now) {
      const records = await this.#resolver.resolve4(host, { ttl: true });
      if (records.length === 0) throw new Error(`no A record for ${host}`);
      const ttl = Math.max(30, Math.min(...records.map((r) => r.ttl)));
      entry = {
        addresses: records.map((r) => r.address),
        until: now + ttl * 1000,
        next: 0,
      };
      this.#cache.set(host, entry);
    }
    // Round-robin across the CDN addresses spreads parallel chunk fetches.
    return entry.addresses[entry.next++ % entry.addresses.length]!;
  }
}

export function serveLancache(options: LancacheOptions) {
  const db = openLancacheDb(options.root);
  const insert = db.prepare(
    "INSERT INTO transfer (ts, depot, chunk, path, host, upstream, status, bytes, hit, ms, client) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const upstream = new UpstreamResolver(options.resolvers);
  const inflight = new Map<string, Promise<void>>();

  const chunkPath = (depot: string, sha: string) =>
    join(options.root, "depot", depot, sha.slice(0, 2), sha);

  async function fetchUpstream(host: string, path: string, headers: Headers) {
    const target =
      host === "lancache.steamcontent.com" ? options.upstreamHost : host;
    const address = await upstream.pick(target);
    const forward = new Headers();
    for (const [key, value] of headers)
      if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "host")
        forward.set(key, value);
    forward.set("host", target);
    const response = await fetch(`http://${address}${path}`, {
      headers: forward,
      redirect: "manual",
      decompress: false,
    });
    return { response, address };
  }

  /** Fetch one chunk into the cache once, even if several clients ask for it concurrently. */
  function fill(
    key: string,
    file: string,
    host: string,
    path: string,
    headers: Headers,
  ) {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const { response, address } = await fetchUpstream(host, path, headers);
        if (response.status !== 200)
          throw Object.assign(new Error(`upstream ${response.status}`), {
            response,
            address,
          });
        const bytes = new Uint8Array(await response.arrayBuffer());
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.part`;
        await Bun.write(temporary, bytes);
        await rename(temporary, file);
        lastUpstream.set(key, address);
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    return job;
  }
  const lastUpstream = new Map<string, string>();

  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: 120,
    routes: {
      "/_lancache/audit": () => Response.json(audit(db, options.root)),
    },
    async fetch(request, server) {
      const started = performance.now();
      const url = new URL(request.url);
      const host = (request.headers.get("host") ?? options.upstreamHost).split(
        ":",
      )[0]!;
      const client = server.requestIP(request)?.address ?? null;
      const match = CHUNK.exec(url.pathname);
      if (request.method === "GET" && match) {
        const [, depot, sha] = match as unknown as [string, string, string];
        const file = chunkPath(depot, sha);
        let hit = 1;
        if (!(await Bun.file(file).exists())) {
          hit = 0;
          try {
            await fill(
              `${depot}/${sha}`,
              file,
              host,
              url.pathname,
              request.headers,
            );
          } catch (error) {
            const failed = (error as { response?: Response }).response;
            insert.run(
              Date.now(),
              +depot,
              sha,
              url.pathname,
              host,
              null,
              failed?.status ?? 502,
              0,
              0,
              performance.now() - started,
              client,
            );
            return failed ?? new Response(String(error), { status: 502 });
          }
        }
        const body = Bun.file(file);
        insert.run(
          Date.now(),
          +depot,
          sha,
          url.pathname,
          host,
          hit ? null : (lastUpstream.get(`${depot}/${sha}`) ?? null),
          200,
          body.size,
          hit,
          performance.now() - started,
          client,
        );
        return new Response(body, {
          headers: {
            "content-type": "application/x-steam-chunk",
            "x-lancache": hit ? "HIT" : "MISS",
          },
        });
      }
      // Manifests, request codes and everything else pass through unmodified.
      try {
        const { response, address } = await fetchUpstream(
          host,
          url.pathname + url.search,
          request.headers,
        );
        const headers = new Headers();
        for (const [key, value] of response.headers)
          if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
        headers.set("x-lancache", "PASS");
        const length = Number(response.headers.get("content-length") ?? 0);
        insert.run(
          Date.now(),
          null,
          null,
          url.pathname,
          host,
          address,
          response.status,
          length,
          0,
          performance.now() - started,
          client,
        );
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch (error) {
        insert.run(
          Date.now(),
          null,
          null,
          url.pathname,
          host,
          null,
          502,
          0,
          0,
          performance.now() - started,
          client,
        );
        return new Response(String(error), { status: 502 });
      }
    },
  });
  return { server, db };
}

export interface LancacheAudit {
  generatedAt: string;
  root: string;
  totals: {
    requests: number;
    bytes: number;
    hitBytes: number;
    missBytes: number;
    hitRatio: number;
    errors: number;
  };
  throughput: { missMBps: number | null; hitMBps: number | null };
  depots: {
    depot: number;
    chunks: number;
    bytes: number;
    hits: number;
    misses: number;
  }[];
  upstreams: {
    upstream: string;
    requests: number;
    bytes: number;
    avgMs: number;
    errors: number;
  }[];
  clients: { client: string | null; requests: number; bytes: number }[];
  statuses: { status: number; count: number }[];
}

export function audit(db: Database, root: string): LancacheAudit {
  const one = <T>(sql: string) => db.query(sql).get() as T;
  const all = <T>(sql: string) => db.query(sql).all() as T[];
  const totals = one<{
    requests: number;
    bytes: number;
    hitBytes: number;
    missBytes: number;
    errors: number;
  }>(
    `SELECT count(*) requests, coalesce(sum(bytes),0) bytes,
       coalesce(sum(CASE WHEN hit=1 THEN bytes END),0) hitBytes,
       coalesce(sum(CASE WHEN hit=0 AND chunk IS NOT NULL THEN bytes END),0) missBytes,
       count(CASE WHEN status>=400 THEN 1 END) errors FROM transfer`,
  );
  const rate = (hit: number) =>
    one<{ mbps: number | null }>(
      `SELECT sum(bytes)/1048576.0/(sum(ms)/1000.0) mbps FROM transfer WHERE chunk IS NOT NULL AND status=200 AND hit=${hit} AND ms>0`,
    ).mbps;
  const chunkBytes = totals.hitBytes + totals.missBytes;
  return {
    generatedAt: new Date().toISOString(),
    root,
    totals: {
      ...totals,
      hitRatio: chunkBytes ? totals.hitBytes / chunkBytes : 0,
    },
    // Per-request rates; Steam fetches many chunks in parallel, so the aggregate is higher.
    throughput: { missMBps: rate(0), hitMBps: rate(1) },
    depots: all(
      `SELECT depot, count(DISTINCT chunk) chunks, sum(bytes) bytes, count(CASE WHEN hit=1 THEN 1 END) hits,
         count(CASE WHEN hit=0 THEN 1 END) misses FROM transfer WHERE chunk IS NOT NULL GROUP BY depot ORDER BY bytes DESC`,
    ),
    upstreams: all(
      `SELECT upstream, count(*) requests, sum(bytes) bytes, avg(ms) avgMs, count(CASE WHEN status>=400 THEN 1 END) errors
         FROM transfer WHERE upstream IS NOT NULL GROUP BY upstream ORDER BY bytes DESC`,
    ),
    clients: all(
      `SELECT client, count(*) requests, sum(bytes) bytes FROM transfer GROUP BY client ORDER BY bytes DESC`,
    ),
    statuses: all(
      `SELECT status, count(*) count FROM transfer GROUP BY status ORDER BY count DESC`,
    ),
  };
}

/** Removes cached chunks of one depot (or all) and their rows. */
export async function evict(root: string, depot?: number) {
  const target =
    depot === undefined
      ? join(root, "depot")
      : join(root, "depot", String(depot));
  if (await stat(target).catch(() => null))
    await rm(target, { recursive: true, force: true });
  const db = openLancacheDb(root);
  db.run(
    depot === undefined
      ? "DELETE FROM transfer"
      : `DELETE FROM transfer WHERE depot = ${Number(depot)}`,
  );
  db.close();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1]! : fallback;
  };
  const root = flag("root", "/games/cache/steam-lancache");
  await mkdir(root, { recursive: true });
  if (args[0] === "audit") {
    console.log(JSON.stringify(audit(openLancacheDb(root), root), null, 2));
  } else if (args[0] === "evict") {
    await evict(root, args[1] ? Number(args[1]) : undefined);
  } else {
    const { server } = serveLancache({
      hostname: flag("hostname", "127.0.0.1"),
      port: Number(flag("port", "8099")),
      root,
      resolvers: flag("resolvers", "1.1.1.1,9.9.9.9").split(","),
      upstreamHost: flag("upstream", "lancache.steamcontent.com"),
    });
    console.log(`lancache listening on ${server.url} cache ${root}`);
  }
}
