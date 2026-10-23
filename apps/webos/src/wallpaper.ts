// SPDX-License-Identifier: Apache-2.0
// Desktop wallpaper, painted on one 2D canvas from a WallpaperSpec (prefs.ts): a generated contour map of an
// invented terrain lit by glows in M3 roles (seed, density and colours editable), a solid colour, a gradient,
// or a picture from the WebOS file system. Nothing animates and nothing is downloaded.
import { HOME, webos } from "./os";
import type { ColorToken, WallpaperSpec } from "./prefs";

type Rgb = [number, number, number];

function parseColor(value: string): Rgb | undefined {
  const v = value.trim();
  if (v.startsWith("#")) {
    const hex =
      v.length === 4
        ? v
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : v.slice(1, 7);
    const n = Number.parseInt(hex, 16);
    return Number.isNaN(n)
      ? undefined
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const [r = 0, g = 0, b = 0] = m[1]!.split(/[ ,/]+/).map(Number);
    return [r, g, b];
  }
  return undefined;
}
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const luminance = ([r, g, b]: Rgb) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Resolve a colour token (an M3 role name or #rrggbb) against the current theme. */
export function resolveToken(token: ColorToken): string {
  if (token.startsWith("#")) return token;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--md-sys-color-${token}`)
      .trim() || token
  );
}
const rgbOf = (token: ColorToken, fallback: Rgb): Rgb =>
  parseColor(resolveToken(token)) ?? fallback;

/** Deterministic pseudo-random numbers from a seed. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Deterministic value noise so the same terrain appears on every visit. */
function noise2(seed: number) {
  const perm = new Uint8Array(512);
  const rand = lcg(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const grad = (h: number) => (perm[h]! / 255) * 2 - 1;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = grad(perm[(xi & 255) + perm[yi & 255]!]!);
    const b = grad(perm[((xi + 1) & 255) + perm[yi & 255]!]!);
    const c = grad(perm[(xi & 255) + perm[(yi + 1) & 255]!]!);
    const d = grad(perm[((xi + 1) & 255) + perm[(yi + 1) & 255]!]!);
    const u = fade(xf);
    const v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function contour(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: WallpaperSpec,
  dark: boolean,
) {
  const span = Math.max(w, h);
  const base = rgbOf("surface-container-lowest", [20, 20, 30]);
  const surface = rgbOf("surface", base);
  const [g1, g2, g3] = spec.glows.map((t) => rgbOf(t, surface)) as [
    Rgb,
    Rgb,
    Rgb,
  ];

  // Ground: a slow diagonal fall from the lowest surface into a tinted dusk.
  const ground = ctx.createLinearGradient(0, 0, w, h);
  ground.addColorStop(0, rgba(mix(base, g1, dark ? 0.04 : 0.1), 1));
  ground.addColorStop(0.55, rgba(mix(surface, g3, dark ? 0.06 : 0.12), 1));
  ground.addColorStop(1, rgba(mix(base, g2, dark ? 0.08 : 0.16), 1));
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  const glow = (x: number, y: number, r: number, color: Rgb, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.45, rgba(color, a * 0.45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.8, h * 0.1, span * 0.62, g1, dark ? 0.42 : 0.4);
  glow(w * 0.06, h * 0.94, span * 0.55, g2, dark ? 0.3 : 0.32);
  glow(w * 0.46, h * 1.1, span * 0.42, g3, dark ? 0.22 : 0.24);

  // Terrain: broad hills placed by the seed plus fractal noise, traced as contour lines with marching squares.
  const n = noise2(spec.seed);
  const rand = lcg(spec.seed ^ 0x9e3779b9);
  const hills = Array.from(
    { length: 5 },
    (_, i) =>
      [
        0.1 + rand() * 0.8,
        0.1 + rand() * 0.8,
        0.14 + rand() * 0.18,
        1 - i * 0.14,
      ] as const,
  );
  const field = (x: number, y: number) => {
    const nx = x / span;
    const ny = y / span;
    let v = 0;
    for (const [hx, hy, r, a] of hills) {
      const dx = nx - (hx * w) / span;
      const dy = ny - (hy * h) / span;
      v += a * Math.exp(-(dx * dx + dy * dy) / (r * r));
    }
    v +=
      0.32 * n(nx * 3.1, ny * 3.1) +
      0.14 * n(nx * 7.3 + 11, ny * 7.3 + 5) +
      0.06 * n(nx * 17 + 3, ny * 17 + 9);
    return v;
  };
  const step = 6;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const grid = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const v = field(i * step, j * step);
      grid[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  const lineBase = rgbOf(spec.lines, g1);
  const line = dark
    ? mix(lineBase, [255, 255, 255], 0.35)
    : mix(lineBase, [0, 0, 0], 0.25);
  const levels = spec.levels;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let l = 1; l < levels; l++) {
    const t = min + ((max - min) * l) / levels;
    const index = l % 5 === 0;
    const height = l / levels;
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = grid[j * cols + i]!;
        const b = grid[j * cols + i + 1]!;
        const c = grid[(j + 1) * cols + i + 1]!;
        const d = grid[(j + 1) * cols + i]!;
        const code =
          (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x = i * step;
        const y = j * step;
        const top = () => [x + step * ((t - a) / (b - a)), y] as const;
        const right = () => [x + step, y + step * ((t - b) / (c - b))] as const;
        const bottom = () =>
          [x + step * ((t - d) / (c - d)), y + step] as const;
        const left = () => [x, y + step * ((t - a) / (d - a))] as const;
        const seg = (
          p: readonly [number, number],
          q: readonly [number, number],
        ) => {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        };
        switch (code) {
          case 1:
          case 14:
            seg(left(), bottom());
            break;
          case 2:
          case 13:
            seg(bottom(), right());
            break;
          case 3:
          case 12:
            seg(left(), right());
            break;
          case 4:
          case 11:
            seg(top(), right());
            break;
          case 6:
          case 9:
            seg(top(), bottom());
            break;
          case 7:
          case 8:
            seg(left(), top());
            break;
          case 5:
            seg(left(), top());
            seg(bottom(), right());
            break;
          case 10:
            seg(top(), right());
            seg(left(), bottom());
            break;
        }
      }
    const alpha =
      (dark ? 0.05 : 0.07) + height * (dark ? 0.09 : 0.08) + (index ? 0.06 : 0);
    ctx.strokeStyle = rgba(line, alpha);
    ctx.lineWidth = index ? 1.25 : 0.8;
    ctx.stroke();
  }

  // Edge falloff keeps the bar and dock legible over the brightest glow.
  const edge = ctx.createRadialGradient(
    w / 2,
    h * 0.45,
    span * 0.25,
    w / 2,
    h * 0.45,
    span * 0.8,
  );
  edge.addColorStop(0, rgba(base, 0));
  edge.addColorStop(1, rgba(base, dark ? 0.55 : 0.3));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
}

/** Paint the wallpaper into the canvas from a spec and the current M3 roles. */
export function paintWallpaper(
  canvas: HTMLCanvasElement,
  spec: WallpaperSpec,
  picture?: ImageBitmap,
) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const surface = rgbOf("surface", [20, 20, 30]);
  const dark = luminance(surface) < 0.5;

  if (spec.kind === "solid") {
    ctx.fillStyle = rgba(rgbOf(spec.solid, surface), 1);
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (spec.kind === "gradient") {
    const rad = ((spec.angle - 90) * Math.PI) / 180;
    const len = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
    const [cx, cy, dx, dy] = [
      w / 2,
      h / 2,
      Math.cos(rad) * len,
      Math.sin(rad) * len,
    ];
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, rgba(rgbOf(spec.gradient[0], surface), 1));
    g.addColorStop(1, rgba(rgbOf(spec.gradient[1], surface), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (spec.kind === "image" && picture) {
    ctx.fillStyle = rgba(rgbOf("surface-container-lowest", surface), 1);
    ctx.fillRect(0, 0, w, h);
    const scale = (spec.fit === "cover" ? Math.max : Math.min)(
      w / picture.width,
      h / picture.height,
    );
    const pw = picture.width * scale;
    const ph = picture.height * scale;
    ctx.drawImage(picture, (w - pw) / 2, (h - ph) / 2, pw, ph);
    if (spec.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${spec.dim})`;
      ctx.fillRect(0, 0, w, h);
    }
    return;
  }
  contour(ctx, w, h, spec, dark);
}

