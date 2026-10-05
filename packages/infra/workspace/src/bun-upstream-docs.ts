// SPDX-License-Identifier: Apache-2.0
/**
 * Cross-platform Bun documentation updater.
 * Unified implementation replacing update-bun-docs.ps1 & update-bun-docs.sh.
 *
 * Usage:
 *   bun scripts/n2b/update-bun-docs.ts [ref]
 */
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { rm, mkdir, copyFile, readdir, stat } from "node:fs/promises";

export async function runBunUpstreamDocs(args: string[]): Promise<number> {
  let ref = "main";
  let repoRoot = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repoRoot = args[++index] ?? "";
    else if (arg === "--ref") ref = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops bun-upstream-docs [--root <repository>] [--ref <branch-or-tag>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repoRoot || !ref) throw new Error("--root and --ref require a value");
  repoRoot = resolve(repoRoot);
  // The in-repo upstream/bun fork is gone: mirror outside the repository and write each page to
  // its canonical docs/<category>/upstream-bun location so the import never recreates duplicates.
  const upstream =
    process.env.APHRODY_BUN_MIRROR ?? join(homedir(), ".cache", "aphrody", "upstream", "bun");
  const docsRoot = join(repoRoot, "docs");
  const fallbackOut = join(docsRoot, "reference", "upstream-bun");

  const ASSET_EXTENSIONS = new Set([
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
    ".css",
    ".mp4",
    ".webm",
    ".mov",
    ".gifv",
    ".mp3",
    ".wav",
    ".pdf",
  ]);

  console.log(`=== update-bun-docs (oven-sh/bun @ ${ref}) ===`);

  // 1. Clone or update shallow upstream mirror
  const gitDir = join(upstream, ".git");
  let isCloned = false;
  try {
    await stat(gitDir);
    isCloned = true;
  } catch {
    isCloned = false;
  }

  if (isCloned) {
    console.log("Refreshing existing upstream/bun mirror...");
    const fetch = Bun.spawnSync(["git", "-C", upstream, "fetch", "--depth", "1", "origin", ref]);
    if (fetch.exitCode !== 0) throw new Error("git fetch failed");
    const reset = Bun.spawnSync(["git", "-C", upstream, "reset", "--hard", "FETCH_HEAD"]);
    if (reset.exitCode !== 0) throw new Error("git reset failed");
  } else {
    console.log(`Cloning oven-sh/bun (depth 1, branch ${ref})...`);
    await rm(upstream, { recursive: true, force: true });
    const clone = Bun.spawnSync([
      "git",
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--branch",
      ref,
      "https://github.com/oven-sh/bun.git",
      upstream,
    ]);
    if (clone.exitCode !== 0) throw new Error("git clone failed");
  }

  const shaProc = Bun.spawnSync(["git", "-C", upstream, "rev-parse", "--short=8", "HEAD"]);
  const newSha = new TextDecoder().decode(shaProc.stdout).trim();
  const dateProc = Bun.spawnSync(["git", "-C", upstream, "log", "-1", "--format=%cs"]);
  const newDate = new TextDecoder().decode(dateProc.stdout).trim();

  console.log(`New upstream ref: ${ref} \`${newSha}\` (${newDate})`);

  // 2. Index the canonical location of every page already imported under docs/*/upstream-bun.
  const canonical = new Map<string, string>();
  async function walk(dir: string, base: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, base);
      else if (entry.isFile()) {
        const rel = relative(base, full);
        if (!canonical.has(rel)) canonical.set(rel, full);
      }
    }
  }
  for (const category of await readdir(docsRoot, { withFileTypes: true })) {
    if (category.isDirectory()) {
      const base = join(docsRoot, category.name, "upstream-bun");
      await walk(base, base);
    }
  }

  // 3. Copy upstream docs/ pages (assets stripped) onto their canonical path; new pages go to
  //    docs/reference/upstream-bun. Nothing is deleted, so no second copy is ever created.
  let written = 0;
  async function copyDocs(dir: string, base: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["icons", "images", "logo"].includes(entry.name.toLowerCase()))
          await copyDocs(full, base);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (ASSET_EXTENSIONS.has(ext)) continue;
      const rel = relative(base, full);
      const target = canonical.get(rel) ?? join(fallbackOut, rel);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(full, target);
      written++;
    }
  }
  await copyDocs(join(upstream, "docs"), join(upstream, "docs"));
  console.log(`Wrote ${written} pages for oven-sh/bun ${ref} \`${newSha}\` (${newDate}).`);

  console.log("Bun documentation successfully updated.");
  return 0;
}

if (import.meta.main) process.exit(await runBunUpstreamDocs(process.argv.slice(2)));
