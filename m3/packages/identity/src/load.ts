// SPDX-License-Identifier: Apache-2.0
// loadIcon(): the browser side of crates/ui/identity's loader (src/loader.rs). Same sources
// (`symbol:<name>?…`, URLs, bytes, Blob), same request (size, scale, tint, fit) and same ICO rule
// (the smallest entry covering size × scale, the deepest on ties, else the largest). Decoding is the
// browser's own: createImageBitmap for PNG, JPEG, WebP, GIF and the chosen ICO entry (its PNG, or a
// one-entry ICO for a BMP entry), an <img> for SVG.
//
//   const { bitmap } = await loadIcon("/favicon.ico", { size: 32 });
//   const { svg } = await loadIcon("symbol:home?style=rounded&fill=1", { size: 24, tint: "#6750a4", output: "svg" });

export type IconFormat = "png" | "jpeg" | "webp" | "gif" | "svg" | "ico" | "symbol";
export type Fit = "contain" | "cover" | "fill" | "none";
export type IconSource = string | URL | Blob | ArrayBuffer | Uint8Array;
type Bytes = Uint8Array<ArrayBuffer>;

export interface LoadIconOptions {
  /** Side of the target square in CSS px; the intrinsic size when absent. */
  size?: number;
  /** Device pixel ratio applied to `size`, in ]0, 16]. Default 1. */
  scale?: number;
  /** `#rgb`, `#rrggbb` or `#rrggbbaa`: colour replaced, alpha multiplied. */
  tint?: string;
  fit?: Fit;
  /** `bitmap` (default, an ImageBitmap) or `svg` (markup, SVG and symbols only). */
  output?: "bitmap" | "svg";
  /** Origin of `symbol:` sources. Default https://cdn.aphrody.com/ (gstatic layout). */
  origin?: string;
  fetch?: typeof fetch;
}

export interface IcoEntryInfo {
  width: number;
  height: number;
  bits: number;
  png: boolean;
}

export interface LoadedIcon {
  format: IconFormat;
  intrinsic: [number, number];
  /** Every entry of an ICO, empty for other formats. */
  entries: IcoEntryInfo[];
  /** Index of the ICO entry drawn. */
  entry?: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  svg?: string;
}

export class LoadIconError extends Error {
  override name = "LoadIconError";
}

export const SYMBOLS_ORIGIN = "https://cdn.aphrody.com/";
const MAX_SIDE = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;
const STYLES = ["outlined", "rounded", "sharp"] as const;
const AXES = {
  fill: [0, 1],
  wght: [100, 200, 300, 400, 500, 600, 700],
  grad: [-25, 0, 200],
  opsz: [20, 24, 40, 48],
} as const;

export interface SymbolSpec {
  name: string;
  style: (typeof STYLES)[number];
  fill: number;
  wght: number;
  grad: number;
  opsz: number;
}

/** `symbol:home?style=rounded&fill=1&wght=300&grad=-25&opsz=48`, limited to the CDN variants. */
export function parseSymbol(specifier: string): SymbolSpec {
  const body = specifier.replace(/^symbol:/, "");
  const q = body.indexOf("?");
  const name = q < 0 ? body : body.slice(0, q);
  if (!/^[a-z0-9_]+$/.test(name))
    throw new LoadIconError(`symbol: name "${name}" (expected [a-z0-9_]+)`);
  const spec: SymbolSpec = {
    name,
    style: "outlined",
    fill: 0,
    wght: 400,
    grad: 0,
    opsz: 24,
  };
  for (const [key, value] of new URLSearchParams(q < 0 ? "" : body.slice(q + 1))) {
    if (key === "style") {
      const style = STYLES.find((s) => s === value);
      if (!style)
        throw new LoadIconError(`symbol: style=${value} (expected outlined, rounded or sharp)`);
      spec.style = style;
    } else if (key in AXES) {
      const allowed: readonly number[] = AXES[key as keyof typeof AXES];
      const n = Number(value);
      if (value === "" || !allowed.includes(n)) {
        throw new LoadIconError(`symbol: ${key}=${value} (expected one of ${allowed.join(", ")})`);
      }
      spec[key as keyof typeof AXES] = n;
    } else {
      throw new LoadIconError(`symbol: unknown parameter "${key}" (style, fill, wght, grad, opsz)`);
    }
  }
  return spec;
}

