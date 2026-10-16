#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// fonts-sync.ts: fetch the upstream font sources pinned in packages/m3-fonts/fonts.lock.json.
//
//   bun scripts/m3/fonts-sync.ts [--check] [--json] [--quiet]
//
// Files land in packages/m3-fonts/fonts/upstream/ (git-ignored; no Git LFS). Each one is verified by
// sha256 and size before it is written, and an existing file that matches is left alone, so the
// command is idempotent and offline once synced. Sources, in order:
//   google-fonts      the materialised sparse checkout of vendor/fonts at the pinned commit, else the
//                     raw file of that commit (public fork aphrody-labs/fonts of google/fonts)
//   material-symbols  the npm tarball, checked against its sha512 integrity, then extracted
// --check verifies without fetching: exit 1 when a file is missing or differs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO } from "./lib/workspace.ts";

export { REPO };
export const FONTS_PACKAGE = join(REPO, "packages/m3-fonts");
export const LOCK_FILE = join(FONTS_PACKAGE, "fonts.lock.json");
export const UPSTREAM_DIR = join(FONTS_PACKAGE, "fonts/upstream");

export interface LockFile {
  version: 1;
  sources: {
    "google-fonts": {
      repository: string;
      upstream: string;
      commit: string;
      submodule: string;
      raw: string;
    };
    "material-symbols": { package: string; tarball: string; integrity: string };
  };
  files: LockEntry[];
}
export interface LockEntry {
  dest: string;
  source: keyof LockFile["sources"];
  path: string;
  sha256: string;
  bytes: number;
  license: string;
}

export type Status = "ok" | "missing" | "mismatch";
export interface Result {
  dest: string;
  status: Status;
  action?: "fetched" | "copied";
  from?: string;
}

export const readLock = (file = LOCK_FILE): LockFile => JSON.parse(readFileSync(file, "utf8"));

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Raw URL of a google-fonts entry (each path segment percent-encoded: `[`, `]`, `,`). */
export function rawUrl(lock: LockFile, entry: LockEntry): string {
  return lock.sources["google-fonts"].raw + entry.path.split("/").map(encodeURIComponent).join("/");
}

/** Whether `bytes` are the pinned content of `entry`. */
export const matches = (entry: LockEntry, bytes: Uint8Array): boolean =>
  bytes.length === entry.bytes && sha256(bytes) === entry.sha256;

/** State of one entry on disk. */
export function status(entry: LockEntry, dir = UPSTREAM_DIR): Status {
  const file = join(dir, entry.dest);
  if (!existsSync(file)) return "missing";
  return matches(entry, readFileSync(file)) ? "ok" : "mismatch";
}

/** Structural errors of a lock file (empty when valid). */
export function validateLock(lock: LockFile): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (!/^[0-9a-f]{40}$/.test(lock.sources["google-fonts"].commit)) errors.push("google-fonts.commit is not a full SHA");
  if (!lock.sources["google-fonts"].raw.includes(lock.sources["google-fonts"].commit))
    errors.push("google-fonts.raw is not pinned to commit");
  if (!lock.sources["material-symbols"].integrity.startsWith("sha512-"))
    errors.push("material-symbols.integrity is not sha512");
  for (const e of lock.files) {
    if (seen.has(e.dest)) errors.push(`duplicate dest ${e.dest}`);
    seen.add(e.dest);
    if (!(e.source in lock.sources)) errors.push(`${e.dest}: unknown source ${e.source}`);
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) errors.push(`${e.dest}: sha256 not pinned`);
    if (!(e.bytes > 0)) errors.push(`${e.dest}: bytes not pinned`);
    if (e.dest.includes("..") || e.dest.startsWith("/")) errors.push(`${e.dest}: dest escapes fonts/upstream`);
  }
  return errors;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The extracted material-symbols tarball, downloaded and integrity-checked once per run. */
