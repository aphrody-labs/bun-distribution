// Steam library artwork for Bun Engine shortcuts, drawn from the engine's own look (indigo
// gradient, scanlines, the bun mark and a 5x7 pixel font) or composed around a libretro
// thumbnail when one is available locally. Encodes PNG with node:zlib and Bun.hash.crc32.
import { deflateSync } from "node:zlib";

export interface Canvas {
  width: number;
  height: number;
  data: Uint8Array;
}

// 5x7 glyphs, one byte per row (low 5 bits, MSB = left column).
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

type Rgba = [number, number, number, number];
const BG_TOP: Rgba = [0x1b, 0x12, 0x3a, 255];
const BG_BOTTOM: Rgba = [0x07, 0x05, 0x14, 255];
const ACCENT: Rgba = [0xff, 0xb3, 0x47, 255];
const BUN: Rgba = [0xf4, 0xd0, 0x8a, 255];
const WHITE: Rgba = [0xf5, 0xf3, 0xff, 255];

export function canvas(width: number, height: number): Canvas {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function blend(c: Canvas, x: number, y: number, [r, g, b, a]: Rgba): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  const d = c.data;
  const alpha = a / 255;
  const keep = 1 - alpha;
  d[i] = r * alpha + d[i]! * keep;
  d[i + 1] = g * alpha + d[i + 1]! * keep;
  d[i + 2] = b * alpha + d[i + 2]! * keep;
  d[i + 3] = Math.min(255, a + d[i + 3]! * keep);
}

function background(c: Canvas): void {
  for (let y = 0; y < c.height; y++) {
    const t = y / Math.max(1, c.height - 1);
    const scan = y % 4 === 0 ? 0.82 : 1;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      for (let k = 0; k < 3; k++)
        c.data[i + k] = (BG_TOP[k]! * (1 - t) + BG_BOTTOM[k]! * t) * scan;
      c.data[i + 3] = 255;
    }
  }
}

/** The bun mark: a golden dome with a highlight and a seam. */
function bun(c: Canvas, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y * 1.25) / r;
      if (d > 1) continue;
      const shade = 1 - 0.35 * Math.max(0, (x + y) / r);
      blend(c, cx + x, cy + y, [
        BUN[0] * shade,
        BUN[1] * shade,
        BUN[2] * shade,
        255,
      ]);
      if (Math.abs(y + r * 0.1) < r * 0.05 && Math.abs(x) < r * 0.75)
        blend(c, cx + x, cy + y, [0x8a, 0x55, 0x22, 200]);
      if (Math.hypot(x + r * 0.35, y + r * 0.45) < r * 0.18)
        blend(c, cx + x, cy + y, [255, 255, 255, 120]);
    }
}

const glyph = (ch: string) => FONT[ch] ?? FONT["?"]!;

/** Largest scale (at most `max`) at which `value` fits in `width` pixels. */
export function fit(value: string, width: number, max: number): number {
  return Math.max(
    1,
    Math.min(max, Math.floor((width + 1) / (value.length * 6))),
  );
}

export function textWidth(text: string, scale: number): number {
  return text.length ? text.length * 6 * scale - scale : 0;
}

export function text(
  c: Canvas,
  value: string,
  x: number,
  y: number,
  scale: number,
  color: Rgba,
): void {
  let cx = Math.round(x);
  const shadow = Math.max(1, Math.round(scale / 3));
  for (const ch of value.toUpperCase()) {
    const rows = glyph(ch);
    rows.forEach((bits, row) => {
      for (let col = 0; col < 5; col++) {
        if (!(bits & (0x10 >> col))) continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            blend(
              c,
              cx + col * scale + dx + shadow,
              y + row * scale + dy + shadow,
              [0, 0, 0, 140],
            );
            blend(c, cx + col * scale + dx, y + row * scale + dy, color);
          }
      }
    });
    cx += 6 * scale;
  }
}

