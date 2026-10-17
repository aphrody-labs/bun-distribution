// SPDX-License-Identifier: Apache-2.0
/**
 * Network and download audit of a Steam host, on Bun-native APIs only: `fetch` (Steam Web API,
 * HTTP/HTTPS probes), `Bun.dns` (A/AAAA with TTL), `Bun.connect` (TCP and TLS handshakes),
 * `Bun.udpSocket` (resolver round trip), `Bun.file` (library read speed) and `bun:sqlite` (history).
 *
 * The audit is read-only: it never downloads more than the empty `/` object of each content server
 * and a bounded slice of one local game file. Schema: README.md "Audit report".
 */
import type { Database } from "bun:sqlite";
import { getServers } from "node:dns";
import { readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { clientConfigPath, readVdf } from "./config.js";
import { IS_WINDOWS, isDir, norm, resolveSteamRoot, userDataDirs } from "./paths.js";
import { listLibraries } from "./libraries.js";
import { kvObj, kvStr } from "./vdf.js";

export const AUDIT_SCHEMA = "bun-steam.audit/v1";
const API = "https://api.steampowered.com";
const STORE = ["InstallConfigStore", "Software", "Valve", "Steam"];

export interface ContentServer {
  host: string;
  vhost: string;
  type: string;
  /** SteamCache cell; `null` for global CDNs. */
  cellId: number | null;
  /** Cells passed to GetServersForSteamPipe that returned this server (0 = automatic by IP). */
  queriedCells: number[];
  load: number;
  weightedLoad: number;
  https: string;
  group: string | null;
}

export interface CmServer {
  endpoint: string;
  type: string;
  dc: string;
  load: number;
  weightedLoad: number;
}

export interface HttpTiming {
  status: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  bytes: number;
  server: string | null;
  error?: string;
}

export interface HostProbe {
  host: string;
  dns: {
    a: { address: string; ttl: number }[];
    aaaa: { address: string; ttl: number }[];
    ms: number;
  };
  tcp: { v4_80: number | null; v4_443: number | null; v6_443: number | null };
  tls: { handshakeMs: number | null; totalMs: number | null; error?: string };
  http: HttpTiming;
  https: HttpTiming;
}

export interface Finding {
  id: string;
  severity: "info" | "warn" | "critical";
  message: string;
  evidence?: unknown;
}

export interface Recommendation {
  id: string;
  reason: string;
  /** Present when `bun-steam tune --apply` can apply it (Steam config files only). */
  apply?: {
    file: "config.vdf" | "steam_dev.cfg";
    key: string;
    value: string | null;
  };
  /** Manual action for settings outside Steam files (system, network, client UI). */
  manual?: string;
}

export interface AuditReport {
  schema: typeof AUDIT_SCHEMA;
  generatedAt: string;
  durationMs: number;
  host: { name: string; platform: NodeJS.Platform; arch: string; bun: string };
  steamRoot: string;
  cell: {
    override: number | null;
    usedByClient: number | null;
    queried: number[];
  };
  dns: { servers: string[]; resolverRttMs: number | null };
  cms: (CmServer & { tcpMs: number | null })[];
  contentServers: (ContentServer & { probe: HostProbe })[];
  logs: ReturnType<typeof parseLogs>;
  config: {
    steamDevCfg: Record<string, string> | null;
    downloadThrottleKbps: number | null;
    allowDownloadsDuringGameplay: boolean | null;
    recentDownloadRateBytes: number | null;
    shaderCache: Record<string, string> | null;
    remotePlay: Record<string, string> | null;
  };
  disk: {
    library: string;
    freeBytes: number | null;
    totalBytes: number | null;
    sample: string | null;
    sampleBytes: number;
    readMBps: number | null;
  }[];
  linux: Record<string, string | null> | null;
  findings: Finding[];
  recommendations: Recommendation[];
}

const ms = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Content servers for a cell (`IContentServerDirectoryService/GetServersForSteamPipe`). */
export async function contentServers(cellId: number, max = 20): Promise<ContentServer[]> {
  const j = await json<{ response: { servers?: Record<string, unknown>[] } }>(
    `${API}/IContentServerDirectoryService/GetServersForSteamPipe/v1/?cell_id=${cellId}&max_servers=${max}`,
  );
  return (j.response.servers ?? []).map(s => ({
    host: String(s.host),
    vhost: String(s.vhost ?? s.host),
    type: String(s.type),
    cellId: s.cell_id === undefined ? null : Number(s.cell_id),
    queriedCells: [cellId],
    load: Number(s.load),
    weightedLoad: Number(s.weighted_load),
    https: String(s.https_support ?? "unknown"),
    group: typeof s.group === "string" ? s.group : null,
  }));
}

/** Connection managers for a cell (`ISteamDirectory/GetCMListForConnect`). */
export async function cmServers(cellId: number, max = 20): Promise<CmServer[]> {
  const j = await json<{
    response: { serverlist?: Record<string, unknown>[] };
  }>(`${API}/ISteamDirectory/GetCMListForConnect/v1/?cellid=${cellId}&maxcount=${max}`);
  return (j.response.serverlist ?? []).map(s => ({
    endpoint: String(s.endpoint),
    type: String(s.type),
    dc: String(s.dc),
    load: Number(s.load),
    weightedLoad: Math.round(Number(s.wtd_load) * 10) / 10,
  }));
}

/** TCP connect time to `host:port` (resolved by Bun) in milliseconds, or `null`. */
export function tcpConnect(hostname: string, port: number, timeoutMs = 3000): Promise<number | null> {
  const t0 = performance.now();
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (v: number | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    Bun.connect({
      hostname,
      port,
      socket: {
        open(s) {
          done(ms(t0));
          s.end();
        },
        data() {},
        connectError() {
          done(null);
        },
        error() {
          done(null);
        },
      },
    }).catch(() => done(null));
  });
}

