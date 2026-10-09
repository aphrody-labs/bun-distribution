// SPDX-License-Identifier: Apache-2.0
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

/** Remove only duplicate fonts whose emitted references are exclusively qualified remote URLs. */
export function prunePublicFontCopies(
  outdir: string,
  sheets: string[],
  base: string,
): { files: number; bytes: number } {
  const remote = new Set<string>();
  const local = new Set<string>();
  const prefix = base.replace(/\/$/, "") + "/m3/fonts/";
  for (const css of sheets)
    for (const match of css.matchAll(/url\(["']?([^"'()]+\.woff2)["']?\)/g)) {
      const url = match[1]!;
      if (url.startsWith(prefix)) remote.add(url.slice(prefix.length));
      else if (url.startsWith("./fonts/")) local.add(url.slice("./fonts/".length));
      else throw new Error("Unqualified font URL prevents public asset trimming");
    }
  const directory = resolve(outdir, "fonts");
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(directory)) {
    if (!/^[\w.-]+\.woff2$/.test(name) || !remote.has(name) || local.has(name)) continue;
    const file = join(directory, name);
    bytes += statSync(file).size;
    unlinkSync(file);
    files++;
  }
  return { files, bytes };
}
