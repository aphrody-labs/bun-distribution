#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * cdn-optimize: lossless, verified and incremental optimization of a static asset tree.
 *
 *   bun scripts/release/cdn-optimize.ts --src <mirror> --out <served> --state <manifest.sqlite>
 *       [--jobs N] [--dry-run] [--limit N] [--only jpeg,png,gif,webp,mp4,text] [--force]
 *       [--report <file.json>] [--max-delete N]
 *
 * The source tree (an rsync mirror) is never written. For every source file the served tree
 * receives the smallest variant whose decoded content is proven identical, or a hardlink to
 * the source. Text files also get `.br` and `.gz` siblings (nginx brotli_static/gzip_static).
 * Byte-identical outputs are hardlinked to one inode. A SQLite manifest (size, mtime, inode)
 * keeps runs incremental; files removed from the source are removed from the served tree.
 *
 * Per type: tool -> proof of no regression
 *   JPEG  jpegtran -optimize, baseline and progressive; markers kept (all with Exif, else ICC)
 *         -> identical djpeg pixels
 *   PNG   oxipng -o max --strip safe and zopflipng -m keeping colour chunks; APNG untouched
 *         -> identical 16-bit RGBA pixels
 *   GIF   gifsicle -O3 -> identical coalesced RGBA frames and frame delays
 *   WebP  lossless VP8L re-encoded cwebp -lossless -z 9 -exact (ICC/Exif re-attached); lossy:
 *         XMP stripped -> identical dwebp pixels
 *   MP4   moov after mdat -> ffmpeg -c copy -movflags +faststart -> identical packet framemd5
 *   text  brotli q11/lgwin 24 and zopfli gzip siblings -> decompression gives the source bytes
 */
// oxlint-disable no-await-in-loop -- sequential by design: header walks, candidate proofs, dedup links.
import { Database } from "bun:sqlite";
import {
  link,
  lstat,
  mkdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
} from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlib,
  gunzipSync,
} from "node:zlib";

type Kind = "jpeg" | "png" | "gif" | "webp" | "mp4" | "text" | "other";
const KINDS: readonly Kind[] = [
  "jpeg",
  "png",
  "gif",
  "webp",
  "mp4",
  "text",
  "other",
];

const TEXT_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".srt",
  ".vtt",
  ".xml",
  ".webmanifest",
  ".ico",
  ".ttf",
  ".otf",
  ".wasm",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
]);
const FONT_EXT = new Set([".ttf", ".otf"]);
const MP4_EXT = new Set([".mp4", ".m4v", ".m4a"]);
const SIBLINGS = [".br", ".gz"] as const;
/** Paths of an rsync run in progress (--partial-dir, --delay-updates) or of this tool are never published. */
const TRANSIENT = /(^|\/)(\.rsync-partial|\.~tmp~|\.cdn-optimize-tmp)(\/|$)/;
/** A precompressed sibling must save at least 5% and the source must be worth it. */
const SIBLING_MIN_SOURCE = 512;
const SIBLING_MAX_RATIO = 0.95;

interface Options {
  src: string;
  out: string;
  state: string;
  jobs: number;
  dryRun: boolean;
  limit: number;
  only: Set<Kind>;
  force: boolean;
  report: string | null;
  maxDelete: number;
}

interface Row {
  path: string;
  src_size: number;
  src_mtime_ms: number;
  src_ino: number;
  src_sha256: string;
  kind: Kind;
  action: string;
  out_size: number;
  out_sha256: string;
  br_size: number | null;
  gz_size: number | null;
}

interface KindStats {
  files: number;
  processed: number;
  optimized: number;
  srcBytes: number;
  outBytes: number;
  rejected: number;
  errors: number;
}

const tools = {
  jpegtran: Bun.which("jpegtran"),
  djpeg: Bun.which("djpeg"),
  oxipng: Bun.which("oxipng"),
  zopflipng: Bun.which("zopflipng"),
  gifsicle: Bun.which("gifsicle"),
  magick: Bun.which("magick"),
  cwebp: Bun.which("cwebp"),
  dwebp: Bun.which("dwebp"),
  webpmux: Bun.which("webpmux"),
  ffmpeg: Bun.which("ffmpeg"),
  zopfli: Bun.which("zopfli"),
};

