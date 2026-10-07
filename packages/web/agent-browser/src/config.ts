// SPDX-License-Identifier: Apache-2.0
/**
 * Single reader of `tools/config/web.json`, the configuration contract of the Aphrody web layer.
 *
 * Precedence, lowest to highest: built-in defaults, `tools/config/web.json`, environment variables
 * (see the `env` block of the file), explicit options passed by the caller. Secrets are never
 * read from or written to this file.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface WebEngineConfig {
  binary: string;
  workerBinary: string;
  binaryEnv: string;
  binaryCandidates: string[];
  host: string;
  port: number;
  workers: number;
  stealth: boolean;
  allowFileAccess: boolean;
  allowPrivateNetwork: boolean;
  startupTimeoutMs: number;
  shutdownGraceMs: number;
}

export interface WebFetchConfig {
  timeoutSecs: number;
  waitUntil: string;
  dump: "html" | "text" | "links" | "markdown" | "artifact";
  userAgent: string | null;
}

export interface WebCrawlConfig {
  maxDepth: number;
  maxPages: number;
  concurrency: number;
  delayMs: number;
  timeoutSecs: number;
  obeyRobots: boolean;
  sitemaps: boolean;
  userAgent: string;
  allowedHosts: string[];
}

export interface WebStorageConfig {
  stateDir: string;
  frontierDb: string;
  reports: string;
  crawlabilityReport: string;
}

export interface WebConfig {
  schemaVersion: 1;
  engine: WebEngineConfig;
  fetch: WebFetchConfig;
  crawl: WebCrawlConfig;
  network: { privateNetworkPolicy: "deny" | "allow"; allowedSchemes: string[] };
  storage: WebStorageConfig;
  /** Absolute repository root the relative paths of the file are resolved against. */
  root: string;
  /** Absolute path of the file that was read, or `null` when only defaults applied. */
  source: string | null;
}

export const DEFAULT_WEB_CONFIG: Omit<WebConfig, "root" | "source"> = {
  schemaVersion: 1,
  engine: {
    binary: "aphrody-web",
    workerBinary: "aphrody-web-worker",
    binaryEnv: "APHRODY_WEB_BIN",
    binaryCandidates: [
      "target/debug/aphrody-web",
      "target/release/aphrody-web",
      "~/.local/bin/aphrody-web",
    ],
    host: "127.0.0.1",
    port: 9222,
    workers: 1,
    stealth: false,
    allowFileAccess: false,
    allowPrivateNetwork: false,
    startupTimeoutMs: 30_000,
    shutdownGraceMs: 5_000,
  },
  fetch: { timeoutSecs: 30, waitUntil: "load", dump: "markdown", userAgent: null },
  crawl: {
    maxDepth: 2,
    maxPages: 25,
    concurrency: 4,
    delayMs: 250,
    timeoutSecs: 300,
    obeyRobots: true,
    sitemaps: false,
    userAgent: "AphrodyWeb/1.0",
    allowedHosts: [],
  },
  network: { privateNetworkPolicy: "deny", allowedSchemes: ["http", "https"] },
  storage: {
    stateDir: "~/.aphrody/web",
    frontierDb: "~/.aphrody/web/frontier.sqlite",
    reports: "~/.aphrody/web/reports",
    crawlabilityReport: "~/.aphrody/web/reports/crawlability.json",
  },
};

/** Repository root: `APHRODY_ROOT` when set, otherwise four levels above this file. */
export function repositoryRoot(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.APHRODY_ROOT ?? join(import.meta.dir, "../../../.."));
}

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursive merge where `override` wins; arrays and scalars replace, objects merge. */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override))
    return (override === undefined ? base : override) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = key in base ? mergeConfig((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

function positiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export interface LoadWebConfigOptions {
  root?: string;
  /** Path of the JSON file; defaults to `<root>/tools/config/web.json`. */
  file?: string;
  env?: Record<string, string | undefined>;
  /** Explicit overrides, applied last. */
  overrides?: unknown;
}

/** Reads defaults, `tools/config/web.json`, then environment overrides and caller overrides. */
export function loadWebConfig(options: LoadWebConfigOptions = {}): WebConfig {
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? repositoryRoot(env));
  const file = resolve(options.file ?? join(root, "tools/config/web.json"));
  let merged: Omit<WebConfig, "root" | "source"> = structuredClone(DEFAULT_WEB_CONFIG);
  let source: string | null = null;
  if (existsSync(file)) {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1) {
      throw new Error(`${file}: unsupported web config (schemaVersion 1 required)`);
    }
    // Only the fields the client consumes; documentation-only blocks stay in the file.
    const { engine, fetch, crawl, network, storage } = parsed as Record<string, unknown>;
    merged = mergeConfig(merged, { engine, fetch, crawl, network, storage });
    source = file;
  }
  const port = positiveInt(env.APHRODY_WEB_PORT);
  if (port !== undefined) merged.engine.port = port;
  if (
    env.OBSCURA_ALLOW_PRIVATE_NETWORK &&
    /^(1|true|yes|on)$/i.test(env.OBSCURA_ALLOW_PRIVATE_NETWORK.trim())
  ) {
    merged.engine.allowPrivateNetwork = true;
  }
  merged = mergeConfig(merged, options.overrides);
  return { ...merged, root, source };
}

