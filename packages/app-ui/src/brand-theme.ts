// SPDX-License-Identifier: Apache-2.0
// Aphrody brand sheet, rendered from the Gemini brand seed by @aphrody/m3-tokens.
//
// Colour roles are generated (Material Color Utilities, tonal spot). The only
// hand-chosen values are the ones docs/research/ui/m3-expressive-gemini-2026.md
// section 5 lists as served by the Gemini web app, mirrored in
// crates/ui/m3-tokens/src/gemini_brand.rs.

import { cssFromSeed } from "@aphrody/m3-tokens/dynamic-color";

import { BRAND_SEED, GEMINI_SURFACE, READING_COLUMN, SHAPE, TITLE_GRADIENT_STOPS, WEIGHTS } from "./brand-tokens";

export { BRAND_SEED, GEMINI_SURFACE, READING_COLUMN, SHAPE, TITLE_GRADIENT_STOPS, WEIGHTS };

/** M3 spring names carried by @aphrody/m3-tokens/m3-tokens.css. */
export const SPRING_NAMES = [
  "fast-spatial",
  "default-spatial",
  "slow-spatial",
  "fast-effects",
  "default-effects",
  "slow-effects",
] as const;
export type SpringName = (typeof SPRING_NAMES)[number];
export type Spring = { damping: number; stiffness: number };

/** Read `--md-sys-motion-spring-*-{damping,stiffness}` from the m3-tokens sheet text. */
export function springsFromTokensCss(css: string): Record<SpringName, Spring> {
  const out = {} as Record<SpringName, Spring>;
  for (const name of SPRING_NAMES) {
    const read = (prop: string): number => {
      const m = css.match(new RegExp(`--md-sys-motion-spring-${name}-${prop}:\\s*([0-9.]+)`));
      if (!m) throw new Error(`m3-tokens.css lacks --md-sys-motion-spring-${name}-${prop}`);
      return Number(m[1]);
    };
    out[name] = { damping: read("damping"), stiffness: read("stiffness") };
  }
  return out;
}

/** Unit-mass spring from 0 to 1: position at time t (seconds). */
function springAt({ damping: z, stiffness }: Spring, t: number): number {
  const w = Math.sqrt(stiffness);
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** Settle time (ms) where the envelope falls under 0.1 % of the travel. */
export function springDurationMs(s: Spring): number {
  const w = Math.sqrt(s.stiffness);
  if (s.damping >= 1) {
    let t = 0;
    while (Math.exp(-w * t) * (1 + w * t) > 0.001) t += 0.001;
    return Math.round(t * 1000);
  }
  const t = Math.log(1000 / Math.sqrt(1 - s.damping * s.damping)) / (s.damping * w);
  return Math.round(t * 1000);
}

/** CSS `linear()` easing sampling the spring over its settle time. */
export function springLinear(s: Spring, samples = 24): string {
  const dur = springDurationMs(s) / 1000;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const v = i === samples ? 1 : springAt(s, (dur * i) / samples);
    pts.push(String(Math.round(v * 10000) / 10000));
  }
  return `linear(${pts.join(", ")})`;
}

function brandTokens(springs: Record<SpringName, Spring>): string {
  const lines = [
    `  --app-title-gradient: linear-gradient(90deg, ${TITLE_GRADIENT_STOPS.join(", ")});`,
    `  --app-shape-prompt-empty: ${SHAPE.promptEmpty};`,
    `  --app-shape-prompt-content: ${SHAPE.promptContent};`,
    `  --app-shape-prompt-docked: ${SHAPE.promptDocked};`,
    `  --app-shape-chip: ${SHAPE.chip};`,
    `  --app-reading-column: ${READING_COLUMN}px;`,
    `  --app-weight-display: ${WEIGHTS.display};`,
    `  --app-weight-headline: ${WEIGHTS.headline};`,
    `  --app-weight-body: ${WEIGHTS.body};`,
    `  --app-weight-body-strong: ${WEIGHTS.bodyStrong};`,
  ];
  for (const name of SPRING_NAMES) {
    lines.push(`  --app-motion-spring-${name}: ${springLinear(springs[name])};`);
    lines.push(`  --app-motion-spring-${name}-duration: ${springDurationMs(springs[name])}ms;`);
  }
  return `:root {\n${lines.join("\n")}\n}\n`;
}

function surfaceOverride(selector: string, hex: string): string {
  return `${selector} {\n  --md-sys-color-background: ${hex};\n  --md-sys-color-surface: ${hex};\n}\n`;
}

/** Full text of src/brand.css for `seed`, with springs read from `tokensCss`. */
export function brandCss(tokensCss: string, seed: string = BRAND_SEED): string {
  const header =
    "/* SPDX-License-Identifier: Apache-2.0 */\n" +
    "/*\n" +
    ` * Aphrody brand sheet: M3 tonal-spot roles from seed ${seed} (Gemini brand blue),\n` +
    " * Gemini surfaces, shapes, weights and M3 springs as linear() easings.\n" +
    " * GENERATED - do not hand-edit. Regenerate with: bun run brand\n" +
    " */\n\n";
  return (
    header +
    cssFromSeed(seed, { lightSelector: ":root.light,\n.light", darkSelector: ":root,\n.dark" }) +
    "\n/* Gemini surfaces (docs/research/ui/m3-expressive-gemini-2026.md section 5). */\n" +
    surfaceOverride(":root.light,\n.light", GEMINI_SURFACE.light) +
    "\n" +
    surfaceOverride(":root,\n.dark", GEMINI_SURFACE.dark) +
    "\n" +
    brandTokens(springsFromTokensCss(tokensCss))
  );
}