/** TLS handshake on 443 with SNI: total time and the handshake share beyond the TCP connect. */
export function tlsHandshake(host: string, tcpMs: number | null, timeoutMs = 5000): Promise<HostProbe["tls"]> {
  const t0 = performance.now();
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ handshakeMs: null, totalMs: null, error: "timeout" }), timeoutMs);
    const done = (v: HostProbe["tls"]) => {
      clearTimeout(timer);
      resolve(v);
    };
    Bun.connect({
      hostname: host,
      port: 443,
      tls: { serverName: host },
      socket: {
        handshake(s, success, authError) {
          const total = ms(t0);
          done(
            success
              ? {
                  handshakeMs: tcpMs === null ? null : Math.round((total - tcpMs) * 10) / 10,
                  totalMs: total,
                }
              : {
                  handshakeMs: null,
                  totalMs: total,
                  error: String(authError ?? "handshake failed"),
                },
          );
          s.end();
        },
        data() {},
        connectError(_, e) {
          done({ handshakeMs: null, totalMs: null, error: e.message });
        },
        error(_, e) {
          done({ handshakeMs: null, totalMs: null, error: e.message });
        },
      },
    }).catch((e: Error) => done({ handshakeMs: null, totalMs: null, error: e.message }));
  });
}

/** One `GET /` (the empty public object of a SteamPipe server) without connection reuse. */
async function httpGet(url: string): Promise<HttpTiming> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      keepalive: false,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const ttfb = ms(t0);
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      ttfbMs: ttfb,
      totalMs: ms(t0),
      bytes: body.byteLength,
      server: res.headers.get("server"),
    };
  } catch (e) {
    return {
      status: null,
      ttfbMs: null,
      totalMs: null,
      bytes: 0,
      server: null,
      error: (e as Error).message,
    };
  }
}

async function lookup(host: string, family: 4 | 6) {
  try {
    return (await Bun.dns.lookup(host, { family })).map(r => ({
      address: r.address,
      ttl: r.ttl,
    }));
  } catch {
    return [];
  }
}

