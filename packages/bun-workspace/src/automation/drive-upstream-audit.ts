// SPDX-License-Identifier: Apache-2.0
/**
 * Read-only Git blob comparison against a pinned Spacedrive revision.
 *
 * Usage:
 *   bun scripts/audit-drive-upstream.ts [--revision <40-char-sha>]
 *   bun scripts/audit-drive-upstream.ts --list [--drive-root ../aphrody-os/drive]
 *   bun scripts/audit-drive-upstream.ts --json
 *   bun scripts/audit-drive-upstream.ts --owner os/drive-engine --fail-on-missing
 *
 * GitHub's recursive tree describes source presence; local Git-style SHA-1 hashes
 * distinguish unchanged files from modified files without a checkout of upstream.
 * Product behavior, data migration and installed hosts require separate review.
 */
import { join, resolve } from "node:path";
import { readlink } from "node:fs/promises";

const DEFAULT_REVISION = "6dfeccf2113039e35f2ce735f945e70dc3e4ea45";

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

interface GitTree {
  sha: string;
  truncated: boolean;
  tree: TreeEntry[];
}

interface Comparison {
  upstreamPath: string;
  localPath: string;
  owner: string;
  status: "identical" | "changed" | "missing" | "unreadable";
  upstreamSha: string;
  localSha?: string;
  error?: string;
}

interface Options {
  revision: string;
  repositoryRoot: string;
  driveRoot: string;
  owner: string | null;
  json: boolean;
  list: boolean;
  failOnMissing: boolean;
}

function parseOptions(args: string[]): Options {
  let revision = DEFAULT_REVISION;
  let repositoryRoot = process.cwd();
  let driveRoot: string | undefined;
  let owner: string | null = null;
  let json = false;
  let list = false;
  let failOnMissing = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--revision": {
        const value = args[++index];
        if (!value || !/^[0-9a-f]{40}$/i.test(value)) {
          throw new Error("--revision requires a full 40-character Git SHA");
        }
        revision = value.toLowerCase();
        break;
      }
      case "--root": {
        const value = args[++index];
        if (!value) throw new Error("--root requires a repository directory");
        repositoryRoot = resolve(value);
        break;
      }
      case "--drive-root": {
        const value = args[++index];
        if (!value) throw new Error("--drive-root requires a directory");
        driveRoot = value;
        break;
      }
      case "--owner": {
        const value = args[++index];
        if (!value) throw new Error("--owner requires a category name");
        owner = value;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--list":
        list = true;
        break;
      case "--fail-on-missing":
        failOnMissing = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: yolo ops drive-upstream-audit [--root <aphrody-ui>] [--revision <40-char-sha>] [--drive-root <path>] [--owner <owner>] [--json] [--list] [--fail-on-missing]",
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  repositoryRoot = resolve(repositoryRoot);
  return {
    revision,
    repositoryRoot,
    driveRoot: resolve(repositoryRoot, driveRoot ?? "drive"),
    owner,
    json,
    list,
    failOnMissing,
  };
}

function localSource(entry: TreeEntry, repositoryRoot: string, driveRoot: string): { path: string; owner: string } {
  if (entry.path.startsWith("packages/assets/")) {
    return { path: join(repositoryRoot, entry.path), owner: "ui/assets" };
  }
  if (entry.path.startsWith("apps/mobile/")) {
    return { path: join(driveRoot, entry.path), owner: "ui/mobile-host" };
  }
  if (entry.path.startsWith("apps/tauri/")) {
    return {
      path: join(driveRoot, entry.path),
      owner: "ui/desktop-host-replacement",
    };
  }
  if (entry.path.startsWith("apps/server/")) {
    return { path: join(driveRoot, entry.path), owner: "web/site" };
  }
  if (
    entry.path.startsWith("crates/infra/aphrody/") ||
    entry.path.startsWith("core/") ||
    entry.path.startsWith("crates/") ||
    entry.path.startsWith("adapters/")
  ) {
    return { path: join(driveRoot, entry.path), owner: "os/drive-engine" };
  }
  if (entry.path.startsWith("packages/interface/")) {
    return { path: join(driveRoot, entry.path), owner: "ui/source-archive" };
  }
  return { path: join(driveRoot, entry.path), owner: "upstream/archive" };
}

