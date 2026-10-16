// SPDX-License-Identifier: Apache-2.0
/** Git-aware cleanup. Tracked sources and symlink targets are never removed. */
import { readdir, lstat, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ARTIFACTS = new Set([
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  ".vite",
  ".parcel-cache",
  "coverage",
]);
const PRUNED = new Set([".git", "node_modules", ".venv", "venv"]);
export type CleanupEntry = { path: string; bytes: number; files: number };
export type CleanupReport = {
  root: string;
  apply: boolean;
  removed: CleanupEntry[];
  protected: string[];
  bytes: number;
  files: number;
};

function git(root: string, args: string[]): { code: number; output: string } {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    output: new TextDecoder().decode(result.stdout),
  };
}
function disappeared(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
async function entries(path: string): Promise<string[]> {
  return readdir(path).catch((error: unknown) => {
    if (disappeared(error)) return [];
    throw error;
  });
}
export async function measureArtifact(
  path: string,
): Promise<{ bytes: number; files: number }> {
  const info = await lstat(path).catch((error: unknown) => {
    if (disappeared(error)) return undefined;
    throw error;
  });
  if (!info) return { bytes: 0, files: 0 };
  if (info.isSymbolicLink()) return { bytes: 0, files: 0 };
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  const children = await Promise.all(
    (await entries(path)).map((entry) => measureArtifact(join(path, entry))),
  );
  let bytes = 0,
    files = 0;
  for (const child of children) {
    bytes += child.bytes;
    files += child.files;
  }
  return { bytes, files };
}
export async function cleanWorkspace(
  root: string,
  apply = false,
): Promise<CleanupReport> {
  root = resolve(root);
  const index = git(root, ["ls-files", "-z"]);
  if (index.code !== 0) throw new Error("Cleanup requires a Git worktree");
  const tracked = index.output.split("\0").filter(Boolean);
  const report: CleanupReport = {
    root,
    apply,
    removed: [],
    protected: [],
    bytes: 0,
    files: 0,
  };
  async function visit(current: string): Promise<void> {
    const children = await readdir(current, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (disappeared(error)) return [];
        throw error;
      },
    );
    for (const entry of children) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        PRUNED.has(entry.name)
      )
        continue;
      const full = join(current, entry.name);
      const local = relative(root, full).replaceAll("\\", "/");
      if (ARTIFACTS.has(entry.name)) {
        if (
          tracked.some((file) => file === local || file.startsWith(`${local}/`))
        ) {
          report.protected.push(local);
          // oxlint-disable-next-line no-await-in-loop -- parcours en profondeur séquentiel : l'ordre de report.protected est une sortie déterministe
          await visit(full);
          continue;
        }
        // A directory name alone is insufficient evidence that it is generated.
        const ignored =
          git(root, ["check-ignore", "-q", "--", `${local}/`]).code === 0;
        const pythonCache = entry.name === "__pycache__";
        if (ignored || pythonCache) {
          // oxlint-disable-next-line no-await-in-loop -- suppressions séquentielles : l'ordre de report.removed et des rm est une sortie déterministe
          const size = await measureArtifact(full);
          report.removed.push({ path: local, ...size });
          report.bytes += size.bytes;
          report.files += size.files;
          // oxlint-disable-next-line no-await-in-loop -- suppressions séquentielles, un seul rm à la fois pour un état de disque prévisible
          if (apply) await rm(full, { recursive: true });
          continue;
        }
        report.protected.push(local);
      }
      // oxlint-disable-next-line no-await-in-loop -- parcours en profondeur séquentiel : l'ordre de report.removed/protected est une sortie déterministe
      await visit(full);
    }
  }
  await visit(root);
  return report;
}
export async function runWorkspaceClean(args: string[]): Promise<number> {
  let root = process.cwd(),
    apply = false,
    json = false,
    output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = args[++i] ?? "";
    else if (arg === "--apply") apply = true;
    else if (arg === "--dry-run" || arg === "-d") apply = false;
    else if (arg === "--json") json = true;
    else if (arg === "--out") output = args[++i];
    else if (arg === "--skip-hashes" || arg === "-s") {
      /* retained for old callers */
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops workspace-clean [--root path] [--apply] [--json] [--out report.json]; default: dry run",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a path");
  const report = await cleanWorkspace(root, apply);
  if (output) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else
    console.log(
      `${apply ? "Removed" : "Candidates"}: ${report.removed.length} directories, ${report.files} files, ${report.bytes} bytes; protected: ${report.protected.length}`,
    );
  return 0;
}
if (import.meta.main)
  process.exit(await runWorkspaceClean(process.argv.slice(2)));
