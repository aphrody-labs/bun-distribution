// SPDX-License-Identifier: Apache-2.0
// windex configuration: state paths under the Aphrody home, container endpoints and versioned identities.
// The home is `--home`, `$APHRODY_HOME` or `~/.aphrody`; a SYSTEM task always passes `--home` explicitly because
// the SYSTEM profile is not the owner's.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Version of the record shape written to NDJSON, Redis and the RAG cards. */
export const RECORD_VERSION = 1;
/** Redis key namespace version; bump it to invalidate every cached key at once. */
export const KEY_VERSION = "v1";
export const KEY_PREFIX = `windex:${KEY_VERSION}`;

export type HashMode = "all" | "pe" | "none";

export type Config = {
  home: string;
  /** `<home>/windex`: NDJSON, RAG cards, checkpoints and logs (never in the repository). */
  dir: string;
  /** `<home>/private/windex`: generated passwords (never committed nor printed). */
  privateDir: string;
  pg: {
    host: string;
    port: number;
    user: string;
    database: string;
    passwordFile: string;
  };
  redis: { host: string; port: number; passwordFile: string };
  /** Worker threads hashing and parsing files. */
  workers: number;
};

export function resolveHome(explicit?: string): string {
  return explicit ?? process.env.APHRODY_HOME ?? join(homedir(), ".aphrody");
}

export function loadConfig(opts: { home?: string; workers?: number } = {}): Config {
  const home = resolveHome(opts.home);
  const privateDir = join(home, "private", "windex");
  const cpus = navigator.hardwareConcurrency || 4;
  return {
    home,
    dir: join(home, "windex"),
    privateDir,
    pg: {
      host: process.env.WINDEX_PG_HOST ?? "127.0.0.1",
      port: Number(process.env.WINDEX_PG_PORT ?? 55432),
      user: "windex",
      database: "windex",
      passwordFile: join(privateDir, "pg.password"),
    },
    redis: {
      host: process.env.WINDEX_REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.WINDEX_REDIS_PORT ?? 56379),
      passwordFile: join(privateDir, "redis.password"),
    },
    workers: opts.workers ?? Math.max(2, Math.min(12, cpus - 4)),
  };
}

/** Reads a generated secret; the value is returned to the caller and never logged. */
export function readSecret(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`secret absent : ${file} (lancer \`windex up\` pour le générer)`);
  }
  return readFileSync(file, "utf8").trim();
}

/** Creates a 32-byte random password file once (base64url, no trailing newline); never overwrites. */
export function ensureSecret(file: string): boolean {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(file, Buffer.from(bytes).toString("base64url"), {
    mode: 0o600,
    flag: "wx",
  });
  return true;
}

/** Directory of the Aphrody binaries for the owner of `home` (`<profile>/AppData/Local/aphrody/bin`). */
export function aphrodyBin(home: string, name = "aphrody"): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const fromPath = Bun.which(name);
  if (fromPath) return fromPath;
  return join(dirname(home), "AppData", "Local", "aphrody", "bin", exe);
}

/** Lower-cased Windows path key (`c:\windows\system32\kernel32.dll`), the unique key of every store. */
export function pathKey(path: string): string {
  return path.replaceAll("/", "\\").toLowerCase();
}

/** 52-bit wyhash of a string: compact keys/values of the incremental state map (millions of entries). */
export function hash52(s: string): number {
  return Number(BigInt.asUintN(52, BigInt(Bun.hash(s))));
}

/** Incremental skip value of a file: equal size and mtime mean unchanged content. */
export function stateValue(size: number, mtimeMs: number | null): number {
  return hash52(`${size}/${mtimeMs}`);
}

/** Normalises a user root (`C:/Windows`, `c:\windows\`) into `C:\Windows` form. */
export function normalizeRoot(root: string): string {
  let r = root.replaceAll("/", "\\");
  if (/^[a-z]:/.test(r)) r = r[0]!.toUpperCase() + r.slice(1);
  if (r.length > 3 && r.endsWith("\\")) r = r.slice(0, -1);
  if (/^[A-Z]:$/.test(r)) r += "\\";
  return r;
}

/** True when `path` is `root` or below it (case-insensitive Windows semantics). */
export function underRoot(path: string, root: string): boolean {
  const p = pathKey(path);
  const r = pathKey(root);
  if (r.endsWith("\\")) return p.startsWith(r) || p === r.slice(0, -1);
  return p === r || p.startsWith(`${r}\\`);
}

/** Default exclusions: volatile or private trees whose churn would only add noise (and the windex state itself). */
export function defaultExcludes(home: string): string[] {
  const profile = dirname(home);
  return [
    "C:\\$Recycle.Bin",
    "C:\\System Volume Information",
    "C:\\pagefile.sys",
    "C:\\hiberfil.sys",
    "C:\\swapfile.sys",
    "C:\\DumpStack.log.tmp",
    "C:\\ProgramData\\Microsoft\\Windows Defender\\Scans",
    join(profile, "AppData", "Local", "Temp"),
    join(profile, "AppData", "Local", "Docker"),
    join(home, "windex"),
  ].map(normalizeRoot);
}