async function gitBlobSha(path: string, mode: string): Promise<string | null> {
  let bytes: Uint8Array;
  if (mode === "120000") {
    try {
      bytes = new TextEncoder().encode(await readlink(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  } else {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(`blob ${bytes.byteLength}\0`);
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function fetchTree(revision: string): Promise<GitTree> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aphrody-drive-upstream-audit",
  };
  const token = Bun.env.GH_TOKEN ?? Bun.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `https://api.github.com/repos/spacedriveapp/spacedrive/git/trees/${revision}?recursive=1`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`GitHub tree request failed: HTTP ${response.status}`);
  }
  const tree = (await response.json()) as GitTree;
  if (tree.truncated) throw new Error("GitHub returned a truncated tree; audit would be incomplete");
  if (!Array.isArray(tree.tree) || tree.sha !== revision) {
    throw new Error("GitHub response does not match the requested revision");
  }
  return tree;
}

async function compare(entry: TreeEntry, repositoryRoot: string, driveRoot: string): Promise<Comparison> {
  const local = localSource(entry, repositoryRoot, driveRoot);
  try {
    const localSha = await gitBlobSha(local.path, entry.mode);
    return {
      upstreamPath: entry.path,
      localPath: local.path,
      owner: local.owner,
      status: localSha === null ? "missing" : localSha === entry.sha ? "identical" : "changed",
      upstreamSha: entry.sha,
      ...(localSha ? { localSha } : {}),
    };
  } catch (error) {
    return {
      upstreamPath: entry.path,
      localPath: local.path,
      owner: local.owner,
      status: "unreadable",
      upstreamSha: entry.sha,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDriveUpstreamAudit(args: string[]): Promise<number> {
  const options = parseOptions(args);
  const tree = await fetchTree(options.revision);
  const allBlobs = tree.tree.filter(
    entry => entry.type === "blob" && ["100644", "100755", "120000"].includes(entry.mode),
  );
  const blobs = options.owner
    ? allBlobs.filter(entry => localSource(entry, options.repositoryRoot, options.driveRoot).owner === options.owner)
    : allBlobs;
  if (options.owner && blobs.length === 0) throw new Error(`Unknown or empty owner: ${options.owner}`);
  // Bound concurrent reads; a whole upstream tree can contain several thousand blobs.
  const results: Comparison[] = [];
  const width = 32;
  for (let index = 0; index < blobs.length; index += width) {
    results.push(
      // oxlint-disable-next-line no-await-in-loop -- bounded batches avoid opening thousands of files at once.
      ...(await Promise.all(
        blobs.slice(index, index + width).map(entry => compare(entry, options.repositoryRoot, options.driveRoot)),
      )),
    );
  }
  const counts = { identical: 0, changed: 0, missing: 0, unreadable: 0 };
  const byOwner: Record<string, typeof counts> = {};
  for (const result of results) {
    counts[result.status] += 1;
    const bucket = (byOwner[result.owner] ??= {
      identical: 0,
      changed: 0,
      missing: 0,
      unreadable: 0,
    });
    bucket[result.status] += 1;
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          revision: options.revision,
          entries: tree.tree.length,
          totalBlobs: allBlobs.length,
          blobs: blobs.length,
          counts,
          byOwner,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Spacedrive ${options.revision} (${blobs.length} file blobs)`);
    for (const [owner, bucket] of Object.entries(byOwner).toSorted()) {
      console.log(
        `${owner}: ${bucket.identical} identical, ${bucket.changed} changed, ${bucket.missing} missing, ${bucket.unreadable} unreadable`,
      );
    }
    if (options.list) {
      for (const result of results.filter(item => item.status !== "identical")) {
        console.log(`${result.status}\t${result.owner}\t${result.upstreamPath}`);
      }
    }
    for (const result of results.filter(item => item.status === "unreadable")) {
      console.error(`Unreadable ${result.localPath}: ${result.error}`);
    }
  }
  return counts.unreadable || (options.failOnMissing && counts.missing) ? 1 : 0;
}

if (import.meta.main) process.exit(await runDriveUpstreamAudit(process.argv.slice(2)));
