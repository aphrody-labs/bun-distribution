#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Reorganises a private DBXV2 CPK dump into the tree nginx serves (infra/config/host/nginx/private/dbxv2-assets.conf):
 *
 *   <root>/<kind>/<cpk>/<path inside the cpk>[.gz]     kind = models | textures | audio | video | text | data
 *   <root>/meta/<cpk>.json                             per-archive manifest (entries and sizes)
 *   <root>/meta/index.jsonl                            one line per file: cpk, path, kind, size, gzip
 *
 * Files move inside one filesystem (rename, no copy). Compressible kinds are gzipped in place with
 * pigz and served with gzip_static/gunzip, so the tree stays a single copy. Media that is already
 * compressed (video, audio containers, .emz) is left as is. Every .gz is re-read: its ISIZE trailer
 * must equal the manifest size, otherwise the run stops before touching the next file.
 *
 * Usage: bun dbxv2-assets-layout.ts <dump-dir> <assets-root> [--jobs 8]
 */
import { mkdir, readdir, rename, readFile, writeFile, open } from "node:fs/promises";
import { join, dirname, extname } from "node:path";

const [dump, root] = Bun.argv.slice(2);
if (!dump || !root) throw new Error("Usage: dbxv2-assets-layout.ts <dump-dir> <assets-root> [--jobs N]");
const jobsArg = Bun.argv.indexOf("--jobs");
const jobs = jobsArg > 0 ? Number(Bun.argv[jobsArg + 1]) : 8;

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
    const gzip = !STORED.has(extension);
    index.push(JSON.stringify({ cpk, path: relative, kind, size, gzip }));
    if (gzip) toCompress.push({ path: destination, size });
  }
  await rename(manifestPath, join(root, "meta", `${cpk}.json`));
}
await writeFile(join(root, "meta", "index.jsonl"), `${index.join("\n")}\n`);
console.log(`moved ${index.length} files, compressing ${toCompress.length}`);

// pigz replaces each file by file.gz; batches keep the process count low.
const queue = [...toCompress];
async function worker() {
  for (let batch = queue.splice(0, 200); batch.length; batch = queue.splice(0, 200)) {
    const proc = Bun.spawn(["pigz", "-9", "-n", "-p", "1", "--", ...batch.map(item => item.path)], {
      stdout: "ignore",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new Error("pigz failed");
    for (const item of batch) {
      const handle = await open(`${item.path}.gz`, "r");
      try {
        const { size } = await handle.stat();
        const trailer = Buffer.alloc(4);
        await handle.read(trailer, 0, 4, size - 4);
        if (trailer.readUInt32LE(0) !== item.size % 2 ** 32) throw new Error(`size mismatch: ${item.path}`);
      } finally {
        await handle.close();
      }
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log("done");