/** Candidate engine binaries in resolution order, with `~` and repository-relative paths expanded. */
export function engineBinaryCandidates(
  config: WebConfig,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const explicit = env[config.engine.binaryEnv];
  const listed = config.engine.binaryCandidates.map((candidate) => {
    const expanded = expandHome(candidate);
    return resolve(config.root, expanded);
  });
  return [...(explicit ? [resolve(expandHome(explicit))] : []), ...listed];
}

/** Resolves the `aphrody-web` binary or throws with remediation. */
export function resolveEngineBinary(
  config: WebConfig = loadWebConfig(),
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env[config.engine.binaryEnv];
  if (explicit) {
    const path = existsSync(explicit) ? explicit : Bun.which(explicit);
    if (!path)
      throw new Error(`${config.engine.binaryEnv} points to a missing binary: ${explicit}`);
    return realpathSync(resolve(path));
  }
  // Among the existing candidates the most recently built binary wins, so a fresh
  // `cargo build` is preferred over an older installed copy.
  const existing = engineBinaryCandidates(config, env)
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => ({ path: realpathSync(candidate), mtime: statSync(candidate).mtimeMs }))
    .toSorted((a, b) => b.mtime - a.mtime);
  if (existing[0]) return existing[0].path;
  const onPath = Bun.which(config.engine.binary);
  if (onPath) return realpathSync(onPath);
  throw new Error(
    `aphrody-web binary not found. Build it with \`cargo build -p aphrody-web-engine\` or set ${config.engine.binaryEnv}.`,
  );
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const SECRET_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "apikey",
  "api_key",
  "token",
  "cookie",
  "cookies",
  "authorization",
]);

function collectSecretLooking(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value))
    value.forEach((item, index) => collectSecretLooking(item, `${path}[${index}]`, out));
  else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (path === "env") continue; // documentation of variable names, never values
      if (SECRET_KEYS.has(key.toLowerCase()) && typeof child === "string" && child.length > 0)
        out.push(`${path}.${key}`);
      collectSecretLooking(child, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * Structural validation of a raw `tools/config/web.json` document. Returns one message per problem;
 * an empty array means the file honours the contract (loopback listener, bounded crawl,
 * http(s) only, no secret-looking values).
 */
export function validateWebConfig(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObject(raw)) return ["config must be a JSON object"];
  if (raw.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  const engine = isPlainObject(raw.engine) ? raw.engine : {};
  const crawl = isPlainObject(raw.crawl) ? raw.crawl : {};
  const network = isPlainObject(raw.network) ? raw.network : {};
  const range = (name: string, value: unknown, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
      problems.push(`${name} must be an integer in ${min}..${max}`);
  };
  if (typeof engine.host !== "string" || !LOOPBACK_HOSTS.has(engine.host))
    problems.push("engine.host must be a loopback address");
  range("engine.port", engine.port, 1, 65_535);
  range("engine.startupTimeoutMs", engine.startupTimeoutMs, 1_000, 600_000);
  range("engine.shutdownGraceMs", engine.shutdownGraceMs, 100, 120_000);
  if (engine.allowPrivateNetwork !== false)
    problems.push("engine.allowPrivateNetwork must be false in the shared file");
  if (engine.allowFileAccess !== false)
    problems.push("engine.allowFileAccess must be false in the shared file");
  range("crawl.maxDepth", crawl.maxDepth, 0, 20);
  range("crawl.maxPages", crawl.maxPages, 1, 10_000);
  range("crawl.concurrency", crawl.concurrency, 1, 64);
  range("crawl.timeoutSecs", crawl.timeoutSecs, 1, 86_400);
  if (typeof crawl.obeyRobots !== "boolean") problems.push("crawl.obeyRobots must be a boolean");
  if (
    !Array.isArray(crawl.allowedHosts) ||
    crawl.allowedHosts.some((host) => typeof host !== "string")
  )
    problems.push("crawl.allowedHosts must be a string array");
  const schemes = network.allowedSchemes;
  if (
    !Array.isArray(schemes) ||
    schemes.length === 0 ||
    schemes.some((scheme) => scheme !== "http" && scheme !== "https")
  ) {
    problems.push("network.allowedSchemes must list only http and/or https");
  }
  const secretLooking: string[] = [];
  collectSecretLooking(raw, "", secretLooking);
  for (const path of secretLooking)
    problems.push(`${path} looks like a secret value; secrets belong in protected stores`);
  return problems;
}
