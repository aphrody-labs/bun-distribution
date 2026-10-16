/**
 * Pure helpers for homepage hero background interactivity.
 * Keep DOM-free so unit tests can exercise the shipped logic.
 */

/** Selectors that must never trigger background FX (steal navigation). */
export const HERO_UI_HIT_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  '[role="button"]',
  '[role="link"]',
  ".featured-card",
  ".featured-mini",
  ".featured-all-link",
  ".featured-head",
  ".home-card",
  ".searchbar",
  ".playlist-card",
  "app-searchbar",
  ".p-inputtext",
  ".p-autocomplete",
  ".p-overlay",
  ".p-popover",
  ".p-button",
  ".p-inputwrapper",
  ".p-autocomplete-panel",
].join(", ");

/**
 * True when the event target is interactive UI that must keep its default behavior.
 */
export function isHeroUiTarget(target: EventTarget | null): boolean {
  if (target == null) return false;
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el) return false;
  return el.closest(HERO_UI_HIT_SELECTOR) != null;
}

/** Normalize pointer position in hero rect to [-0.5, 0.5] then apply max offset (px). */
export function clampParallax(nx: number, ny: number, maxX = 12, maxY = 8): { x: number; y: number } {
  const cx = Math.max(-0.5, Math.min(0.5, nx));
  const cy = Math.max(-0.5, Math.min(0.5, ny));
  const x = cx * -maxX || 0;
  const y = cy * -maxY || 0;
  return { x, y };
}

/** True if a new FX burst is allowed given last burst timestamp and cooldown ms. */
export function canSpawnFx(now: number, lastSpawnAt: number, cooldownMs: number): boolean {
  if (cooldownMs <= 0) return true;
  return now - lastSpawnAt >= cooldownMs;
}

export type HeroParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
};

export type Rgb = readonly [number, number, number];

/** Dark art: white ink + violet sparks. Light: ink charcoal + soft violet. */
export const HERO_PARTICLE_COLORS_DARK: readonly Rgb[] = [
  [255, 255, 255],
  [220, 220, 230],
  [168, 85, 247],
  [139, 92, 246],
  [192, 132, 252],
];

export const HERO_PARTICLE_COLORS_LIGHT: readonly Rgb[] = [
  [40, 40, 50],
  [80, 70, 100],
  [124, 58, 237],
  [167, 139, 250],
  [109, 40, 217],
];

/**
 * Spawn a radial particle burst at (x, y) in canvas CSS pixels.
 * `rng` injectable for tests (default Math.random).
 */
export function createBurstParticles(
  x: number,
  y: number,
  colors: readonly Rgb[],
  count: number,
  rng: () => number = Math.random,
): HeroParticle[] {
  const n = Math.max(0, Math.min(count, 48));
  const palette = colors.length ? colors : HERO_PARTICLE_COLORS_DARK;
  const out: HeroParticle[] = [];
  for (let i = 0; i < n; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = 1.2 + rng() * 4.5;
    const life = 28 + Math.floor(rng() * 28);
    const [r, g, b] = palette[Math.floor(rng() * palette.length)]!;
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rng() * 1.2,
      life,
      maxLife: life,
      size: 1.2 + rng() * 2.8,
      r,
      g,
      b,
    });
  }
  return out;
}

/** Advance particles one frame; mutates array in place and removes dead ones. */
export function stepParticles(particles: HeroParticle[], gravity = 0.045): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += gravity;
    p.vx *= 0.985;
    p.life -= 1;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/** Hard-cap particle array length (drop oldest). */
export function capParticles(particles: HeroParticle[], max: number): void {
  if (particles.length <= max) return;
  particles.splice(0, particles.length - max);
}

/**
 * Linear interpolate toward a target (for smooth parallax).
 * `t` in [0, 1] — higher = snappier.
 */
export function lerp(current: number, target: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  if (Math.abs(target - current) < 0.02) return target;
  return current + (target - current) * k;
}