/** DNS, TCP (v4 80/443, v6 443), TLS 443 and HTTP/HTTPS timings of one host. */
export async function probeHost(host: string, https = true): Promise<HostProbe> {
  const t0 = performance.now();
  const [a, aaaa] = await Promise.all([lookup(host, 4), lookup(host, 6)]);
  const dnsMs = ms(t0);
  const v4 = a[0]?.address;
  const v6 = aaaa[0]?.address;
  const tcp = {
    v4_80: v4 ? await tcpConnect(v4, 80) : null,
    v4_443: v4 ? await tcpConnect(v4, 443) : null,
    v6_443: v6 ? await tcpConnect(v6, 443) : null,
  };
  const tls = https
    ? await tlsHandshake(host, tcp.v4_443)
    : {
        handshakeMs: null,
        totalMs: null,
        error: "server does not offer HTTPS",
      };
  const http = await httpGet(`http://${host}/`);
  const secure = https
    ? await httpGet(`https://${host}/`)
    : {
        status: null,
        ttfbMs: null,
        totalMs: null,
        bytes: 0,
        server: null,
        error: "skipped",
      };
  return { host, dns: { a, aaaa, ms: dnsMs }, tcp, tls, http, https: secure };
}

/** Round trip of one UDP DNS query (A `steamcontent.com`) to the first configured resolver. */
export function resolverRtt(server: string | undefined, timeoutMs = 2000): Promise<number | null> {
  if (!server || server.includes(":")) return Promise.resolve(null);
  const name = "steamcontent.com".split(".");
  const query = new Uint8Array([
    0x42,
    0x53,
    0x01,
    0x00,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    ...name.flatMap(label => [label.length, ...new TextEncoder().encode(label)]),
    0,
    0,
    1,
    0,
    1,
  ]);
  return new Promise(resolve => {
    let t0 = 0;
    let socket: { close(): void } | undefined;
    const timer = setTimeout(() => {
      socket?.close();
      resolve(null);
    }, timeoutMs);
    Bun.udpSocket({
      socket: {
        data(s, buf) {
          if (buf[0] !== 0x42 || buf[1] !== 0x53) return;
          clearTimeout(timer);
          resolve(ms(t0));
          s.close();
        },
      },
    })
      .then(s => {
        socket = s;
        t0 = performance.now();
        s.send(query, 53, server);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

const bump = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};

/** What the client actually did, from `content_log`, `connection_log` and the Remote Play logs. */
export function parseLogs(steamRoot: string) {
  const logs = join(steamRoot, "logs");
  const perHost: Record<
    string,
    {
      type: string;
      bytes: number;
      seconds: number;
      hits: number;
      misses: number;
      samples: number;
      interfaces: number;
    }
  > = {};
  const host = (h: string, type: string) =>
    (perHost[h] ??= {
      type,
      bytes: 0,
      seconds: 0,
      hits: 0,
      misses: 0,
      samples: 0,
      interfaces: 0,
    });
  const errors: Record<string, number> = {};
  const phases: Record<string, number> = {};
  const rates: number[] = [];
  let cellUsed: number | null = null;
  let http2 = false;
  let stalls = 0;
  for (const line of readLines(join(logs, "content_log.txt"))) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/Created download interface of type '(\w+)' \(\d+\) to host (\S+)/)))
      host(m[2]!, m[1]!).interfaces++;
    else if (
      (m = line.match(
        /stats: \((\w+), \d+\) (\S+): (\d+) Bytes, (\d+) sec \([\d.]+ Mbps\)\. (\d+) Hits \/ (\d+) Misses/,
      ))
    ) {
      const h = host(m[2]!, m[1]!);
      h.bytes += Number(m[3]);
      h.seconds += Number(m[4]);
      h.hits += Number(m[5]);
      h.misses += Number(m[6]);
      h.samples++;
    } else if ((m = line.match(/Current download rate: ([\d.]+) Mbps/))) rates.push(Number(m[1]));
    else if ((m = line.match(/via ContentServerDirectoryService::\w+ \(CellID (\d+)/))) cellUsed = Number(m[1]);
    else if ((m = line.match(/App update changed : (.+?),?\s*$/)))
      for (const p of m[1]!.split(",")) bump(phases, p.trim());
    else if ((m = line.match(/\(\w+,\d+\) - (\S+) .*?: (.*ERROR.*)$/)))
      bump(errors, `${m[1]}: ${m[2]!.replace(/\d+/g, "N")}`);
    if (/HTTP\/2 available/.test(line)) http2 = true;
    if (/stall|timed out|Timeout/i.test(line)) stalls++;
  }
  const hosts = Object.entries(perHost)
    .map(([h, v]) => ({
      host: h,
      ...v,
      mbps: v.seconds ? Math.round(((v.bytes * 8) / v.seconds / 1e6) * 100) / 100 : null,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const transports: Record<string, number> = {};
  const cmPings: { host: string; ms: number; load: number }[] = [];
  let canConnect: string | null = null;
  const ipv6: Record<string, string> = {};
  let connectivity: string | null = null;
  for (const line of readLines(join(logs, "connection_log.txt"))) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/ConnectionCompleted\(\) \(\S+, (\w+)\)/))) bump(transports, m[1]!);
    else if ((m = line.match(/Ping\w*CM\(\) \((\S+)\) results: ([\d.]+)ms \+ load ([\d.]+)/)))
      cmPings.push({ host: m[1]!, ms: Number(m[2]), load: Number(m[3]) });
    else if ((m = line.match(/Client thinks it can connect via: (.*)$/))) canConnect = m[1]!;
    else if ((m = line.match(/IPv6 (UDP|HTTP) connectivity test .* - ([A-Z]+)\b/))) ipv6[m[1]!] = m[2]!;
    else if ((m = line.match(/Connectivity test: result=(\w+)/))) connectivity = m[1]!;
  }

  const sessions: { at: string; peer: string; mode: string }[] = [];
  const disconnects: Record<string, number> = {};
  for (const line of readLines(join(logs, "remote_connections.txt"))) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\[([^\]]+)\] Client \d+ \(([^)]+)\) connected via (\w+) connection/)))
      sessions.push({ at: m[1]!, peer: m[2]!, mode: m[3]! });
    else if ((m = line.match(/Disconnected from remote client: (0x[0-9a-f]+)/i))) bump(disconnects, m[1]!);
  }
  const streaming = {
    codec: null as string | null,
    encoder: null as string | null,
    bitrate: null as string | null,
    packetLoss: null as string | null,
  };
  for (const line of readLines(join(logs, "streaming_log.txt"))) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/\b(HEVC|H\.?265|H\.?264|AV1)\b/i))) streaming.codec = m[1]!.toUpperCase();
    if ((m = line.match(/\b(NVENC|AMF|QSV|VAAPI|libx264|software encod\w*)\b/i))) streaming.encoder = m[1]!;
    if ((m = line.match(/bitrate[^\d]{0,12}([\d.]+\s*[kKmM]bit(?:s|\/s)?|[\d.]+\s*[kKmM]bps)/i)))
      streaming.bitrate = m[1]!;
    if ((m = line.match(/(?:packet )?loss[^\d]{0,12}([\d.]+\s*%)/i))) streaming.packetLoss = m[1]!;
  }
  return {
    content: {
      cellUsed,
      http2,
      stalls,
      hosts,
      rates: {
        samples: rates.length,
        maxMbps: rates.length ? Math.max(...rates) : null,
        last: rates.slice(-5),
      },
      phases,
      errors: Object.entries(errors)
        .map(([what, count]) => ({ what, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    connection: {
      transports,
      canConnect,
      ipv6,
      connectivity,
      cmPings: cmPings.slice(-12),
    },
    remotePlay: { sessions: sessions.slice(-10), disconnects, streaming },
  };
}

/** `steam_dev.cfg` (`@key value` lines) of the Steam root, or `null` when absent. */
export function readSteamDevCfg(steamRoot: string): Record<string, string> | null {
  const lines = readLines(join(steamRoot, "steam_dev.cfg"));
  if (!lines.length) return null;
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = l.trim().match(/^(@?\w+)\s+(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

function largestFile(dir: string, budget = 20_000): string | null {
  let best: { path: string; size: number } | null = null;
  let seen = 0;
  const walk = (d: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > budget) return;
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 6 && e.name !== "Steam Controller Configs") walk(p, depth + 1);
      else if (e.isFile()) {
        try {
          const size = statSync(p).size;
          if (!best || size > best.size) best = { path: p, size };
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(dir, 0);
  return (best as { path: string } | null)?.path ?? null;
}

/** Sequential read speed of a slice (`mb` MiB from the middle) of the largest game file. */
async function diskProbe(library: string, mb: number) {
  let free: number | null = null;
  let total: number | null = null;
  try {
    const s = statfsSync(library);
    free = s.bavail * s.bsize;
    total = s.blocks * s.bsize;
  } catch {
    /* unreachable path */
  }
  const sample = largestFile(join(library, "steamapps", "common"));
  const big = sample !== null && statSync(sample).size >= 8 * 2 ** 20;
  let readMBps: number | null = null;
  let sampleBytes = 0;
  if (sample && big && mb > 0) {
    const file = Bun.file(sample);
    const len = Math.min(file.size, mb * 2 ** 20);
    const start = Math.max(0, Math.floor((file.size - len) / 2));
    const t0 = performance.now();
    sampleBytes = (await file.slice(start, start + len).arrayBuffer()).byteLength;
    const secs = (performance.now() - t0) / 1000;
    readMBps = secs > 0 ? Math.round(sampleBytes / 2 ** 20 / secs) : null;
  }
  return {
    library,
    freeBytes: free,
    totalBytes: total,
    sample: sample && norm(sample),
    sampleBytes,
    readMBps,
  };
}

function linuxNet(): Record<string, string | null> | null {
  if (IS_WINDOWS || process.platform !== "linux") return null;
  const sys = (p: string) => {
    try {
      return readFileSync(`/proc/sys/${p}`, "utf8").trim().replace(/\s+/g, " ");
    } catch {
      return null;
    }
  };
  let iface: string | null = null;
  for (const l of readLines("/proc/net/route").slice(1)) {
    const [name, dest] = l.split(/\s+/);
    if (dest === "00000000") iface = name ?? null;
  }
  let qdisc: string | null = null;
  if (iface && Bun.which("tc")) {
    const r = Bun.spawnSync(["tc", "qdisc", "show", "dev", iface], {
      stdout: "pipe",
      stderr: "ignore",
    });
    qdisc = r.stdout.toString().trim().split("\n")[0] ?? null;
  }
  return {
    "net.core.rmem_max": sys("net/core/rmem_max"),
    "net.core.wmem_max": sys("net/core/wmem_max"),
    "net.core.rmem_default": sys("net/core/rmem_default"),
    "net.core.wmem_default": sys("net/core/wmem_default"),
    "net.ipv4.tcp_rmem": sys("net/ipv4/tcp_rmem"),
    "net.ipv4.tcp_wmem": sys("net/ipv4/tcp_wmem"),
    "net.ipv4.tcp_congestion_control": sys("net/ipv4/tcp_congestion_control"),
    "net.ipv4.tcp_available_congestion_control": sys("net/ipv4/tcp_available_congestion_control"),
    "net.core.default_qdisc": sys("net/core/default_qdisc"),
    defaultRouteInterface: iface,
    qdisc,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export interface AuditOptions {
  steamRoot?: string | undefined;
  /** Cell to query; default: `CellIDServerOverride`, then the cell the client logged, then 0. */
  cellId?: number | undefined;
  maxServers?: number | undefined;
  /** MiB read from the largest game file of each library (0 skips the disk probe). */
  diskMiB?: number | undefined;
  /** Extra library paths to probe (libraries not yet added to the client). */
  libraries?: string[] | undefined;
  log?: ((m: string) => void) | undefined;
}

/** Runs the audit and derives findings and recommendations. */
export async function runAudit(opts: AuditOptions = {}): Promise<AuditReport> {
  const started = performance.now();
  const log = opts.log ?? (() => {});
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  const store = kvObj(readVdf(clientConfigPath(steamRoot)), ...STORE);
  const override = Number(kvStr(store, "CellIDServerOverride") ?? NaN);
  const logs = parseLogs(steamRoot);
  const cell = opts.cellId ?? (Number.isFinite(override) ? override : (logs.content.cellUsed ?? 0));

  log(`content servers and CMs for cell ${cell}`);
  const cells = [...new Set([cell, 0])];
  const [servers, cms] = await Promise.all([
    Promise.all(cells.map(c => contentServers(c, opts.maxServers ?? 20).catch(() => []))).then(l => l.flat()),
    cmServers(cell, 12).catch(() => []),
  ]);
  const byHost = new Map<string, ContentServer>();
  for (const s of servers) {
    const seen = byHost.get(s.vhost);
    if (seen) seen.queriedCells.push(...s.queriedCells);
    else byHost.set(s.vhost, s);
  }
  const servers2 = [...byHost.values()];
  log(`probing ${servers2.length} content servers`);
  const probes = await pool(servers2, 4, s => probeHost(s.vhost, s.https !== "unavailable"));
  const cmProbes = await pool(cms, 6, async c => {
    const [h, p] = c.endpoint.split(":");
    return { ...c, tcpMs: await tcpConnect(h!, Number(p)) };
  });
  const servers_ = getServers();
  const dns = {
    servers: servers_,
    // Best of three queries: one sample mostly measures the resolver's cache state.
    resolverRttMs: await (async () => {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const v = await resolverRtt(servers_[0]);
        if (v !== null) samples.push(v);
      }
      return samples.length ? Math.min(...samples) : null;
    })(),
  };

  const throttle = kvStr(store, "DownloadThrottleKbps");
  const localStreaming = userDataDirs(steamRoot)
    .map(d => kvObj(readVdf(join(d, "config", "localconfig.vdf")), "UserLocalConfigStore", "streaming_v2"))
    .find(Boolean);
  const shader = kvObj(store, "ShaderCacheManager");
  const flat = (o: ReturnType<typeof kvObj>, keep?: RegExp) =>
    o
      ? Object.fromEntries(
          Object.entries(o).filter(
            (e): e is [string, string] => typeof e[1] === "string" && (!keep || keep.test(e[0])),
          ),
        )
      : null;
  const config = {
    steamDevCfg: readSteamDevCfg(steamRoot),
    downloadThrottleKbps: throttle === null ? null : Number(throttle),
    allowDownloadsDuringGameplay:
      kvStr(store, "AllowDownloadsDuringGameplay") === null
        ? null
        : kvStr(store, "AllowDownloadsDuringGameplay") === "1",
    recentDownloadRateBytes: Number(kvStr(store, "RecentDownloadRate")) || null,
    shaderCache: flat(shader),
    // Streaming switches only: device names, ids and the encoded client config blob stay out.
    remotePlay: flat(
      localStreaming ?? null,
      /^(EnableStreaming|P2PScopeV2|Enable\w+|SoftwareEncodingThreadCount|Display\w*Setting|HostPlayAudio|\w+ConfigEnabled)$/,
    ),
  };

  const libs = [...new Set([...listLibraries(steamRoot).map(l => l.path), ...(opts.libraries ?? []).map(norm)])].filter(
    isDir,
  );
  log(`disk probe of ${libs.length} libraries`);
  const disk = [];
  for (const lib of libs) disk.push(await diskProbe(lib, opts.diskMiB ?? 256));

  const report: AuditReport = {
    schema: AUDIT_SCHEMA,
    generatedAt: new Date().toISOString(),
    durationMs: 0,
    host: {
      name: hostname(),
      platform: process.platform,
      arch: process.arch,
      bun: Bun.version,
    },
    steamRoot,
    cell: {
      override: Number.isFinite(override) ? override : null,
      usedByClient: logs.content.cellUsed,
      queried: cells,
    },
    dns,
    cms: cmProbes,
    contentServers: servers2.map((s, i) => ({ ...s, probe: probes[i]! })),
    logs,
    config,
    disk,
    linux: linuxNet(),
    findings: [],
    recommendations: [],
  };
  derive(report);
  report.durationMs = Math.round(performance.now() - started);
  return report;
}

/** Fills `findings` and `recommendations` from the measured data. */
function derive(r: AuditReport): void {
  const F = r.findings;
  const R = r.recommendations;
  const reachable = r.contentServers.filter(s => s.probe.http.ttfbMs !== null || s.probe.https.ttfbMs !== null);
  const rtt = (s: (typeof reachable)[number]) => s.probe.tcp.v4_443 ?? s.probe.tcp.v4_80 ?? 999;
  const score = (s: (typeof reachable)[number]) => rtt(s) + s.weightedLoad / 10;
  const ranked = [...reachable].sort((x, y) => score(x) - score(y));
  const best = ranked[0];
  if (!r.contentServers.length)
    F.push({
      id: "no-content-servers",
      severity: "critical",
      message: "GetServersForSteamPipe returned no server (API unreachable?)",
    });
  if (best)
    F.push({
      id: "best-content-server",
      severity: "info",
      message: `${best.vhost} (${best.type}${best.cellId === null ? ", global CDN" : `, cell ${best.cellId}`}, load ${best.weightedLoad}) answers fastest: TCP ${rtt(best)} ms`,
      evidence: ranked.slice(0, 5).map(s => ({
        host: s.vhost,
        type: s.type,
        cell: s.cellId,
        tcp443: s.probe.tcp.v4_443,
        ttfbHttp: s.probe.http.ttfbMs,
        ttfbHttps: s.probe.https.ttfbMs,
        load: s.weightedLoad,
      })),
    });
  // Region: compare the caches returned for the configured cell with those of the IP-based cell 0.
  const caches = (cell: number) =>
    reachable
      .filter(s => s.queriedCells.includes(cell) && s.type === "SteamCache")
      .map(rtt)
      .sort((x, y) => x - y);
  const median = (l: number[]) => (l.length ? l[Math.floor(l.length / 2)]! : null);
  const configured = r.cell.override;
  if (configured !== null && configured !== 0) {
    const mine = median(caches(configured));
    const auto = median(caches(0));
    const autoCells = [
      ...new Set(reachable.filter(s => s.queriedCells.includes(0) && s.cellId !== null).map(s => s.cellId)),
    ];
    F.push({
      id: "download-region",
      severity: "info",
      message: `download region override cell ${configured}: median cache RTT ${mine ?? "n/a"} ms; automatic region (cells ${autoCells.join(",") || "?"}): ${auto ?? "n/a"} ms`,
    });
    if (mine !== null && auto !== null && auto + 5 < mine)
      R.push({
        id: "download-region",
        reason: `the automatic region's caches answer ${Math.round(mine - auto)} ms faster than the override cell ${configured}`,
        apply: { file: "config.vdf", key: "CellIDServerOverride", value: null },
      });
  }
  const tlsCost = reachable
    .map(s => (s.probe.https.ttfbMs ?? NaN) - (s.probe.http.ttfbMs ?? NaN))
    .filter(Number.isFinite);
  const mandatory = r.contentServers.filter(s => s.https === "mandatory").length;
  if (tlsCost.length) {
    const median = tlsCost.sort((a, b) => a - b)[Math.floor(tlsCost.length / 2)]!;
    F.push({
      id: "http-vs-https",
      severity: "info",
      message: `HTTPS adds a median ${Math.round(median)} ms to the first byte over HTTP; ${mandatory}/${r.contentServers.length} servers require HTTPS`,
    });
  }
  const c = r.logs.content;
  const dev = r.config.steamDevCfg ?? {};
  const http2Key =
    r.host.platform === "win32"
      ? "@nClientDownloadEnableHTTP2PlatformWindows"
      : "@nClientDownloadEnableHTTP2PlatformLinux";
  const slowHosts = c.hosts.filter(h => h.mbps !== null && h.mbps < 20 && h.samples > 0);
  if (slowHosts.length)
    F.push({
      id: "slow-cache-hosts",
      severity: "warn",
      message: `${slowHosts.length} content hosts averaged under 20 Mbps per connection in content_log`,
      evidence: slowHosts.slice(0, 5).map(h => ({ host: h.host, mbps: h.mbps })),
    });
  if (c.http2 && dev[http2Key] !== "0")
    R.push({
      id: "http2-off",
      reason:
        "the client negotiates HTTP/2 with the CDN; one multiplexed connection per host limits depot throughput, HTTP/1.1 opens parallel connections",
      apply: { file: "steam_dev.cfg", key: http2Key, value: "0" },
    });
  if (dev["@fDownloadRateImprovementToAddAnotherConnection"] !== "1.0")
    R.push({
      id: "connection-count",
      reason:
        "let the client add download connections as soon as throughput improves (default needs a large gain per connection)",
      apply: {
        file: "steam_dev.cfg",
        key: "@fDownloadRateImprovementToAddAnotherConnection",
        value: "1.0",
      },
    });
  if (r.config.downloadThrottleKbps)
    R.push({
      id: "throttle",
      reason: `downloads are throttled to ${r.config.downloadThrottleKbps} kbps`,
      apply: { file: "config.vdf", key: "DownloadThrottleKbps", value: null },
    });
  for (const e of c.errors.filter(x => x.count >= 20))
    F.push({
      id: "cdn-errors",
      severity: "warn",
      message: `${e.count}x ${e.what}`,
    });
  if (c.stalls)
    F.push({
      id: "stalls",
      severity: c.stalls > 10 ? "warn" : "info",
      message: `${c.stalls} stall/timeout lines in content_log`,
    });

  const conn = r.logs.connection;
  if (Object.values(conn.ipv6).some(v => !/^(OK|SUCCESS)$/.test(v)))
    F.push({
      id: "ipv6",
      severity: "info",
      message: "IPv6 connectivity tests fail; the client uses IPv4 only",
      evidence: conn.ipv6,
    });
  const v6Reach = r.contentServers.filter(s => s.probe.tcp.v6_443 !== null).length;
  if (v6Reach)
    F.push({
      id: "ipv6-cdn",
      severity: "info",
      message: `${v6Reach} content servers answer over IPv6 from this host`,
    });
  if (r.dns.resolverRttMs !== null && r.dns.resolverRttMs > 50)
    F.push({
      id: "dns-slow",
      severity: "warn",
      message: `resolver ${r.dns.servers[0]} answers in ${r.dns.resolverRttMs} ms`,
      evidence: r.dns,
    });

  const rp = r.logs.remotePlay;
  if (rp.sessions.some(s => s.mode !== "direct"))
    R.push({
      id: "remote-play-direct",
      reason: "Remote Play fell back to a relayed session",
      manual:
        "Steam > Settings > Remote Play > Advanced host options: enable 'Allow direct connection (IP sharing)' on both clients; open UDP 27031-27036 and TCP 27036-27037 between them",
    });
  const drops = Object.values(rp.disconnects).reduce((a, b) => a + b, 0);
  if (drops)
    F.push({
      id: "remote-play-disconnects",
      severity: "warn",
      message: `${drops} Remote Play disconnects in remote_connections.txt`,
      evidence: rp.disconnects,
    });
  if (rp.streaming.encoder && /x264|software/i.test(rp.streaming.encoder))
    R.push({
      id: "remote-play-hw-encode",
      reason: `the host encodes in software (${rp.streaming.encoder})`,
      manual:
        "Steam > Settings > Remote Play > Advanced host options: enable hardware encoding (NVENC/AMF/QSV/VAAPI) on GPU hosts",
    });

  for (const d of r.disk) {
    if (d.freeBytes !== null && d.freeBytes < 50 * 2 ** 30)
      F.push({
        id: "disk-free",
        severity: "warn",
        message: `${d.library}: ${(d.freeBytes / 2 ** 30).toFixed(1)} GiB free`,
      });
    if (d.readMBps !== null && d.readMBps < 150)
      R.push({
        id: "library-disk",
        reason: `${d.library} reads at ${d.readMBps} MiB/s`,
        manual: `move the library to a faster disk: bun-steam libraries disks, then bun-steam libraries move "${d.library}" <fast disk>/SteamLibrary`,
      });
  }
  const lx = r.linux;
  if (lx) {
    if (Number(lx["net.core.rmem_max"] ?? 0) < 16 * 2 ** 20)
      R.push({
        id: "linux-socket-buffers",
        reason: `net.core.rmem_max is ${lx["net.core.rmem_max"]}`,
        manual:
          "sysctl -w net.core.rmem_max=33554432 net.core.wmem_max=33554432 (system setting, applied by the owner)",
      });
    if (
      lx["net.ipv4.tcp_congestion_control"] !== "bbr" &&
      (lx["net.ipv4.tcp_available_congestion_control"] ?? "").includes("bbr")
    )
      R.push({
        id: "linux-bbr",
        reason: `congestion control is ${lx["net.ipv4.tcp_congestion_control"]}`,
        manual:
          "sysctl -w net.core.default_qdisc=fq net.ipv4.tcp_congestion_control=bbr (system setting, applied by the owner)",
      });
  }
}

/** Keeps every audit run in the Steam index database (`audit_run`). */
export function recordAudit(db: Database, report: AuditReport): number {
  db.run(
    "CREATE TABLE IF NOT EXISTS audit_run (id INTEGER PRIMARY KEY, at TEXT NOT NULL, host TEXT NOT NULL, schema TEXT NOT NULL, report TEXT NOT NULL)",
  );
  const row = db
    .query("INSERT INTO audit_run(at, host, schema, report) VALUES (?,?,?,?) RETURNING id")
    .get(report.generatedAt, report.host.name, report.schema, JSON.stringify(report)) as { id: number };
  return row.id;
}
