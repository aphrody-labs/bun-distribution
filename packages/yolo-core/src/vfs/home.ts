/**
 * Monorepo root, checkout detection, and YOLO home path resolution.
 * Where the CLI and core libraries live.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Replaced at compile time (`--define YOLO_VERSION='"x.y.z"'`). */
declare const YOLO_VERSION: string | undefined;

const embedded = (path: string): boolean => path.includes("$bunfs") || path.includes("~BUN");

/**
 * True inside the standalone executable. A `--bytecode` build reports the build-time source path as `import.meta.dir`,
 * so the entry module's path (`/$bunfs/root/...`, `B:/~BUN/root/...`) is checked as well.
 */
export function isCompiled(): boolean {
  return embedded(import.meta.dir) || embedded(Bun.main);
}

export function findRepoRoot(start: string = process.cwd()): string {
  const fromEnv = process.env["YOLO_HOME"];
  if (fromEnv !== undefined && fromEnv !== "") return resolve(fromEnv);
  if (isCompiled()) return dirname(dirname(process.execPath));

  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "vendor.toml")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let metaDir = resolve(import.meta.dir);
  for (;;) {
    if (existsSync(join(metaDir, "vendor.toml")) && existsSync(join(metaDir, "package.json"))) {
      return metaDir;
    }
    const parent = dirname(metaDir);
    if (parent === metaDir) break;
    metaDir = parent;
  }

  return resolve(import.meta.dir, "../../../../docs/aphrody/packages");
}

export function yoloHome(): string {
  return findRepoRoot();
}

export function yoloVersion(): string {
  if (typeof YOLO_VERSION !== "undefined" && YOLO_VERSION !== "") return YOLO_VERSION;
  const file = join(yoloHome(), "VERSION");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "0.0.0-dev";
}

/**
 * The yolo checkout that contains `start` (or one of its parents): the directory holding `vendor.toml` and the CLI
 * sources. The installed executable hands source-tree commands (`ship`, `import`, `status`...) to it.
 */
export function findCheckout(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "vendor.toml")) && existsSync(join(dir, "packages/engine/yolo/src/index.ts"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
