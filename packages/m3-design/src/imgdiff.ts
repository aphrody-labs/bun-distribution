// SPDX-License-Identifier: MIT
// Bun port of Replica's replica-diff/imgdiff.py (Copyright (c) 2026 Jake Schincariol, MIT;
// see LICENSES/replica-skill-MIT.txt). The Python file stays in packages/replica-skills as reference.
//
// Screenshot diff: compares a screenshot of the original app with the same screen in a clone.
//
//   m3-design imgdiff original.png clone.png
//   m3-design imgdiff original.png clone.png --out diff.png --json
//   m3-design imgdiff original.png clone.png --mode pixel --fail-under 95
//
// layout (default) compares structure, not colour: both images become edge maps cut into a
// grid and each non-empty cell's edge density is compared, so a rebrand does not count
// against the clone. pixel compares exact pixels with a tolerance, for the clone's own
// regressions. Both images are scaled to the same width (--width, default 480) and compared
// over the shared height; a height difference is reported. Reads 8 and 16 bit PNGs (grey,
// RGB, palette, with or without alpha); interlaced PNGs are refused.

const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export class PngError extends Error {}

/** Packed 8 bit RGB pixels, row-major. */
export interface RgbImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    if (pos + 1 + stride > raw.length) throw new PngError("image data is truncated");
    const type = raw[pos]!;
    const line = raw.slice(pos + 1, pos + 1 + stride);
    pos += 1 + stride;
    if (type === 1) {
      for (let i = bpp; i < stride; i++) line[i] = (line[i]! + line[i - bpp]!) & 0xff;
    } else if (type === 2) {
      for (let i = 0; i < stride; i++) line[i] = (line[i]! + prev[i]!) & 0xff;
    } else if (type === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? line[i - bpp]! : 0;
        line[i] = (line[i]! + ((left + prev[i]!) >> 1)) & 0xff;
      }
    } else if (type === 4) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? line[i - bpp]! : 0;
        const upLeft = i >= bpp ? prev[i - bpp]! : 0;
        line[i] = (line[i]! + paeth(left, prev[i]!, upLeft)) & 0xff;
      }
    } else if (type !== 0) {
      throw new PngError(`unknown filter type ${type}`);
    }
    rows.push(line);
    prev = line;
  }
  return rows;
}

/** Unpack one unfiltered scanline into 8 bit samples (16 bit keeps the high byte). */
function samples(line: Uint8Array, width: number, channels: number, depth: number): number[] {
  const n = width * channels;
  if (depth === 8) return Array.from(line.subarray(0, n));
  if (depth === 16) return Array.from({ length: n }, (_, i) => line[2 * i]!);
  const out: number[] = [];
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (const byte of line) {
    for (let k = 0; k < perByte; k++) {
      out.push((byte >> (8 - depth * (k + 1))) & mask);
      if (out.length === n) return out;
    }
  }
  return out;
}

function overWhite(out: Uint8Array, at: number, r: number, g: number, b: number, a: number) {
  if (a === 255) {
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    return;
  }
  const inv = 255 - a;
  out[at] = Math.floor((r * a + 255 * inv) / 255);
  out[at + 1] = Math.floor((g * a + 255 * inv) / 255);
  out[at + 2] = Math.floor((b * a + 255 * inv) / 255);
}