/** Greedy word wrap to `columns` characters, at most `lines` lines. */
export function wrap(value: string, columns: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= columns) line = next;
    else {
      if (line) out.push(line);
      line = word.slice(0, columns);
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1]!.slice(0, columns - 2)}..`;
  }
  return out;
}

function centered(
  c: Canvas,
  lines: string[],
  top: number,
  scale: number,
  color: Rgba,
): number {
  for (const [i, line] of lines.entries())
    text(
      c,
      line,
      Math.round((c.width - textWidth(line, scale)) / 2),
      top + i * 10 * scale,
      scale,
      color,
    );
  return top + lines.length * 10 * scale;
}

/** Draws `art` (RGBA) scaled-to-fit inside the box, centered. */
export function paste(
  c: Canvas,
  art: Canvas,
  box: { x: number; y: number; w: number; h: number },
): void {
  const s = Math.min(box.w / art.width, box.h / art.height);
  const w = Math.round(art.width * s);
  const h = Math.round(art.height * s);
  const ox = box.x + Math.round((box.w - w) / 2);
  const oy = box.y + Math.round((box.h - h) / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(art.width - 1, Math.floor(x / s));
      const sy = Math.min(art.height - 1, Math.floor(y / s));
      const i = (sy * art.width + sx) * 4;
      blend(c, ox + x, oy + y, [
        art.data[i]!,
        art.data[i + 1]!,
        art.data[i + 2]!,
        art.data[i + 3]!,
      ]);
    }
}

export interface ArtSpec {
  title: string;
  subtitle: string;
  /** Optional cover (libretro Named_Boxarts) already decoded to RGBA. */
  cover?: Canvas;
}

/** Portrait capsule (600x900, `<appid>p.png`). */
export function grid(spec: ArtSpec): Canvas {
  const c = canvas(600, 900);
  background(c);
  if (spec.cover) paste(c, spec.cover, { x: 30, y: 30, w: 540, h: 660 });
  else bun(c, 300, 300, 150);
  const bottom = centered(
    c,
    wrap(spec.title, 14, 3),
    spec.cover ? 712 : 520,
    6,
    WHITE,
  );
  centered(
    c,
    [spec.subtitle],
    Math.min(860, bottom + 12),
    fit(spec.subtitle, 560, 4),
    ACCENT,
  );
  return c;
}

/** Wide capsule (920x430, `<appid>.png`). */
export function wide(spec: ArtSpec): Canvas {
  const c = canvas(920, 430);
  background(c);
  if (spec.cover) paste(c, spec.cover, { x: 24, y: 24, w: 300, h: 382 });
  else bun(c, 170, 215, 110);
  const lines = wrap(spec.title, 14, 3);
  const scale = Math.min(...lines.map((line) => fit(line, 540, 7)));
  lines.forEach((line, i) =>
    text(c, line, 350, 90 + i * 10 * scale, scale, WHITE),
  );
  text(
    c,
    spec.subtitle,
    350,
    110 + lines.length * 10 * scale,
    fit(spec.subtitle, 540, 4),
    ACCENT,
  );
  return c;
}

/** Hero (1920x620, `<appid>_hero.png`): no text, Steam draws the logo over it. */
export function hero(spec: ArtSpec): Canvas {
  const c = canvas(1920, 620);
  background(c);
  for (let i = 0; i < 9; i++) bun(c, 160 + i * 210, 470 - (i % 2) * 60, 70);
  if (spec.cover) paste(c, spec.cover, { x: 1380, y: 40, w: 500, h: 540 });
  return c;
}

/** Transparent logo (1280x400, `<appid>_logo.png`). */
export function logo(spec: ArtSpec): Canvas {
  const c = canvas(1280, 400);
  const lines = wrap(spec.title, 20, 2);
  centered(c, lines, 60, 10, WHITE);
  centered(
    c,
    [spec.subtitle],
    80 + lines.length * 100,
    fit(spec.subtitle, 1240, 6),
    ACCENT,
  );
  return c;
}

/** Square icon (256x256, `<appid>_icon.png`). */
export function icon(initials: string): Canvas {
  const c = canvas(256, 256);
  background(c);
  bun(c, 128, 110, 80);
  centered(c, [initials.slice(0, 3)], 190, 7, WHITE);
  return c;
}

const crcInput = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(type.length + data.length);
  out.set(new TextEncoder().encode(type));
  out.set(data, type.length);
  return out;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(crcInput(type, data)));
  return out;
}

/** Encodes an RGBA canvas as PNG (color type 6, filter 0). */
export function png(c: Canvas): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, c.width);
  view.setUint32(4, c.height);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = c.width * 4;
  const raw = new Uint8Array((stride + 1) * c.height);
  for (let y = 0; y < c.height; y++)
    raw.set(
      c.data.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 6 }))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Decodes an image file (PNG/JPEG/WebP) to an RGBA canvas through Bun.Image. */
export async function decode(bytes: Uint8Array): Promise<Canvas> {
  // `rgba()` ships in Bun 1.4.4 (docs/runtime/image); the bundled typings predate it.
  const image = new Bun.Image(bytes.slice(), {
    maxPixels: 4096 * 4096,
  }) as Bun.Image & { rgba(): Promise<Canvas> };
  const { width, height, data } = await image.rgba();
  return { width, height, data };
}
