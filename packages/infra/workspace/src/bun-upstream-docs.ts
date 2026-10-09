// SPDX-License-Identifier: Apache-2.0
/**
 * Mirrors the Bun documentation site (`docs/` of the aphrody-labs/bun fork, upstream oven-sh/bun) into
 * `docs/reference/upstream-bun`, the corpus served by the `bun_docs_*` MCP tools.
 *
 * Usage: bun packages/infra/workspace/src/bun-upstream-docs.ts [--root <repository>]
 *          [--source <bun checkout>] [--ref <branch-or-tag>] [--check]
 *
 * Source: `--source`, else `APHRODY_BUN_CHECKOUT`, else `C:\bun` on Windows when it exists; otherwise a
 * shallow clone of aphrody-labs/bun at `--ref` under `APHRODY_BUN_MIRROR` (`~/.cache/aphrody/upstream/bun`).
 * Only `docs/` is copied (pages, `docs.json`, snippets); binary assets and the `icons`, `images` and
 * `logo` directories are skipped. Outside `docs/` only the repository `LICENSE.md` is copied (release legal
 * notice); repository READMEs and test fixtures never enter.
 * The mirror is exact: stale pages are deleted, except the first-party files in `KEEP`.
 * `SOURCE.json` records the source commit and a SHA-256 per file; `--check` compares without writing.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export const BUN_DOCS_TARGET = "docs/reference/upstream-bun";
const FORK_URL = "https://github.com/aphrody-labs/bun.git";
const KEEP = new Set(["APHRODY-FORK.md", "SOURCE.json"]);
/** Repository-root files mirrored next to the docs (Bun licence, shipped by scripts/release/release.ts). */
const ROOT_FILES = ["LICENSE.md"];
const SKIPPED_DIRECTORIES = new Set(["icons", "images", "logo"]);
const SKIPPED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".pdf",
]);

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

/** `--source`, `APHRODY_BUN_CHECKOUT`, `C:\bun` (Windows), else undefined (clone the fork). */
export function localBunCheckout(
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string | undefined {
  if (explicit) return resolve(explicit);
  if (env.APHRODY_BUN_CHECKOUT) return resolve(env.APHRODY_BUN_CHECKOUT);
  if (platform === "win32" && existsSync("C:\\bun\\docs\\docs.json")) return "C:\\bun";
  return undefined;
}

/** Whether a path relative to `docs/` belongs to the mirror. */
export function isMirroredDoc(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  if (parts.slice(0, -1).some(part => SKIPPED_DIRECTORIES.has(part.toLowerCase()))) return false;
  const name = parts.at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 || !SKIPPED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join("/"));
  }
  return out.toSorted();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function cloneFork(ref: string): Promise<string> {
  const mirror = process.env.APHRODY_BUN_MIRROR ?? join(homedir(), ".cache", "aphrody", "upstream", "bun");
  if (existsSync(join(mirror, ".git"))) {
    git(mirror, ["fetch", "--depth", "1", "origin", ref]);
    git(mirror, ["reset", "--hard", "FETCH_HEAD"]);
  } else {
    await rm(mirror, { recursive: true, force: true });
    await mkdir(dirname(mirror), { recursive: true });
    const clone = Bun.spawnSync(["git", "clone", "--quiet", "--depth", "1", "--branch", ref, FORK_URL, mirror], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (clone.exitCode !== 0) throw new Error(`git clone ${FORK_URL} failed: ${clone.stderr}`);
  }
  return mirror;
}

export async function runBunUpstreamDocs(args: string[]): Promise<number> {
  let ref = "main";
  let repoRoot = process.cwd();
  let source: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repoRoot = args[++index] ?? "";
    else if (arg === "--ref") ref = args[++index] ?? "";
    else if (arg === "--source") source = args[++index] ?? "";
    else if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun packages/infra/workspace/src/bun-upstream-docs.ts [--root <repository>] [--source <bun checkout>] [--ref <branch-or-tag>] [--check]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repoRoot || !ref || source === "") throw new Error("--root, --ref and --source require a value");
  repoRoot = resolve(repoRoot);
  const checkout = localBunCheckout(source) ?? (await cloneFork(ref));
  const docs = join(checkout, "docs");
  if (!existsSync(join(docs, "docs.json"))) throw new Error(`${docs} is not the Bun docs site (no docs.json)`);
  const commit = git(checkout, ["log", "-1", "--format=%H", "--", "docs"]);
  const date = git(checkout, ["log", "-1", "--format=%cs", "--", "docs"]);
  const target = join(repoRoot, BUN_DOCS_TARGET);

  const files: Record<string, string> = {};
  const contents = new Map<string, Uint8Array>();
  const sources = (await listFiles(docs)).filter(isMirroredDoc).map((rel): [string, string] => [rel, join(docs, rel)]);
  for (const name of ROOT_FILES) sources.push([name, join(checkout, name)]);
  for (const [rel, path] of sources) {
    const bytes = await Bun.file(path).bytes();
    files[rel] = sha256(bytes);
    contents.set(rel, bytes);
  }
  const existing = (await listFiles(target)).filter(rel => !KEEP.has(rel));
  const stale = existing.filter(rel => !(rel in files));
  const changed: string[] = [];
  for (const [rel, hash] of Object.entries(files)) {
    const path = join(target, rel);
    if (!existsSync(path) || sha256(await Bun.file(path).bytes()) !== hash) changed.push(rel);
  }
  const receipt = {
    source: "https://github.com/aphrody-labs/bun (fork of https://github.com/oven-sh/bun)",
    path: "docs/",
    commit,
    date,
    command: "bun packages/infra/workspace/src/bun-upstream-docs.ts --root .",
    files,
  };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptPath = join(target, "SOURCE.json");
  const receiptStale = !existsSync(receiptPath) || (await Bun.file(receiptPath).text()) !== receiptText;
  const summary = `${Object.keys(files).length} files from ${checkout} docs/ @ ${commit.slice(0, 11)} (${date}): ${changed.length} changed, ${stale.length} stale`;
  if (check) {
    const ok = changed.length === 0 && stale.length === 0 && !receiptStale;
    console.log(`${ok ? "current" : "stale"} ${BUN_DOCS_TARGET}: ${summary}`);
    return ok ? 0 : 1;
  }
  for (const rel of stale) await rm(join(target, rel), { force: true });
  for (const rel of changed) await Bun.write(join(target, rel), contents.get(rel) ?? new Uint8Array());
  await Bun.write(receiptPath, receiptText);
  // Drop directories emptied by stale deletions.
  for (const dir of [...new Set(stale.map(rel => dirname(join(target, rel))))].toSorted(
    (a, b) => b.length - a.length,
  )) {
    for (let current = dir; current.startsWith(target) && current !== target; current = dirname(current)) {
      if (!existsSync(current) || (await readdir(current)).length > 0) break;
      if ((await stat(current)).isDirectory()) await rm(current, { recursive: true });
    }
  }
  console.log(`Mirrored ${BUN_DOCS_TARGET}: ${summary}`);
  return 0;
}

if (import.meta.main) process.exit(await runBunUpstreamDocs(process.argv.slice(2)));