/** Decode a PNG; alpha is composited over white, the way a screenshot of a page renders. */
export function decodePng(data: Uint8Array, name = "image"): RgbImage {
  if (data.length < 8 || SIG.some((byte, i) => data[i] !== byte)) throw new PngError(`${name} is not a PNG`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8;
  let ihdr: DataView | undefined;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= data.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") ihdr = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") trns = chunk;
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
  }
  if (!ihdr || ihdr.byteLength < 13) throw new PngError(`${name} has no IHDR chunk`);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const depth = ihdr.getUint8(8);
  const color = ihdr.getUint8(9);
  if (ihdr.getUint8(12))
    throw new PngError(
      `${name} is interlaced. Re-save it without interlacing (on a Mac: sips -s format png in.png --out out.png)`,
    );
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (channels === undefined) throw new PngError(`unsupported PNG colour type ${color}`);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new PngError(`unsupported bit depth ${depth}`);
  if (color === 3 && !palette) throw new PngError("palette PNG without a palette");
  const bits = depth * channels;
  const bpp = Math.max(1, Math.floor(bits / 8));
  const stride = Math.floor((width * bits + 7) / 8);
  let raw: Uint8Array;
  try {
    raw = Bun.inflateSync(Buffer.concat(idat), { windowBits: 15 });
  } catch (error) {
    throw new PngError(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const lines = unfilter(raw, height, stride, bpp);
  const scale = depth < 8 ? Math.floor(255 / ((1 << depth) - 1)) : 1;
  const alphaPalette = color === 3 && trns ? trns : undefined;
  const paletteSize = palette ? Math.floor(palette.length / 3) : 0;
  const rgb = new Uint8Array(width * height * 3);
  lines.forEach((line, y) => {
    const s = samples(line, width, channels, depth);
    let at = y * width * 3;
    const pixels = Math.floor(s.length / channels);
    for (let x = 0; x < pixels; x++, at += 3) {
      const i = x * channels;
      if (color === 0) {
        const g = s[i]! * scale;
        rgb[at] = rgb[at + 1] = rgb[at + 2] = g;
      } else if (color === 2) {
        rgb[at] = s[i]!;
        rgb[at + 1] = s[i + 1]!;
        rgb[at + 2] = s[i + 2]!;
      } else if (color === 3) {
        const idx = s[i]!;
        const [r, g, b] =
          idx < paletteSize ? [palette![idx * 3]!, palette![idx * 3 + 1]!, palette![idx * 3 + 2]!] : [0, 0, 0];
        const a = alphaPalette && idx < alphaPalette.length ? alphaPalette[idx]! : 255;
        overWhite(rgb, at, r, g, b, a);
      } else if (color === 4) {
        overWhite(rgb, at, s[i]!, s[i]!, s[i]!, s[i + 1]!);
      } else {
        overWhite(rgb, at, s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!);
      }
    }
  });
  return { width, height, rgb };
}

/** Encode 8 bit RGB as PNG (filter 0, zlib level 6). */
export function encodePng({ width, height, rgb }: RgbImage): Uint8Array {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, Bun.hash.crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", Bun.deflateSync(raw, { level: 6, windowBits: 15 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** Nearest-neighbour resize. Good enough for structure, and fast. */
function resize(img: RgbImage, newW: number, newH: number): RgbImage {
  const xs = Array.from({ length: newW }, (_, x) => Math.min(img.width - 1, Math.trunc((x * img.width) / newW)));
  const out = new Uint8Array(newW * newH * 3);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(img.height - 1, Math.trunc((y * img.height) / newH));
    for (let x = 0; x < newW; x++)
      out.set(img.rgb.subarray((sy * img.width + xs[x]!) * 3, (sy * img.width + xs[x]!) * 3 + 3), (y * newW + x) * 3);
  }
  return { width: newW, height: newH, rgb: out };
}

function toWidth(img: RgbImage, target: number): RgbImage {
  if (img.width === target) return img;
  return resize(img, target, Math.max(1, roundHalfEven((img.height * target) / img.width)));
}

function gray(rgb: Uint8Array, w: number, h: number): Int32Array {
  const out = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++)
    out[i] = Math.floor((299 * rgb[i * 3]! + 587 * rgb[i * 3 + 1]! + 114 * rgb[i * 3 + 2]!) / 1000);
  return out;
}

function edges(g: Int32Array, w: number, h: number, threshold: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const below = y + 1 < h ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]!;
      const right = x + 1 < w ? g[y * w + x + 1]! : v;
      out[y * w + x] = Math.abs(right - v) + Math.abs(g[below * w + x]! - v) > threshold ? 1 : 0;
    }
  }
  return out;
}

/** Group flagged grid cells into 4-connected rectangles, biggest first. */
function regionsOf(flags: boolean[][], rows: number, cols: number): [number, number, number, number, number][] {
  const seen = new Set<number>();
  const regions: [number, number, number, number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!flags[r]![c] || seen.has(r * cols + c)) continue;
      const stack: [number, number][] = [[r, c]];
      seen.add(r * cols + c);
      const cells: [number, number][] = [];
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        cells.push([cr, cc]);
        for (const [nr, nc] of [
          [cr + 1, cc],
          [cr - 1, cc],
          [cr, cc + 1],
          [cr, cc - 1],
        ] as const) {
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && flags[nr]![nc] && !seen.has(nr * cols + nc)) {
            seen.add(nr * cols + nc);
            stack.push([nr, nc]);
          }
        }
      }
      const rs = cells.map(x => x[0]);
      const cs = cells.map(x => x[1]);
      regions.push([Math.min(...rs), Math.min(...cs), Math.max(...rs), Math.max(...cs), cells.length]);
    }
  }
  return regions.sort((a, b) => b[4] - a[4]);
}

