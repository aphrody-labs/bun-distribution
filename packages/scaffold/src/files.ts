// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Relative path to content. Paths use `/`. */
export type FileMap = Record<string, string | Uint8Array>;

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/**
 * - `new`: the directory must not exist (what `m3 new` promises).
 * - `empty`: the directory is absent or empty.
 * - `merge`: any directory; a file that already exists is an error, nothing is overwritten.
 * - `overwrite`: existing files are replaced (migration output refreshed in place).
 */
export type WriteMode = "new" | "empty" | "merge" | "overwrite";

/** Writes `files` under `outDir` and returns the absolute paths written. Checks every path before writing any. */
export async function writeFiles(
  outDir: string,
  files: FileMap,
  mode: WriteMode = "empty",
): Promise<string[]> {
  const root = resolve(outDir);
  if (mode === "new" && existsSync(root)) throw new ScaffoldError(`${root} already exists`);
  if (mode === "empty" && existsSync(root) && (await readdir(root)).length > 0) {
    throw new ScaffoldError(`${root} is not empty`);
  }
  const targets = Object.keys(files).map((path) => {
    if (path.startsWith("/") || path.split("/").includes(".."))
      throw new ScaffoldError(`unsafe path in template: ${path}`);
    return { path, full: join(root, path) };
  });
  if (mode === "merge") {
    const clash = targets.find((target) => existsSync(target.full));
    if (clash) throw new ScaffoldError(`refusing to overwrite ${clash.full}`);
  }
  const written: string[] = [];
  for (const { path, full } of targets) {
    if (typeof Bun !== "undefined") {
      await Bun.write(full, files[path] as string | Uint8Array);
    } else {
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, files[path] as string | Uint8Array);
    }
    written.push(full);
  }
  if (targets.length === 0) await mkdir(root, { recursive: true });
  return written;
}