export function symbolUrl(spec: SymbolSpec, origin: string = SYMBOLS_ORIGIN): string {
  let variant = spec.wght === 400 ? "" : `wght${spec.wght}`;
  variant += spec.grad < 0 ? "gradN25" : spec.grad > 0 ? "grad200" : "";
  variant += spec.fill ? "fill1" : "";
  const base = origin.endsWith("/") ? origin : `${origin}/`;
  return `${base}s/i/short-term/release/materialsymbols${spec.style}/${spec.name}/${variant || "default"}/${spec.opsz}px.svg`;
}

function isSvg(bytes: Uint8Array): boolean {
  let text = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();
  for (;;) {
    const m = /^(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)/.exec(text);
    if (!m) break;
    text = text.slice(m[0].length).trimStart();
  }
  return /^<svg[\s>/]/.test(text);
}

/** Format from the magic bytes, as `Format::detecter` in the crate. */
export function detectFormat(bytes: Uint8Array): Exclude<IconFormat, "symbol"> | undefined {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return "gif";
  if (
    b.length >= 6 &&
    b[0] === 0 &&
    b[1] === 0 &&
    b[2] === 1 &&
    b[3] === 0 &&
    (b[4]! | (b[5]! << 8)) > 0
  )
    return "ico";
  return isSvg(b) ? "svg" : undefined;
}

export interface IcoEntry extends IcoEntryInfo {
  data: Bytes;
}

/** The directory of an ICO; sizes of PNG entries come from their IHDR. */
export function icoEntries(bytes: Bytes): IcoEntry[] {
  if (detectFormat(bytes) !== "ico") throw new LoadIconError("ico: not an icon file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  if (6 + count * 16 > bytes.length)
    throw new LoadIconError(`ico: directory of ${count} entries is truncated`);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (size === 0 || offset + size > bytes.length)
      throw new LoadIconError(`ico: entry ${i} points past the end`);
    const data = bytes.subarray(offset, offset + size);
    const png = detectFormat(data) === "png";
    if (png && data.length < 24)
      throw new LoadIconError(`ico: entry ${i} has a truncated PNG header`);
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      width: png ? d.getUint32(16) : bytes[at] || 256,
      height: png ? d.getUint32(20) : bytes[at + 1] || 256,
      bits:
        view.getUint16(at + 6, true) || (png ? 32 : data.length >= 16 ? d.getUint16(14, true) : 0),
      png,
      data,
    };
  });
}

/** `meilleure_entree` of the crate: the smallest entry covering `target`, else the largest. */
export function bestEntry(entries: readonly IcoEntryInfo[], target?: number): number {
  const side = (e: IcoEntryInfo) => Math.max(e.width, e.height);
  let best = -1;
  if (target !== undefined) {
    entries.forEach((e, i) => {
      const b = entries[best];
      if (
        side(e) >= target &&
        (!b || side(e) < side(b) || (side(e) === side(b) && e.bits > b.bits))
      )
        best = i;
    });
    if (best >= 0) return best;
  }
  entries.forEach((e, i) => {
    const b = entries[best];
    if (!b || side(e) > side(b) || (side(e) === side(b) && e.bits >= b.bits)) best = i;
  });
  return best;
}