function parseArgs(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const src = value("--src");
  const out = value("--out");
  const state = value("--state");
  if (!src || !out || !state) {
    console.error(
      "usage: cdn-optimize --src <mirror> --out <served> --state <manifest.sqlite> [--jobs N] [--dry-run] [--limit N] [--only kinds] [--force] [--report file] [--max-delete N]",
    );
    process.exit(2);
  }
  const only = new Set<Kind>();
  for (const k of (value("--only") ?? KINDS.join(",")).split(",")) {
    if (!KINDS.includes(k as Kind)) throw new Error(`unknown kind ${k}`);
    only.add(k as Kind);
  }
  return {
    src: resolve(src),
    out: resolve(out),
    state: resolve(state),
    jobs: Number(value("--jobs") ?? Math.max(1, availableParallelism() - 1)),
    dryRun: argv.includes("--dry-run"),
    limit: Number(value("--limit") ?? 0),
    only,
    force: argv.includes("--force"),
    report: value("--report") ?? null,
    maxDelete: Number(value("--max-delete") ?? 2000),
  };
}

// ---------------------------------------------------------------- processes and hashing

interface RunResult {
  code: number;
  stderr: string;
}

async function run(cmd: string[]): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return { code, stderr: stderr.slice(0, 2000) };
}

/** SHA-256 of a command's stdout, streamed (decoded pixel buffers can be hundreds of MB). */
async function hashStdout(
  cmd: string[],
  filter?: (chunk: string) => string,
): Promise<string | null> {
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  const hasher = new Bun.CryptoHasher("sha256");
  if (filter) {
    hasher.update(filter(await new Response(proc.stdout).text()));
  } else {
    for await (const chunk of proc.stdout) hasher.update(chunk);
  }
  const code = await proc.exited;
  return code === 0 ? hasher.digest("hex") : null;
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function head(path: string, bytes: number): Promise<Uint8Array> {
  return await Bun.file(path).slice(0, bytes).bytes();
}

const ascii = (b: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...b.subarray(at, at + n));

// ---------------------------------------------------------------- detection

async function detect(path: string): Promise<Kind> {
  const ext = extname(path).toLowerCase();
  const b = await head(path, 16);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 4, 4) === "ftyp" && MP4_EXT.has(ext)) return "mp4";
  if (TEXT_EXT.has(ext)) return "text";
  return "other";
}

/** JPEG markers before the first scan: Exif APP1 present (orientation must be kept). */
async function jpegHasExif(path: string): Promise<boolean> {
  const b = await head(path, 256 * 1024);
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (marker === 0xe1 && ascii(b, i + 4, 4) === "Exif") return true;
    i += 2 + len;
  }
  return false;
}