function where(r0: number, c0: number, r1: number, c1: number, rows: number, cols: number): string {
  const midR = rows > 1 ? (r0 + r1) / 2 / Math.max(1, rows - 1) : 0.5;
  const midC = cols > 1 ? (c0 + c1) / 2 / Math.max(1, cols - 1) : 0.5;
  const v = midR < 0.34 ? "top" : midR > 0.66 ? "bottom" : "middle";
  const hz = midC < 0.34 ? "left" : midC > 0.66 ? "right" : "centre";
  return `${v} ${hz}`;
}

export function verdict(score: number): string {
  if (score >= 90) return "matches";
  if (score >= 75) return "close";
  if (score >= 50) return "partly";
  return "different";
}

export interface ImgDiffOptions {
  mode?: "layout" | "pixel";
  width?: number;
  cols?: number;
  tolerance?: number;
  edgeThreshold?: number;
}

export interface ImgDiffRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number;
  where: string;
}

export interface ImgDiffReport {
  mode: "layout" | "pixel";
  original: { width: number; height: number };
  clone: { width: number; height: number };
  compared_at: { width: number; height: number };
  height_delta_pct: number;
  changed_pixels?: number;
  score: number;
  verdict: string;
  regions: ImgDiffRegion[];
  files?: { original: string; clone: string };
  diff_image?: string;
}

/** Compare two decoded images; returns the report and a diff image at the compared size. */
export function compareImages(
  imgA: RgbImage,
  imgB: RgbImage,
  { mode = "layout", width = 480, cols = 12, tolerance = 24, edgeThreshold = 40 }: ImgDiffOptions = {},
): { report: ImgDiffReport; diff: RgbImage } {
  const target = Math.min(width, imgA.width, imgB.width);
  const a = toWidth(imgA, target);
  const b = toWidth(imgB, target);
  const w = target;
  const h = Math.min(a.height, b.height);
  const heightDelta = a.height ? ((b.height - a.height) / a.height) * 100 : 0;
  const toOrig = imgA.width / w;
  const ga = gray(a.rgb, w, h);
  const dim = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) dim[i * 3] = dim[i * 3 + 1] = dim[i * 3 + 2] = 200 + Math.floor(ga[i]! / 5);
  const cell = Math.max(1, Math.floor(w / cols));
  const nRows = Math.ceil(h / cell);
  const flags = Array.from({ length: nRows }, () => Array.from({ length: cols }, () => false));
  let score: number;
  let changedPixels: number | undefined;

  if (mode === "pixel") {
    const hit = new Uint8Array(w * h);
    let changed = 0;
    for (let i = 0; i < w * h; i++) {
      const d = Math.max(
        Math.abs(a.rgb[i * 3]! - b.rgb[i * 3]!),
        Math.abs(a.rgb[i * 3 + 1]! - b.rgb[i * 3 + 1]!),
        Math.abs(a.rgb[i * 3 + 2]! - b.rgb[i * 3 + 2]!),
      );
      if (d > tolerance) {
        hit[i] = 1;
        changed += 1;
        dim.set([220, 30, 30], i * 3);
      }
    }
    score = 100 * (1 - changed / (w * h || 1));
    changedPixels = changed;
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < cols; c++) {
        let hits = 0;
        let area = 0;
        for (let y = r * cell; y < Math.min(h, (r + 1) * cell); y++) {
          for (let x = c * cell; x < Math.min(w, (c + 1) * cell); x++) {
            area += 1;
            hits += hit[y * w + x]!;
          }
        }
        flags[r]![c] = area > 0 && hits / area > 0.02;
      }
    }
  } else {
    const ea = edges(ga, w, h, edgeThreshold);
    const eb = edges(gray(b.rgb, w, h), w, h, edgeThreshold);
    const sims: number[] = [];
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < cols; c++) {
        const y0 = r * cell;
        const y1 = Math.min(h, (r + 1) * cell);
        const x0 = c * cell;
        const x1 = Math.min(w, (c + 1) * cell);
        const area = (y1 - y0) * (x1 - x0);
        if (area <= 0) continue;
        let sa = 0;
        let sb = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            sa += ea[y * w + x]!;
            sb += eb[y * w + x]!;
          }
        }
        const da = sa / area;
        const db = sb / area;
        const top = Math.max(da, db);
        if (top < 0.01) continue; // empty in both: says nothing about the layout
        const sim = 1 - Math.abs(da - db) / top;
        sims.push(sim);
        if (sim < 0.6) {
          flags[r]![c] = true;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const at = (y * w + x) * 3;
              const g0 = dim[at]!;
              dim[at] = Math.min(255, g0 + 30);
              dim[at + 1] = dim[at + 2] = Math.floor(g0 / 3);
            }
          }
        }
      }
    }
    score = sims.length ? (100 * sims.reduce((sum, s) => sum + s, 0)) / sims.length : 100;
  }

  const regions = regionsOf(flags, nRows, cols).map(([r0, c0, r1, c1, n]) => {
    const x = Math.trunc(c0 * cell * toOrig);
    const y = Math.trunc(r0 * cell * toOrig);
    return {
      x,
      y,
      w: Math.min(imgA.width - x, Math.trunc((c1 - c0 + 1) * cell * toOrig)),
      h: Math.min(imgA.height - y, Math.trunc((r1 - r0 + 1) * cell * toOrig)),
      cells: n,
      where: where(r0, c0, r1, c1, nRows, cols),
    };
  });
  const report: ImgDiffReport = {
    mode,
    original: { width: imgA.width, height: imgA.height },
    clone: { width: imgB.width, height: imgB.height },
    compared_at: { width: w, height: h },
    height_delta_pct: round1(heightDelta),
    ...(changedPixels !== undefined ? { changed_pixels: changedPixels } : {}),
    score: round1(score),
    verdict: verdict(score),
    regions,
  };
  return { report, diff: { width: w, height: h, rgb: dim } };
}