/** The entry as a Blob the browser decodes: its PNG, or a one-entry ICO around the BMP. */
export function icoEntryBlob(entry: IcoEntry): Blob {
  if (entry.png) return new Blob([entry.data], { type: "image/png" });
  const head = new Uint8Array(22);
  const view = new DataView(head.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  head[6] = entry.width >= 256 ? 0 : entry.width;
  head[7] = entry.height >= 256 ? 0 : entry.height;
  view.setUint16(10, 1, true);
  view.setUint16(12, entry.bits, true);
  view.setUint32(14, entry.data.length, true);
  view.setUint32(18, 22, true);
  return new Blob([head, entry.data], { type: "image/x-icon" });
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa` → [r, g, b, a]. */
export function parseColor(hex: string): [number, number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
}

function px(v: number): number {
  const r = Math.round(v);
  if (!Number.isFinite(r) || r < 1 || r > MAX_SIDE)
    throw new LoadIconError(`side of ${r} px out of 1..${MAX_SIDE}`);
  return r;
}

/** Output size and, for `cover`, the side of the centred square crop. Same arithmetic as the crate. */
export function dimensions(
  [w, h]: [number, number],
  { size, scale = 1, fit = "contain" }: Pick<LoadIconOptions, "size" | "scale" | "fit">,
): { width: number; height: number; crop?: number } {
  if (!(w > 0 && h > 0)) throw new LoadIconError("image of zero size");
  if (!(scale > 0 && scale <= 16)) throw new LoadIconError(`scale ${scale} out of ]0, 16]`);
  if (size !== undefined && !(size > 0)) throw new LoadIconError(`size ${size} must be positive`);
  let out: { width: number; height: number; crop?: number };
  if (size === undefined || fit === "none") out = { width: px(w * scale), height: px(h * scale) };
  else {
    const side = size * scale;
    if (fit === "fill") out = { width: px(side), height: px(side) };
    else {
      const r = fit === "cover" ? Math.max(side / w, side / h) : Math.min(side / w, side / h);
      out = {
        width: px(w * r),
        height: px(h * r),
        ...(fit === "cover" ? { crop: px(side) } : {}),
      };
    }
  }
  if (out.width * out.height > MAX_PIXELS)
    throw new LoadIconError(`${out.width}x${out.height} exceeds ${MAX_PIXELS} pixels`);
  return out;
}

function svgIntrinsic(svg: string): [number, number] {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const attr = (n: string) => new RegExp(`\\s${n}="\\s*([\\d.]+)(px)?\\s*"`).exec(tag)?.[1];
  const [w, h] = [Number(attr("width")), Number(attr("height"))];
  if (w > 0 && h > 0) return [w, h];
  const box = /\sviewBox="([^"]+)"/
    .exec(tag)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && box.length === 4 && box[2]! > 0 && box[3]! > 0) return [box[2]!, box[3]!];
  throw new LoadIconError("svg: no width/height or viewBox");
}

const UNSAFE_SVG = /<script\b|<foreignObject\b|\son\w+\s*=|javascript:/i;

/** Root `width`/`height`, `preserveAspectRatio` for the fit, and the tint as `fill` and `color`. */
function sizedSvg(
  svg: string,
  width: number,
  height: number,
  fit: Fit,
  tint: string | undefined,
): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, "");
    if (tint) t = t.replace(/\s(fill|color)="[^"]*"/g, "");
    const extra = [`width="${width}"`, `height="${height}"`];
    if (fit === "fill") extra.push(`preserveAspectRatio="none"`);
    if (fit === "cover") extra.push(`preserveAspectRatio="xMidYMid slice"`);
    if (tint) extra.push(`fill="${tint}"`, `color="${tint}"`);
    return t.replace(/^<svg\b/, `<svg ${extra.join(" ")}`);
  });
}

async function bytesOf(source: Exclude<IconSource, string | URL>): Promise<Bytes> {
  if (source instanceof Uint8Array)
    return source.buffer instanceof ArrayBuffer ? (source as Bytes) : new Uint8Array(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}

async function fetchBytes(url: string, f: typeof fetch): Promise<Bytes | undefined> {
  let response: Response;
  try {
    response = await f(url);
  } catch (error) {
    throw new LoadIconError(`${url}: ${(error as Error).message}`);
  }
  if (response.status === 404) return undefined;
  if (!response.ok) throw new LoadIconError(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function needBitmap(): void {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new LoadIconError(
      'output "bitmap" needs createImageBitmap and OffscreenCanvas (a browser)',
    );
  }
}

/** Resize to `width`×`height` (high quality), crop the centre for cover, tint. */
async function finish(
  image: ImageBitmapSource,
  out: { width: number; height: number; crop?: number },
  tint: [number, number, number, number] | undefined,
): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(image, {
    resizeWidth: out.width,
    resizeHeight: out.height,
    resizeQuality: "high",
  });
  if (image instanceof ImageBitmap) image.close();
  if (!out.crop && !tint) return bitmap;
  const cw = Math.min(out.crop ?? out.width, out.width);
  const ch = Math.min(out.crop ?? out.height, out.height);
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LoadIconError("no 2D context");
  ctx.drawImage(bitmap, -Math.floor((out.width - cw) / 2), -Math.floor((out.height - ch) / 2));
  bitmap.close();
  if (tint) {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3] / 255})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  return canvas.transferToImageBitmap();
}

async function svgImage(svg: string): Promise<HTMLImageElement> {
  if (typeof Image !== "function")
    throw new LoadIconError("svg to bitmap needs a document (Image)");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Load an image or icon. `symbol:` sources come from the CDN; strings and URLs are fetched; bytes,
 * ArrayBuffers and Blobs are read as is. Throws LoadIconError with a message naming the cause.
 */
export async function loadIcon(
  source: IconSource,
  options: LoadIconOptions = {},
): Promise<LoadedIcon> {
  const { size, scale = 1, fit = "contain", output = "bitmap" } = options;
  const f = options.fetch ?? globalThis.fetch;
  const tint = options.tint === undefined ? undefined : parseColor(options.tint);
  if (options.tint !== undefined && !tint)
    throw new LoadIconError(`tint ${options.tint} (expected #rgb, #rrggbb or #rrggbbaa)`);

  let bytes: Bytes;
  let format: IconFormat | undefined;
  let glyph: number | undefined;
  if (typeof source === "string" && source.startsWith("symbol:")) {
    const spec = parseSymbol(source);
    const url = symbolUrl(spec, options.origin);
    const got = await fetchBytes(url, f);
    if (!got)
      throw new LoadIconError(`symbol: unknown symbol "${spec.name}" (${spec.style}) at ${url}`);
    [bytes, format, glyph] = [got, "symbol", spec.opsz];
  } else if (typeof source === "string" || source instanceof URL) {
    const url = String(source);
    const got = await fetchBytes(url, f);
    if (!got) throw new LoadIconError(`${url}: not found`);
    bytes = got;
  } else {
    bytes = await bytesOf(source);
  }
  const detected = detectFormat(bytes);
  if (format === "symbol" ? detected !== "svg" : !detected) {
    throw new LoadIconError(
      format === "symbol" ? "symbol: the CDN did not answer an SVG" : "unknown image format",
    );
  }
  format ??= detected!;

  if (format === "svg" || format === "symbol") {
    const svg = new TextDecoder().decode(bytes);
    const intrinsic: [number, number] = glyph ? [glyph, glyph] : svgIntrinsic(svg);
    const out = dimensions(intrinsic, { size, scale, fit });
    if (output === "svg") {
      if (UNSAFE_SVG.test(svg))
        throw new LoadIconError("svg: scripts, event handlers and foreignObject are refused");
      const side = out.crop ?? undefined;
      const markup = sizedSvg(svg, side ?? out.width, side ?? out.height, fit, options.tint);
      return {
        format,
        intrinsic,
        entries: [],
        width: side ?? out.width,
        height: side ?? out.height,
        svg: markup,
      };
    }
    needBitmap();
    const drawn = sizedSvg(
      svg,
      out.width,
      out.height,
      fit === "cover" ? "contain" : fit,
      undefined,
    );
    const bitmap = await finish(await svgImage(drawn), out, tint);
    return {
      format,
      intrinsic,
      entries: [],
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
    };
  }
  if (output === "svg") throw new LoadIconError(`a ${format} source has no SVG output`);
  needBitmap();

  if (format === "ico") {
    const entries = icoEntries(bytes);
    const target = size === undefined ? undefined : Math.min(Math.round(size * scale), MAX_SIDE);
    const entry = bestEntry(entries, target);
    const chosen = entries[entry]!;
    let decoded: ImageBitmap;
    try {
      decoded = await createImageBitmap(icoEntryBlob(chosen));
    } catch (error) {
      throw new LoadIconError(`ico: entry ${entry}: ${(error as Error).message}`);
    }
    const intrinsic: [number, number] = [decoded.width, decoded.height];
    const bitmap = await finish(decoded, dimensions(intrinsic, { size, scale, fit }), tint);
    const info = entries.map(({ width, height, bits, png }) => ({
      width,
      height,
      bits,
      png,
    }));
    return {
      format,
      intrinsic,
      entries: info,
      entry,
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
    };
  }

  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }));
  } catch (error) {
    throw new LoadIconError(`${format}: ${(error as Error).message}`);
  }
  const intrinsic: [number, number] = [decoded.width, decoded.height];
  const bitmap = await finish(decoded, dimensions(intrinsic, { size, scale, fit }), tint);
  return {
    format,
    intrinsic,
    entries: [],
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
  };
}
