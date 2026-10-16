// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

type Fingerprint = { sha256: string; size: number };
type RetiredFile = Fingerprint & { canonicalPath: string };
type ArchiveManifest = {
  schemaVersion: 1;
  date: string;
  upstream: string;
  source: string;
  canonical: string;
  license: string;
  exactFileCount: number;
  exactByteCount: number;
  files: Record<string, RetiredFile>;
};

const sourceRel = "packages/aphrody-spaceui/packages/icons";
const canonicalRel = "packages/assets";
const ignoredDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  "ui-dist",
]);
const archiveMetadata = new Set(["README.md", "RETIRED-DUPLICATES.json"]);

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function inventory(root: string): Promise<Map<string, Fingerprint>> {
  const files = new Map<string, Fingerprint>();

  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory() && ignoredDirs.has(entry.name)) return 0;
        const filePath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(filePath);
        } else if (entry.isFile()) {
          const content = await readFile(filePath);
          const path = relative(root, filePath).split(sep).join("/");
          files.set(path, {
            sha256: sha256(content),
            size: content.byteLength,
          });
        }
      }),
    );
  }

  await walk(root);
  return files;
}

async function loadManifest(
  manifestPath: string,
): Promise<ArchiveManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as ArchiveManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..")
  );
}

async function verifyManifest(
  manifest: ArchiveManifest,
  sourceFiles: Map<string, Fingerprint>,
  canonicalRoot: string,
) {
  if (manifest.schemaVersion !== 1)
    throw new Error("Unsupported retired icon manifest version");

  await Promise.all(
    Object.entries(manifest.files).map(async ([path, retired]) => {
      if (!safeRelativePath(path))
        throw new Error(`Unsafe retired path in manifest: ${path}`);
      const canonicalPath = join(canonicalRoot, path);
      const canonical = await readFile(canonicalPath).catch(() => null);
      if (
        !canonical ||
        sha256(canonical) !== retired.sha256 ||
        canonical.byteLength !== retired.size
      ) {
        throw new Error(
          `Canonical counterpart changed or is missing: ${canonicalRel}/${path}`,
        );
      }
      if (sourceFiles.has(path)) {
        const current = sourceFiles.get(path)!;
        if (
          current.sha256 !== retired.sha256 ||
          current.size !== retired.size
        ) {
          throw new Error(
            `Refusing to retire modified reference file: ${sourceRel}/${path}`,
          );
        }
      }
    }),
  );
}