const pictures = new Map<string, Promise<ImageBitmap | undefined>>();
/** Decode a picture of the WebOS file system once per path. */
export function loadPicture(path: string): Promise<ImageBitmap | undefined> {
  let p = pictures.get(path);
  if (!p) {
    p = webos()
      .then((os) =>
        createImageBitmap(
          new Blob([os.fs.read(path) as Uint8Array<ArrayBuffer>]),
        ),
      )
      .catch(() => undefined);
    pictures.set(path, p);
  }
  return p;
}
/** Forget a decoded picture after the file changed. */
export const forgetPicture = (path: string) => pictures.delete(path);

/** Folder new wallpaper pictures are copied into. */
export const WALLPAPER_DIR = `${HOME}/Pictures/Wallpapers`;

export interface WallpaperController {
  /** Show this spec (repaints only when it, the theme or the size changed). */
  show(spec: WallpaperSpec): void;
  /** Repaint after a theme change. */
  repaint(): void;
}

/** Mount the wallpaper canvas behind the desktop and repaint it on resize, theme and spec changes. */
export function mountWallpaper(initial: WallpaperSpec): WallpaperController {
  const canvas = document.createElement("canvas");
  canvas.className = "wallpaper";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  let spec = initial;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drawn = "";
  let generation = 0;
  const paint = (force = false) => {
    const key = JSON.stringify(spec);
    if (!force && key === drawn) return;
    const mine = ++generation;
    const current = spec;
    const picture =
      current.kind === "image" && current.image
        ? loadPicture(current.image)
        : Promise.resolve(undefined);
    void picture.then((bitmap) => {
      if (mine !== generation) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A missing picture falls back to the generated map instead of a blank desktop.
        paintWallpaper(
          canvas,
          current.kind === "image" && !bitmap
            ? { ...current, kind: "contour" }
            : current,
          bitmap,
        );
        drawn = key;
        canvas.classList.add("ready");
      });
    });
  };
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => paint(true), 120);
  }).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
    paint(true),
  );
  paint(true);
  return {
    show(next) {
      spec = next;
      paint();
    },
    repaint: () => paint(true),
  };
}
