#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Reorganises a private DBXV2 CPK dump into the tree nginx serves (infra/config/host/nginx/private/dbxv2-assets.conf):
 *
 *   <root>/<kind>/<cpk>/<path inside the cpk>[.xz]     kind = models | textures | audio | video | text | data
 *   <root>/meta/<cpk>.json                             per-archive manifest (entries and sizes)
 *   <root>/meta/index.jsonl                            one line per file: cpk, path, kind, size, gzip (false), compression ("xz" when stored as .xz)
 *
 * Files move inside one filesystem (rename, no copy). Compressible kinds are compressed in place
 * with `xz -9e --threads=1` and served as plain application/x-xz files that clients decode
 * themselves (URL contract in the nginx conf and docs/re/DBXV2.md), so the tree stays a single
 * copy. Media that is already compressed (video, audio containers, .emz) is left as is. Every .xz
 * is decoded again: its length must equal the manifest size, otherwise the run stops before the
 * original is removed.
 *
 * Usage: bun dbxv2-assets-layout.ts <dump-dir> <assets-root> [--jobs 4]
 */
import { mkdir, readdir, rename, readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname, extname } from "node:path";

const [dump, root] = Bun.argv.slice(2);
if (!dump || !root) throw new Error("Usage: dbxv2-assets-layout.ts <dump-dir> <assets-root> [--jobs N]");
const jobsArg = Bun.argv.indexOf("--jobs");
const jobs = jobsArg > 0 ? Number(Bun.argv[jobsArg + 1]) : 4;

const KINDS: Record<string, string[]> = {
  models: ["emd", "esk", "emm", "ema", "ean", "emo", "eepk", "bsa", "emz"],
  textures: ["emb", "dds", "iggytex", "png"],
  audio: ["acb", "awb", "hca", "adx", "ogg"],
  video: ["usm", "mp4"],
  text: ["msg", "json", "xml", "txt", "csv", "ini"],
};
const kindOf = new Map<string, string>();
for (const [kind, extensions] of Object.entries(KINDS)) for (const extension of extensions) kindOf.set(extension, kind);
// Already compressed: left untouched.
const STORED = new Set(["usm", "mp4", "awb", "acb", "hca", "adx", "ogg", "emz", "png", "gz", "zip"]);

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const cpkRoot = join(dump, "cpk");
const index: string[] = [];
const toCompress: { path: string; size: number }[] = [];
await mkdir(join(root, "meta"), { recursive: true });

for (const cpk of (await readdir(cpkRoot)).sort()) {
  const base = join(cpkRoot, cpk);
  const manifestPath = join(base, "cpk_manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: { file: string; sizeBytes: number }[] };
  const sizes = new Map(manifest.files.map(entry => [entry.file, entry.sizeBytes]));
  for (const path of await walk(base)) {
    const relative = path.slice(base.length + 1).replaceAll("\\", "/");
    if (relative === "cpk_manifest.json") continue;
    const extension = extname(relative).slice(1).toLowerCase();
    const kind = kindOf.get(extension) ?? "data";
    const destination = join(root, kind, cpk, relative);
    const size = sizes.get(relative);
    if (size === undefined) throw new Error(`${cpk}/${relative} is not in its manifest`);
    await mkdir(dirname(destination), { recursive: true });
    await rename(path, destination);
    const compress = !STORED.has(extension);
    index.push(
      JSON.stringify({ cpk, path: relative, kind, size, gzip: false, ...(compress ? { compression: "xz" } : {}) }),
    );
    if (compress) toCompress.push({ path: destination, size });
  }
  await rename(manifestPath, join(root, "meta", `${cpk}.json`));
}
await writeFile(join(root, "meta", "index.jsonl"), `${index.join("\n")}\n`);
console.log(`moved ${index.length} files, compressing ${toCompress.length}`);

// xz -9e keeps the original (-k) until the .xz decodes to exactly the manifest size; only then it is removed.
const queue = [...toCompress];
async function decodedLength(path: string): Promise<number> {
  const proc = Bun.spawn(["xz", "-dc", "--", path], { stdout: "pipe", stderr: "inherit" });
  let length = 0;
  for await (const chunk of proc.stdout) length += chunk.byteLength;
  if ((await proc.exited) !== 0) throw new Error(`xz -dc failed: ${path}`);
  return length;
}
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const proc = Bun.spawn(["xz", "-9e", "--threads=1", "-k", "-f", "--", item.path], {
      stdout: "ignore",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new Error(`xz failed: ${item.path}`);
    const length = await decodedLength(`${item.path}.xz`);
    if (length !== item.size) throw new Error(`size mismatch: ${item.path} (${length} != ${item.size})`);
    await unlink(item.path);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log("done");