/** PNG chunks before the first IDAT: animated PNG (acTL) is left untouched. */
async function pngIsAnimated(path: string): Promise<boolean> {
  const b = await head(path, 1024 * 1024);
  let i = 8;
  while (i + 8 <= b.length) {
    const len =
      (((b[i] ?? 0) << 24) >>> 0) +
      ((b[i + 1] ?? 0) << 16) +
      ((b[i + 2] ?? 0) << 8) +
      (b[i + 3] ?? 0);
    const type = ascii(b, i + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    i += 12 + len;
  }
  return false;
}

interface WebpInfo {
  lossless: boolean;
  animated: boolean;
  icc: boolean;
  exif: boolean;
  xmp: boolean;
}

async function webpInfo(path: string): Promise<WebpInfo> {
  const file = Bun.file(path);
  const info: WebpInfo = {
    lossless: false,
    animated: false,
    icc: false,
    exif: false,
    xmp: false,
  };
  let at = 12;
  const size = file.size;
  while (at + 8 <= size) {
    const h = await file.slice(at, at + 21).bytes();
    const type = ascii(h, 0, 4);
    const len =
      (h[4] ?? 0) |
      ((h[5] ?? 0) << 8) |
      ((h[6] ?? 0) << 16) |
      (((h[7] ?? 0) << 24) >>> 0);
    if (type === "VP8L") info.lossless = true;
    if (type === "ANIM" || type === "ANMF") info.animated = true;
    if (type === "ICCP") info.icc = true;
    if (type === "EXIF") info.exif = true;
    if (type === "XMP ") info.xmp = true;
    at += 8 + len + (len & 1);
  }
  return info;
}

/** Top-level MP4 boxes: true when the movie header follows the media data (no fast start). */
async function mp4NeedsFaststart(path: string): Promise<boolean> {
  const file = Bun.file(path);
  let at = 0;
  let sawMdat = false;
  while (at + 8 <= file.size) {
    const h = await file.slice(at, at + 16).bytes();
    let len =
      (((h[0] ?? 0) << 24) >>> 0) +
      ((h[1] ?? 0) << 16) +
      ((h[2] ?? 0) << 8) +
      (h[3] ?? 0);
    const type = ascii(h, 4, 4);
    if (len === 1) {
      len = Number(new DataView(h.buffer, h.byteOffset + 8, 8).getBigUint64(0));
    } else if (len === 0) {
      len = file.size - at;
    }
    if (type === "mdat") sawMdat = true;
    if (type === "moov") return sawMdat;
    if (len < 8) return false;
    at += len;
  }
  return false;
}

// ---------------------------------------------------------------- proofs of identical content

async function decodedHash(kind: Kind, path: string): Promise<string | null> {
  switch (kind) {
    case "jpeg":
      return tools.djpeg ? await hashStdout([tools.djpeg, "-pnm", path]) : null;
    case "png":
      return tools.magick
        ? await hashStdout([
            tools.magick,
            `png:${path}`,
            "-depth",
            "16",
            "RGBA:-",
          ])
        : null;
    case "gif": {
      if (!tools.magick) return null;
      const pixels = await hashStdout([
        tools.magick,
        `gif:${path}`,
        "-coalesce",
        "-depth",
        "8",
        "RGBA:-",
      ]);
      const delays = await hashStdout([
        tools.magick,
        `gif:${path}`,
        "-coalesce",
        "-format",
        "%T;%w;%h|",
        "info:",
      ]);
      return pixels && delays ? `${pixels}:${delays}` : null;
    }
    case "webp":
      return tools.dwebp
        ? await hashStdout([tools.dwebp, "-quiet", path, "-pam", "-o", "-"])
        : null;
    case "mp4":
      return tools.ffmpeg
        ? await hashStdout(
            [
              tools.ffmpeg,
              "-v",
              "error",
              "-i",
              path,
              "-map",
              "0",
              "-c",
              "copy",
              "-f",
              "framemd5",
              "-",
            ],
            (t) =>
              t
                .split("\n")
                .filter((l) => l && !l.startsWith("#"))
                .join("\n"),
          )
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- optimizers

interface Candidate {
  path: string;
  tool: string;
}

class Workspace {
  private n = 0;
  constructor(readonly dir: string) {}
  file(suffix: string): string {
    return join(this.dir, `${process.pid}-${++this.n}${suffix}`);
  }
}

async function optimize(
  kind: Kind,
  src: string,
  ext: string,
  ws: Workspace,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const attempt = async (
    tool: string,
    path: string,
    cmd: string[],
  ): Promise<void> => {
    const r = await run(cmd);
    if (r.code === 0 && (await Bun.file(path).exists()))
      out.push({ path, tool });
    else await rm(path, { force: true });
  };
  switch (kind) {
    case "jpeg": {
      if (!tools.jpegtran) break;
      const copy = (await jpegHasExif(src)) ? "all" : "icc";
      const progressive = ws.file(".jpg");
      const baseline = ws.file(".jpg");
      await attempt("jpegtran -progressive", progressive, [
        tools.jpegtran,
        "-copy",
        copy,
        "-optimize",
        "-progressive",
        "-outfile",
        progressive,
        src,
      ]);
      await attempt("jpegtran", baseline, [
        tools.jpegtran,
        "-copy",
        copy,
        "-optimize",
        "-outfile",
        baseline,
        src,
      ]);
      break;
    }
    case "png": {
      if (await pngIsAnimated(src)) break;
      const size = Bun.file(src).size;
      if (tools.oxipng) {
        const o = ws.file(".png");
        await attempt("oxipng", o, [
          tools.oxipng,
          "-q",
          "-o",
          "max",
          "--strip",
          "safe",
          "--out",
          o,
          src,
        ]);
      }
      if (tools.zopflipng && size <= 8 * 1024 * 1024) {
        const z = ws.file(".png");
        const more = size <= 2 * 1024 * 1024 ? ["-m"] : [];
        await attempt("zopflipng", z, [
          tools.zopflipng,
          "-y",
          ...more,
          "--keepchunks=iCCP,sRGB,gAMA,cHRM,sBIT,pHYs,eXIf",
          src,
          z,
        ]);
      }
      break;
    }
    case "gif": {
      if (!tools.gifsicle) break;
      const g = ws.file(".gif");
      await attempt("gifsicle -O3", g, [tools.gifsicle, "-O3", "-o", g, src]);
      break;
    }
    case "webp": {
      if (!tools.webpmux || !tools.dwebp || !tools.cwebp) break;
      const info = await webpInfo(src);
      if (info.lossless && !info.animated) {
        const pam = ws.file(".pam");
        const enc = ws.file(".webp");
        if (
          (await run([tools.dwebp, "-quiet", src, "-pam", "-o", pam])).code ===
          0
        ) {
          const r = await run([
            tools.cwebp,
            "-quiet",
            "-lossless",
            "-z",
            "9",
            "-exact",
            "-mt",
            "-metadata",
            "none",
            pam,
            "-o",
            enc,
          ]);
          let result = r.code === 0 ? enc : null;
          for (const [present, chunk] of [
            [info.icc, "icc"],
            [info.exif, "exif"],
          ] as const) {
            if (!result || !present) continue;
            const blob = ws.file(`.${chunk}`);
            const next = ws.file(".webp");
            const ok =
              (await run([tools.webpmux, "-get", chunk, src, "-o", blob]))
                .code === 0 &&
              (
                await run([
                  tools.webpmux,
                  "-set",
                  chunk,
                  blob,
                  result,
                  "-o",
                  next,
                ])
              ).code === 0;
            await rm(blob, { force: true });
            await rm(result, { force: true });
            result = ok ? next : null;
          }
          if (result)
            out.push({ path: result, tool: "cwebp -lossless -z 9 -exact" });
        }
        await rm(pam, { force: true });
      } else if (info.xmp) {
        const s = ws.file(".webp");
        await attempt("webpmux -strip xmp", s, [
          tools.webpmux,
          "-strip",
          "xmp",
          src,
          "-o",
          s,
        ]);
      }
      break;
    }
    case "mp4": {
      if (!tools.ffmpeg || !(await mp4NeedsFaststart(src))) break;
      const m = ws.file(ext);
      const format = ext === ".m4a" ? "ipod" : "mp4";
      await attempt("ffmpeg faststart", m, [
        tools.ffmpeg,
        "-v",
        "error",
        "-y",
        "-i",
        src,
        "-map",
        "0",
        "-c",
        "copy",
        "-map_metadata",
        "0",
        "-movflags",
        "+faststart",
        "-f",
        format,
        m,
      ]);
      break;
    }
    default:
      break;
  }
  return out;
}

/** Smallest candidate proven identical to the source; null keeps the source bytes. */
async function choose(
  kind: Kind,
  src: string,
  candidates: Candidate[],
): Promise<{ best: Candidate | null; rejected: number }> {
  const srcSize = Bun.file(src).size;
  // A fast-start remux may grow by a few bytes; it is kept for streaming, not for size.
  const limit = kind === "mp4" ? srcSize * 1.001 : srcSize - 1;
  const sorted = candidates
    .filter((c) => Bun.file(c.path).size <= limit)
    .toSorted((a, b) => Bun.file(a.path).size - Bun.file(b.path).size);
  for (const c of candidates)
    if (!sorted.includes(c)) await rm(c.path, { force: true });
  let rejected = 0;
  let best: Candidate | null = null;
  if (sorted.length) {
    const reference = await decodedHash(kind, src);
    for (const c of sorted) {
      if (
        !best &&
        reference &&
        (await decodedHash(kind, c.path)) === reference
      ) {
        best = c;
        continue;
      }
      if (!best) rejected++;
      await rm(c.path, { force: true });
    }
  }
  return { best, rejected };
}

// ---------------------------------------------------------------- precompressed siblings

function brotli(bytes: Uint8Array, font: boolean): Uint8Array {
  return brotliCompressSync(bytes, {
    params: {
      [zlib.BROTLI_PARAM_QUALITY]: zlib.BROTLI_MAX_QUALITY,
      [zlib.BROTLI_PARAM_LGWIN]: zlib.BROTLI_MAX_WINDOW_BITS,
      [zlib.BROTLI_PARAM_MODE]: font
        ? zlib.BROTLI_MODE_FONT
        : zlib.BROTLI_MODE_TEXT,
      [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
}

async function gzip(
  src: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array | null> {
  if (tools.zopfli) {
    const proc = Bun.spawn([tools.zopfli, "--i15", "-c", src], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).bytes();
    if ((await proc.exited) === 0) return out;
  }
  return Bun.gzipSync(bytes, { level: 9 });
}

interface SiblingSizes {
  br: number | null;
  gz: number | null;
}

async function writeSiblings(
  src: string,
  outPath: string,
  mtime: Date,
  opts: Options,
  ws: Workspace,
): Promise<SiblingSizes> {
  const bytes = await Bun.file(src).bytes();
  const sizes: SiblingSizes = { br: null, gz: null };
  const font = FONT_EXT.has(extname(src).toLowerCase());
  const variants: [(typeof SIBLINGS)[number], Uint8Array | null][] = [];
  if (bytes.length >= SIBLING_MIN_SOURCE) {
    const br = brotli(bytes, font);
    variants.push([
      ".br",
      Buffer.compare(brotliDecompressSync(br), bytes) === 0 ? br : null,
    ]);
    const gz = await gzip(src, bytes);
    variants.push([
      ".gz",
      gz && Buffer.compare(gunzipSync(gz), bytes) === 0 ? gz : null,
    ]);
  }
  for (const suffix of SIBLINGS) {
    const data = variants.find(([s]) => s === suffix)?.[1] ?? null;
    const target = outPath + suffix;
    if (data && data.length <= bytes.length * SIBLING_MAX_RATIO) {
      if (suffix === ".br") sizes.br = data.length;
      else sizes.gz = data.length;
      if (!opts.dryRun) {
        const tmp = ws.file(suffix);
        await Bun.write(tmp, data);
        await utimes(tmp, mtime, mtime);
        await rename(tmp, target);
      }
    } else if (!opts.dryRun) {
      await rm(target, { force: true });
    }
  }
  return sizes;
}

// ---------------------------------------------------------------- tree operations

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({
    cwd: root,
    dot: true,
    onlyFiles: false,
    followSymlinks: false,
  })) {
    if (TRANSIENT.test(rel)) continue;
    const st = await lstat(join(root, rel));
    if (st.isFile() || st.isSymbolicLink()) files.push(rel);
  }
  return files.toSorted();
}

function inside(root: string, rel: string): string {
  const p = resolve(root, rel);
  if (p !== root && !p.startsWith(root + sep))
    throw new Error(`path escapes the tree: ${rel}`);
  return p;
}

async function install(
  ws: Workspace,
  from: { candidate: string } | { linkTo: string },
  outPath: string,
  mtime: Date,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const tmp = ws.file("");
  if ("candidate" in from) {
    await rename(from.candidate, tmp);
    await utimes(tmp, mtime, mtime);
  } else {
    await link(from.linkTo, tmp);
  }
  await rename(tmp, outPath);
}

async function pool<T>(
  items: readonly T[],
  jobs: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined) await fn(item);
      }
    }),
  );
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));
  const t0 = performance.now();
  if (
    opts.src === opts.out ||
    opts.out.startsWith(opts.src + sep) ||
    opts.src.startsWith(opts.out + sep)
  ) {
    throw new Error("--src and --out must be distinct, non-nested trees");
  }
  await mkdir(opts.out, { recursive: true });
  await mkdir(dirname(opts.state), { recursive: true });
  const ws = new Workspace(join(dirname(opts.state), ".cdn-optimize-tmp"));
  await rm(ws.dir, { recursive: true, force: true });
  await mkdir(ws.dir, { recursive: true });
  const devs = await Promise.all(
    [opts.src, opts.out, ws.dir].map(async (p) => (await stat(p)).dev),
  );
  if (new Set(devs).size !== 1)
    throw new Error(
      "--src, --out and the state directory must share one filesystem (hardlinks, atomic renames)",
    );

  const db = new Database(opts.dryRun ? ":memory:" : opts.state, {
    create: true,
  });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY, src_size INTEGER NOT NULL, src_mtime_ms REAL NOT NULL, src_ino INTEGER NOT NULL,
    src_sha256 TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, out_size INTEGER NOT NULL,
    out_sha256 TEXT NOT NULL, br_size INTEGER, gz_size INTEGER, note TEXT, updated_at TEXT NOT NULL)`);
  db.exec("CREATE INDEX IF NOT EXISTS files_out_sha ON files(out_sha256)");
  const getRow = db.query<Row, [string]>("SELECT * FROM files WHERE path = ?");
  const putRow = db.query(`INSERT OR REPLACE INTO files
    (path, src_size, src_mtime_ms, src_ino, src_sha256, kind, action, out_size, out_sha256, br_size, gz_size, note, updated_at)
    VALUES ($path, $src_size, $src_mtime_ms, $src_ino, $src_sha256, $kind, $action, $out_size, $out_sha256, $br_size, $gz_size, $note, $updated_at)`);

  const sources = await walk(opts.src);
  if (sources.length === 0)
    throw new Error(
      `no file under ${opts.src}: refusing to mirror an empty source`,
    );
  const selected = opts.limit > 0 ? sources.slice(0, opts.limit) : sources;

  const stats = Object.fromEntries(
    KINDS.map((k) => [
      k,
      {
        files: 0,
        processed: 0,
        optimized: 0,
        srcBytes: 0,
        outBytes: 0,
        rejected: 0,
        errors: 0,
      },
    ]),
  ) as Record<Kind, KindStats>;
  const siblings = { br: 0, brBytes: 0, gz: 0, gzBytes: 0, textBytes: 0 };
  const errors: { path: string; error: string }[] = [];
  let done = 0;
  let lastLog = performance.now();

  await pool(selected, opts.jobs, async (rel) => {
    const srcPath = inside(opts.src, rel);
    const outPath = inside(opts.out, rel);
    const st = await lstat(srcPath);
    if (st.isSymbolicLink()) {
      if (!opts.dryRun) {
        const target = await readlink(srcPath);
        await mkdir(dirname(outPath), { recursive: true });
        await rm(outPath, { force: true });
        await symlink(target, outPath);
      }
      return;
    }
    const kind = await detect(srcPath);
    const s = stats[kind];
    s.files++;
    s.srcBytes += st.size;
    const previous = getRow.get(rel);
    const unchanged =
      previous &&
      previous.src_size === st.size &&
      previous.src_mtime_ms === st.mtimeMs &&
      previous.src_ino === st.ino;
    if (unchanged && !opts.force && (await Bun.file(outPath).exists())) {
      s.outBytes += previous.out_size;
      if (previous.br_size !== null) {
        siblings.br++;
        siblings.brBytes += previous.br_size;
      }
      if (previous.gz_size !== null) {
        siblings.gz++;
        siblings.gzBytes += previous.gz_size;
      }
      if (kind === "text") siblings.textBytes += st.size;
      return;
    }
    s.processed++;
    let action = "link";
    let note: string | null = null;
    let outSize = st.size;
    let outSha = "";
    let sizes: SiblingSizes = { br: null, gz: null };
    try {
      const srcSha = await sha256File(srcPath);
      outSha = srcSha;
      const candidates = opts.only.has(kind)
        ? await optimize(kind, srcPath, extname(rel).toLowerCase(), ws)
        : [];
      const { best, rejected } = await choose(kind, srcPath, candidates);
      s.rejected += rejected;
      if (best) {
        outSize = Bun.file(best.path).size;
        outSha = await sha256File(best.path);
        action = best.tool;
        s.optimized++;
        if (opts.dryRun) await rm(best.path, { force: true });
        else await install(ws, { candidate: best.path }, outPath, st.mtime);
      } else if (!opts.dryRun) {
        await install(ws, { linkTo: srcPath }, outPath, st.mtime);
      }
      if (kind === "text" && opts.only.has("text")) {
        sizes = await writeSiblings(srcPath, outPath, st.mtime, opts, ws);
        siblings.textBytes += st.size;
      }
      putRow.run({
        $path: rel,
        $src_size: st.size,
        $src_mtime_ms: st.mtimeMs,
        $src_ino: st.ino,
        $src_sha256: srcSha,
        $kind: kind,
        $action: action,
        $out_size: outSize,
        $out_sha256: outSha,
        $br_size: sizes.br,
        $gz_size: sizes.gz,
        $note: note,
        $updated_at: new Date().toISOString(),
      });
    } catch (e) {
      // Any failure publishes the source bytes unchanged.
      s.errors++;
      note = e instanceof Error ? e.message : String(e);
      errors.push({ path: rel, error: note.slice(0, 300) });
      if (!opts.dryRun)
        await install(ws, { linkTo: srcPath }, outPath, st.mtime).catch(
          () => undefined,
        );
    }
    s.outBytes += outSize;
    if (sizes.br !== null) {
      siblings.br++;
      siblings.brBytes += sizes.br;
    }
    if (sizes.gz !== null) {
      siblings.gz++;
      siblings.gzBytes += sizes.gz;
    }
    done++;
    if (performance.now() - lastLog > 15000) {
      lastLog = performance.now();
      console.log(`progress ${done} processed / ${selected.length} files`);
    }
  });

  // Files gone from the source leave the served tree (with their siblings).
  let deleted = 0;
  const dedup = { groups: 0, linked: 0, bytes: 0 };
  if (!opts.dryRun && opts.limit === 0) {
    const keep = new Set(sources);
    const served = await walk(opts.out);
    const stale = served.filter((rel) => {
      if (keep.has(rel)) return false;
      const sibling = SIBLINGS.find((x) => rel.endsWith(x));
      return !(sibling && keep.has(rel.slice(0, -sibling.length)));
    });
    if (stale.length > opts.maxDelete)
      throw new Error(
        `${stale.length} stale files exceed --max-delete ${opts.maxDelete}; nothing deleted`,
      );
    for (const rel of stale) {
      await unlink(inside(opts.out, rel));
      deleted++;
    }
    const gone = db
      .query<{ path: string }, []>("SELECT path FROM files")
      .all()
      .filter((r) => !keep.has(r.path));
    const del = db.query("DELETE FROM files WHERE path = ?");
    for (const r of gone) del.run(r.path);

    // Byte-identical outputs share one inode (and so do their siblings).
    const groups = db
      .query<{ out_sha256: string; paths: string }, []>(
        "SELECT out_sha256, group_concat(path, char(0)) AS paths FROM files GROUP BY out_sha256 HAVING count(*) > 1",
      )
      .all();
    for (const g of groups) {
      const paths = g.paths.split("\0").toSorted();
      const canonical = paths[0];
      if (canonical === undefined) continue;
      dedup.groups++;
      for (const suffix of ["", ...SIBLINGS]) {
        const canonPath = inside(opts.out, canonical + suffix);
        const canon = await stat(canonPath).catch(() => null);
        if (!canon) continue;
        for (const other of paths.slice(1)) {
          const otherPath = inside(opts.out, other + suffix);
          const st = await stat(otherPath).catch(() => null);
          if (!st || st.ino === canon.ino || st.size !== canon.size) continue;
          await install(ws, { linkTo: canonPath }, otherPath, canon.mtime);
          dedup.linked++;
          dedup.bytes += st.size;
        }
      }
    }
  }
  db.close();
  await rm(ws.dir, { recursive: true, force: true });

  const totals = KINDS.reduce(
    (a, k) => ({
      srcBytes: a.srcBytes + stats[k].srcBytes,
      outBytes: a.outBytes + stats[k].outBytes,
    }),
    { srcBytes: 0, outBytes: 0 },
  );
  const report = {
    tool: "cdn-optimize/1",
    finishedAt: new Date().toISOString(),
    seconds: Math.round((performance.now() - t0) / 1000),
    src: opts.src,
    out: opts.out,
    dryRun: opts.dryRun,
    files: selected.length,
    tools: Object.fromEntries(
      Object.entries(tools).map(([k, v]) => [k, v !== null]),
    ),
    kinds: stats,
    totals: { ...totals, savedBytes: totals.srcBytes - totals.outBytes },
    siblings,
    deleted,
    dedup,
    errors: errors.slice(0, 200),
  };
  const text = JSON.stringify(report, null, 2);
  if (opts.report) await Bun.write(opts.report, text + "\n");
  console.log(text);
  if (errors.length) process.exitCode = 1;
}

if (import.meta.main) await main();

export {
  decodedHash,
  detect,
  jpegHasExif,
  mp4NeedsFaststart,
  pngIsAnimated,
  webpInfo,
};