let tarballDir: Promise<string> | undefined;
function materialSymbols(lock: LockFile): Promise<string> {
  tarballDir ??= (async () => {
    const source = lock.sources["material-symbols"];
    const bytes = await download(source.tarball);
    const digest = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (digest !== source.integrity) throw new Error(`${source.package}: integrity ${digest} != ${source.integrity}`);
    const dir = mkdtempSync(join(tmpdir(), "m3-fonts-sync-"));
    const tgz = join(dir, "package.tgz");
    writeFileSync(tgz, bytes);
    const tar = Bun.spawnSync(["tar", "-xzf", tgz, "-C", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (tar.exitCode !== 0) throw new Error(`tar: ${tar.stderr.toString().trim()}`);
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    return dir;
  })();
  return tarballDir;
}

/** Pinned bytes of `entry` and where they came from. */
export async function obtain(
  lock: LockFile,
  entry: LockEntry,
  repo = REPO,
): Promise<{ bytes: Uint8Array; from: string; action: "fetched" | "copied" }> {
  if (entry.source === "google-fonts") {
    const local = join(repo, lock.sources["google-fonts"].submodule, entry.path);
    if (existsSync(local)) {
      const bytes = new Uint8Array(readFileSync(local));
      if (matches(entry, bytes)) return { bytes, from: local, action: "copied" };
    }
    const url = rawUrl(lock, entry);
    return { bytes: await download(url), from: url, action: "fetched" };
  }
  const dir = await materialSymbols(lock);
  const file = join(dir, entry.path);
  if (!existsSync(file))
    throw new Error(`${lock.sources["material-symbols"].package}: ${entry.path} not in the tarball`);
  return {
    bytes: new Uint8Array(readFileSync(file)),
    from: lock.sources["material-symbols"].tarball,
    action: "fetched",
  };
}

/** Bring every entry to its pinned content (or only report, with `check`). */
export async function sync(options: { check?: boolean; lock?: LockFile; dir?: string } = {}): Promise<Result[]> {
  const lock = options.lock ?? readLock();
  const dir = options.dir ?? UPSTREAM_DIR;
  const errors = validateLock(lock);
  if (errors.length) throw new Error(`fonts.lock.json: ${errors.join("; ")}`);
  const results: Result[] = [];
  for (const entry of lock.files) {
    const state = status(entry, dir);
    if (state === "ok" || options.check) {
      results.push({ dest: entry.dest, status: state });
      continue;
    }
    // Finish verification and the atomic rename before fetching the next pinned font.
    // oxlint-disable-next-line no-await-in-loop
    const { bytes, from, action } = await obtain(lock, entry);
    if (!matches(entry, bytes))
      throw new Error(
        `${entry.dest}: ${from} has sha256 ${sha256(bytes)} (${bytes.length} B), pinned ${entry.sha256} (${entry.bytes} B)`,
      );
    const target = join(dir, entry.dest);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.partial`, bytes);
    renameSync(`${target}.partial`, target);
    results.push({ dest: entry.dest, status: "ok", action, from });
  }
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  try {
    const results = await sync({ check });
    const bad = results.filter(r => r.status !== "ok");
    const flags = new Set(args);
    if (flags.has("--json")) console.log(JSON.stringify({ dir: UPSTREAM_DIR, check, results }, null, 2));
    else if (!args.includes("--quiet") || bad.length) {
      for (const r of results)
        if (r.action || r.status !== "ok" || !args.includes("--quiet"))
          console.log(
            `${r.status.padEnd(8)} ${r.action ?? ""} ${r.dest}${r.from ? ` <- ${r.from}` : ""}`.replace(/ {2,}/g, " "),
          );
      console.log(
        `fonts-sync: ${results.length - bad.length}/${results.length} files pinned in ${UPSTREAM_DIR}${bad.length ? ` (${bad.length} ${check ? "missing or different: run bun scripts/m3/fonts-sync.ts" : "failed"})` : ""}`,
      );
    }
    process.exit(bad.length ? 1 : 0);
  } catch (error) {
    console.error(`fonts-sync: ${(error as Error).message}`);
    process.exit(1);
  }
}
