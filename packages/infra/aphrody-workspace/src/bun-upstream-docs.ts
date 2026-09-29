// SPDX-License-Identifier: Apache-2.0
/**
 * Cross-platform Bun documentation updater.
 * Unified implementation replacing update-bun-docs.ps1 & update-bun-docs.sh.
 *
 * Usage:
 *   bun scripts/n2b/update-bun-docs.ts [ref]
 */
import { resolve, join } from "node:path";
import { rm, mkdir, cp, readFile, writeFile, readdir, stat } from "node:fs/promises";

export async function runBunUpstreamDocs(args: string[]): Promise<number> {
  let ref = "main";
  let repoRoot = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repoRoot = args[++index] ?? "";
    else if (arg === "--ref") ref = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops bun-upstream-docs [--root <repository>] [--ref <branch-or-tag>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repoRoot || !ref) throw new Error("--root and --ref require a value");
  repoRoot = resolve(repoRoot);
  const upstream = join(repoRoot, "upstream", "bun");
  const docsOut = join(repoRoot, "docs", "n2b", "bun");

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

  // 2. Extract docs/n2b/bun/
  await rm(docsOut, { recursive: true, force: true });
  await mkdir(docsOut, { recursive: true });
  await cp(join(upstream, "docs"), docsOut, { recursive: true });

  // 3. Strip binary/asset files recursively
  async function cleanAssets(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["icons", "images", "logo"].includes(entry.name.toLowerCase())) {
          await rm(fullPath, { recursive: true, force: true });
        } else {
          await cleanAssets(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
        if (ASSET_EXTENSIONS.has(ext)) {
          await rm(fullPath, { force: true });
        }
      }
    }
  }
  await cleanAssets(docsOut);

  // 4. Update the pin row in docs/n2b/README.md
  const readmePath = join(repoRoot, "docs", "n2b", "README.md");
  try {
    let readme = await readFile(readmePath, "utf8");
    const pattern = /^(\| `bun\/` \| `oven-sh\/bun` · `docs\/` \| ).*?(\|)$/m;
    const newLine = `$1${ref} \`${newSha}\` (${newDate}) $2`;
    if (pattern.test(readme)) {
      readme = readme.replace(pattern, newLine);
      await writeFile(readmePath, readme, "utf8");
      console.log("Updated docs/n2b/README.md pin table.");
    } else {
      console.warn("docs/n2b/README.md has no `bun/` pin row; update it by hand.");
    }
  } catch (e) {
    console.warn("Could not update docs/n2b/README.md:", e);
  }

  console.log("Bun documentation successfully updated.");
  return 0;
}

if (import.meta.main) process.exit(await runBunUpstreamDocs(process.argv.slice(2)));
