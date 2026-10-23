// SPDX-License-Identifier: Apache-2.0
// Generated wallpaper: a contour map of an invented terrain, lit by soft glows in the theme's accent roles.
// Drawn once per theme or size on a 2D canvas; nothing animates, nothing is downloaded.

type Rgb = [number, number, number];

function parseColor(value: string): Rgb {
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
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const [r = 0, g = 0, b = 0] = m[1]!.split(/[ ,/]+/).map(Number);
    return [r, g, b];
  }
  return [20, 20, 30];
}
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const luminance = ([r, g, b]: Rgb) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Deterministic value noise so the same terrain appears on every visit. */
function noise2(seed: number) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
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

/** Paint the wallpaper into the canvas from the current M3 roles. */
export function paintWallpaper(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const css = getComputedStyle(document.documentElement);
  const role = (name: string) =>
    parseColor(css.getPropertyValue(`--md-sys-color-${name}`) || "#222");
  const base = role("surface-container-lowest");
  const surface = role("surface");
  const primary = role("primary");
  const secondary = role("secondary");
  const tertiary = role("tertiary");
  const dark = luminance(surface) < 0.5;

  // Ground: a slow diagonal fall from the lowest surface into a primary-tinted dusk.
  const ground = ctx.createLinearGradient(0, 0, w, h);
  ground.addColorStop(0, rgba(mix(base, primary, dark ? 0.04 : 0.1), 1));
  ground.addColorStop(
    0.55,
    rgba(mix(surface, secondary, dark ? 0.06 : 0.12), 1),
  );
  ground.addColorStop(1, rgba(mix(base, tertiary, dark ? 0.08 : 0.16), 1));
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
  const span = Math.max(w, h);
  glow(w * 0.8, h * 0.1, span * 0.62, primary, dark ? 0.42 : 0.4);
  glow(w * 0.06, h * 0.94, span * 0.55, tertiary, dark ? 0.3 : 0.32);
  glow(w * 0.46, h * 1.1, span * 0.42, secondary, dark ? 0.22 : 0.24);

  // Terrain: a few broad hills plus fractal noise, traced as contour lines with marching squares.
  const n = noise2(0xb0b05);
  const hills: [number, number, number, number][] = [
    [0.72, 0.3, 0.26, 1],
    [0.3, 0.62, 0.3, 0.85],
    [0.88, 0.78, 0.18, 0.55],
    [0.14, 0.2, 0.2, 0.5],
    [0.52, 0.12, 0.16, 0.35],
  ];
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
  const line = dark
    ? mix(primary, [255, 255, 255], 0.35)
    : mix(primary, [0, 0, 0], 0.25);
  const levels = 26;
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

/** Mount the wallpaper canvas into the desktop and repaint it on resize and theme changes. */
export function mountWallpaper(): () => void {
  const canvas = document.createElement("canvas");
  canvas.className = "wallpaper";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const paint = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      paintWallpaper(canvas);
      canvas.classList.add("ready");
    });
  };
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(paint, 120);
  }).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  paint();
  return paint;
}
