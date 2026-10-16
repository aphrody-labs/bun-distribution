// SPDX-License-Identifier: Apache-2.0
/** Preserve pinned root license and notice files without reading delegated UI. */
import { execFileSync } from "@aphrody/update/process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type Root = { key: string; policy: string; head: string; sourcePath: string };
type Entry = {
  source: string;
  target: string | null;
  status: string;
  sha256?: string;
  importedTarget?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
  sourceLicenseTarget?: string;
  sourceLicenseAliasOf?: string;
  sourceLicenseBlobSha256?: string;
};

function git(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRootLicense(name: string): boolean {
  return /^(?:LICENSE|NOTICE|COPYING)(?:[.-][A-Za-z0-9._-]+)?$/i.test(name);
}

export async function importSourceLicenses(sourceRoot: string, targetRoot: string): Promise<Record<string, unknown>> {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  const mapPath = join(target, "docs/migration/source-map.json");
  const sourceMap = JSON.parse(await readFile(mapPath, "utf8")) as {
    roots: Root[];
    entries: Entry[];
  };
  const canonicalByHash = new Map<string, { source: string; target: string }>();
  const planned: Array<{
    source: string;
    sourceHead: string;
    sourceBlob: string;
    sourceStatus: string;
    target: string;
    aliasOf: string | null;
    sha256: string;
    worktreeSha256: string;
    worktreeRelation: "raw" | "git-filtered";
    bytes: Buffer;
    entry: Entry;
    existing: boolean;
  }> = [];
  const missingRootLicense: string[] = [];

  for (const root of sourceMap.roots) {
    if (root.key === "aphrody-ui" || root.key === "src-root-docs") continue;
    const pinnedUpstreamOxc = root.key === "oxc" && root.policy === "upstream-pinned";
    if (root.policy !== "extract" && root.policy !== "orchestrator-split" && !pinnedUpstreamOxc) continue;
    if (!/^[a-z0-9-]+$/.test(root.key) || !/^[0-9a-f]{40}$/.test(root.head))
      throw new Error(`invalid source root identity: ${root.key}`);
    const expectedPath = root.key === "iecode" ? "../iecode" : `src/${root.key}`;
    if (root.sourcePath !== expectedPath) throw new Error(`unexpected source path for ${root.key}: ${root.sourcePath}`);
    const sourcePath = root.key === "iecode" ? resolve(source, "../iecode") : join(source, root.key);
    const rootEntries = sourceMap.entries
      .filter(entry => entry.source.startsWith(`${root.key}/`))
      .filter(entry => isRootLicense(entry.source.slice(root.key.length + 1)))
      .toSorted((a, b) => a.source.localeCompare(b.source));
    if (rootEntries.length === 0) missingRootLicense.push(root.key);
    for (const entry of rootEntries) {
      const name = entry.source.slice(root.key.length + 1);
      const spec = `${root.head}:${name}`;
      const bytes = git(sourcePath, ["show", spec]);
      const sourceBlob = git(sourcePath, ["rev-parse", spec]).toString("utf8").trim();
      const sha256 = hash(bytes);
      // oxlint-disable-next-line no-await-in-loop -- license files are hashed one at a time in manifest order
      const worktreeSha256 = hash(await readFile(join(sourcePath, name)));
      const rawWorktreeBlob = git(sourcePath, ["hash-object", "--no-filters", name]).toString("utf8").trim();
      const normalizedWorktreeBlob = git(sourcePath, ["hash-object", "--path", name, name]).toString("utf8").trim();
      if (rawWorktreeBlob !== sourceBlob && normalizedWorktreeBlob !== sourceBlob)
        throw new Error(`license worktree differs from pinned Git blob: ${entry.source}`);
      const worktreeRelation = rawWorktreeBlob === sourceBlob ? "raw" : "git-filtered";
      if (entry.sourceLicenseBlobSha256 && entry.sourceLicenseBlobSha256 !== sha256)
        throw new Error(`recorded pinned license hash changed: ${entry.source}`);
      if (entry.sha256 && entry.sha256 !== worktreeSha256 && entry.sha256 !== sha256)
        throw new Error(`source map worktree hash differs from license: ${entry.source}`);
      const canonical = canonicalByHash.get(sha256);
      const destination = canonical?.target ?? `docs/migration/source-licenses/${root.key}/${name}`;
      if (!canonical)
        canonicalByHash.set(sha256, {
          source: entry.source,
          target: destination,
        });
      const targetPath = resolve(target, destination);
      if (!targetPath.startsWith(`${target}/`)) throw new Error(`license path escapes target: ${entry.source}`);
      const existing = existsSync(targetPath);
      // oxlint-disable-next-line no-await-in-loop -- targets are compared in manifest order (sequential reads of the existing license files)
      if (existing && hash(await readFile(targetPath)) !== sha256)
        throw new Error(`license target conflict: ${destination}`);
      planned.push({
        source: entry.source,
        sourceHead: root.head,
        sourceBlob,
        sourceStatus: entry.status,
        target: destination,
        aliasOf: canonical?.source ?? null,
        sha256,
        worktreeSha256,
        worktreeRelation,
        bytes,
        entry,
        existing,
      });
    }
  }

  for (const item of planned) {
    const destination = resolve(target, item.target);
    if (!item.existing && !item.aliasOf) {
      // oxlint-disable-next-line no-await-in-loop -- license files are written in manifest order; each write must finish before the next
      await mkdir(dirname(destination), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- license files are written in manifest order; each write must finish before the next
      await writeFile(destination, item.bytes, { flag: "wx" });
    }
    item.entry.sha256 = item.worktreeSha256;
    item.entry.sourceLicenseBlobSha256 = item.sha256;
    item.entry.sourceLicenseTarget = item.target;
    if (item.aliasOf) item.entry.sourceLicenseAliasOf = item.aliasOf;
    else delete item.entry.sourceLicenseAliasOf;
    if (!item.entry.importedTarget && !item.entry.importedSha256) {
      item.entry.target = item.target;
      item.entry.importedSha256 = item.sha256;
      item.entry.importedSourceSha256 = item.worktreeSha256;
    }
  }
  await writeFile(mapPath, `${JSON.stringify(sourceMap)}\n`);
  const report = {
    observedAt: new Date().toISOString(),
    sourceRoot: source,
    targetRoot: target,
    sourceFileCount: planned.length,
    canonicalFileCount: canonicalByHash.size,
    copied: planned.filter(item => !item.existing && !item.aliasOf).length,
    missingRootLicense,
    policy:
      "Pinned Git blobs only; delegated UI and deferred repositories are excluded. Exact byte duplicates share a recorded canonical target.",
    files: planned.map(({ bytes: _bytes, entry: _entry, existing: _existing, ...item }) => item),
  };
  const reportPath = "docs/migration/source-licenses-import.json";
  await writeFile(join(target, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  return {
    sourceFileCount: report.sourceFileCount,
    canonicalFileCount: report.canonicalFileCount,
    copied: report.copied,
    missingRootLicense,
    report: reportPath,
  };
}