async function writeManifest(manifest: ArchiveManifest, manifestPath: string) {
  const temporary = `${manifestPath}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporary, manifestPath);
}

async function removeDuplicateFiles(
  manifest: ArchiveManifest,
  sourceRoot: string,
) {
  const candidates = Object.keys(manifest.files).toSorted((a, b) =>
    a.localeCompare(b),
  );
  const verifiedPaths = await Promise.all(
    candidates.map(async (path) => {
      const fullPath = join(sourceRoot, path);
      const current = await readFile(fullPath).catch(() => null);
      if (!current) return null;
      const expected = manifest.files[path]!;
      if (
        sha256(current) !== expected.sha256 ||
        current.byteLength !== expected.size
      ) {
        throw new Error(
          `Refusing to remove changed reference file: ${sourceRel}/${path}`,
        );
      }
      return fullPath;
    }),
  );
  await Promise.all(
    verifiedPaths
      .filter((path): path is string => path !== null)
      .map((path) => rm(path)),
  );
}

export async function runSpaceUiIcons(args: string[]): Promise<number> {
  let repo = process.cwd();
  let mode = "--plan";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--root") repo = args[++index] ?? "";
    else if (["--plan", "--prune", "--check", "--help"].includes(arg))
      mode = arg;
    else
      throw new Error(`Unknown mode ${arg}; use --plan, --prune, or --check`);
  }
  if (!repo) throw new Error("--root requires an aphrody-ui repository path");
  repo = resolve(repo);
  const sourceRoot = join(repo, sourceRel);
  const canonicalRoot = join(repo, canonicalRel);
  const manifestPath = join(sourceRoot, "RETIRED-DUPLICATES.json");
  if (mode === "--help") {
    console.log(
      "Usage: bun scripts/archive-spaceui-icons.ts [--plan|--prune|--check]",
    );
    return 0;
  }

  const [sourceFiles, canonicalFiles, manifest] = await Promise.all([
    inventory(sourceRoot),
    inventory(canonicalRoot),
    loadManifest(manifestPath),
  ]);
  const exact = [...sourceFiles.entries()]
    .filter(([path, fingerprint]) => {
      const canonical = canonicalFiles.get(path);
      return (
        canonical !== undefined &&
        canonical.sha256 === fingerprint.sha256 &&
        canonical.size === fingerprint.size
      );
    })
    .toSorted(([a], [b]) => a.localeCompare(b));
  const divergent = [...sourceFiles.keys()].filter(
    (path) =>
      canonicalFiles.has(path) && !exact.some(([same]) => same === path),
  );
  const sourceOnly = [...sourceFiles.keys()].filter(
    (path) => !canonicalFiles.has(path) && !archiveMetadata.has(path),
  );

  if (mode === "--plan") {
    const totalBytes = exact.reduce((sum, [, file]) => sum + file.size, 0);
    console.log(`Exact duplicates: ${exact.length} files, ${totalBytes} bytes`);
    console.log(`Divergent same-path files: ${divergent.length}`);
    console.log(`SpaceUI-only reference files: ${sourceOnly.length}`);
    console.log(
      `MIT notices: ${join(repo, "packages/aphrody-spaceui/LICENSE")} and ${join(repo, "packages/assets/LICENSE.spaceui")}`,
    );
    if (manifest)
      console.log(`Archive manifest already exists at ${manifestPath}`);
    return 0;
  }

  if (mode === "--check") {
    if (!manifest) throw new Error(`Missing archive manifest: ${manifestPath}`);
    await verifyManifest(manifest, sourceFiles, canonicalRoot);
    if (exact.length > 0)
      throw new Error(
        `${exact.length} exact copies remain or have been reintroduced; review before pruning`,
      );
    console.log(
      `Verified ${manifest.exactFileCount} retired icon files (${manifest.exactByteCount} bytes); ${divergent.length} divergent and ${sourceOnly.length} unique reference files remain.`,
    );
    return 0;
  }

  if (
    !(await stat(join(repo, "packages/aphrody-spaceui/LICENSE")).catch(
      () => null,
    ))
  ) {
    throw new Error("SpaceUI MIT source notice is missing");
  }
  if (!(await stat(join(canonicalRoot, "LICENSE.spaceui")).catch(() => null))) {
    throw new Error("Canonical assets MIT notice is missing");
  }

  let archive = manifest;
  if (archive) {
    await verifyManifest(archive, sourceFiles, canonicalRoot);
    const unrecordedExact = exact.filter(([path]) => !(path in archive!.files));
    if (unrecordedExact.length > 0)
      throw new Error(
        "Unrecorded exact copies found; rerun --plan and review first",
      );
  } else {
    const files = Object.fromEntries(
      exact.map(([path, file]) => [
        path,
        { ...file, canonicalPath: `${canonicalRel}/${path}` },
      ]),
    ) as Record<string, RetiredFile>;
    archive = {
      schemaVersion: 1,
      date: new Date().toISOString().slice(0, 10),
      upstream:
        "spacedriveapp/spaceui (commit recorded in packages/aphrody-spaceui/UPSTREAM.txt)",
      source: sourceRel,
      canonical: canonicalRel,
      license:
        "MIT; notices retained in packages/aphrody-spaceui/LICENSE and packages/assets/LICENSE.spaceui",
      exactFileCount: exact.length,
      exactByteCount: exact.reduce((sum, [, file]) => sum + file.size, 0),
      files,
    };
  }

  await verifyManifest(archive, sourceFiles, canonicalRoot);
  await writeManifest(archive, manifestPath);
  await removeDuplicateFiles(archive, sourceRoot);
  const remainingSource = await inventory(sourceRoot);
  await verifyManifest(archive, remainingSource, canonicalRoot);
  if ([...remainingSource.keys()].some((path) => path in archive!.files)) {
    throw new Error("Some manifest-listed files could not be retired");
  }
  console.log(
    `Retired ${archive.exactFileCount} exact duplicate files (${archive.exactByteCount} bytes); unique and divergent files are preserved.`,
  );
  return 0;
}

if (import.meta.main)
  process.exit(await runSpaceUiIcons(process.argv.slice(2)));