export function renderImgDiff(report: ImgDiffReport, aName: string, bName: string): string {
  const bar = roundHalfEven((report.score / 100) * 24);
  const lines = [
    `  ${aName} vs ${bName}`,
    `  ${report.mode.toUpperCase().padEnd(6)} ${"#".repeat(bar)}${".".repeat(24 - bar)}  ${report.score.toFixed(1).padStart(5)}  ${report.verdict.toUpperCase()}`,
  ];
  const hd = report.height_delta_pct;
  if (Math.abs(hd) >= 5)
    lines.push(`  height: the clone is ${Math.abs(hd).toFixed(0)}% ${hd > 0 ? "taller" : "shorter"} than the original`);
  if (report.regions.length > 0) {
    lines.push("  where they differ (original's pixels, biggest first):");
    for (const reg of report.regions.slice(0, 8))
      lines.push(`    ${reg.where.padEnd(14)} x=${reg.x} y=${reg.y} w=${reg.w} h=${reg.h}`);
  } else {
    lines.push("  no differing regions");
  }
  return lines.join("\n");
}

const USAGE =
  "Usage: m3-design imgdiff <original.png> <clone.png> [--mode layout|pixel] [--width 480] [--cols 12] [--tolerance 24] [--out diff.png] [--json] [--fail-under <score>]";

export async function imgdiffMain(argv: readonly string[]): Promise<number> {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    }
    if (arg === "--json") json = true;
    else if (["--mode", "--width", "--cols", "--tolerance", "--out", "--fail-under"].includes(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`${USAGE}\nimgdiff: ${arg} needs a value`);
        return 2;
      }
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) {
      console.error(`${USAGE}\nimgdiff: unknown option ${arg}`);
      return 2;
    } else positionals.push(arg);
  }
  const integer = (name: string, fallback: number) => {
    const value = options[name];
    if (value === undefined) return fallback;
    if (!/^[+-]?\d+$/.test(value)) throw new PngError(`--${name} needs an integer, got '${value}'`);
    return Number.parseInt(value, 10);
  };
  if (positionals.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  const mode = options.mode ?? "layout";
  if (mode !== "layout" && mode !== "pixel") {
    console.error(`${USAGE}\nimgdiff: --mode must be layout or pixel`);
    return 2;
  }
  const [originalPath, clonePath] = positionals as [string, string];
  let report: ImgDiffReport;
  let diff: RgbImage;
  try {
    const a = decodePng(await Bun.file(originalPath).bytes(), originalPath);
    const b = decodePng(await Bun.file(clonePath).bytes(), clonePath);
    ({ report, diff } = compareImages(a, b, {
      mode,
      width: integer("width", 480),
      cols: integer("cols", 12),
      tolerance: integer("tolerance", 24),
    }));
  } catch (error) {
    console.error(`imgdiff: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  report.files = { original: originalPath, clone: clonePath };
  if (options.out) {
    await Bun.write(options.out, encodePng(diff));
    report.diff_image = options.out;
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderImgDiff(report, originalPath, clonePath));
    if (options.out) console.log(`  diff image: ${options.out}`);
  }
  const failUnder = options["fail-under"] !== undefined ? Number(options["fail-under"]) : undefined;
  return failUnder !== undefined && report.score < failUnder ? 1 : 0;
}

if (import.meta.main) process.exitCode = await imgdiffMain(Bun.argv.slice(2));
