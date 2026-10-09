// SPDX-License-Identifier: Apache-2.0
// Aphrody brand sheet, generated from the canonical pet by @aphrody/m3-tokens.
// Material Color Utilities produces every surface and semantic colour role.

import {
  cssFromSeed,
  normalizeSeedHex,
  type SchemeVariant,
} from "@aphrody/m3-tokens/dynamic-color";
import {
  nativeThemeCss,
  nativeThemeVariant,
  parseNativeThemeExport,
  type NativeThemeExport,
  type NativeSchemeVariant,
} from "@aphrody/m3-tokens/native-theme";

import {
  BRAND_SEED,
  PET_ACCENTS,
  READING_COLUMN,
  SHAPE,
  TITLE_GRADIENT_STOPS,
  WEIGHTS,
} from "./brand-tokens";

export { BRAND_SEED, PET_ACCENTS, READING_COLUMN, SHAPE, TITLE_GRADIENT_STOPS, WEIGHTS };

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

export interface BrandThemeOptions {
  variant?: SchemeVariant | NativeSchemeVariant;
  contrastLevel?: number;
  nativeTheme?: NativeThemeExport;
  highContrastTheme?: NativeThemeExport;
}

/** Full brand sheet, preserving native roles when a Rust export is supplied. */
export function brandCss(
  tokensCss: string,
  seed: string = BRAND_SEED,
  options: BrandThemeOptions = {},
): string {
  seed = normalizeSeedHex(seed);
  const native = options.nativeTheme && parseNativeThemeExport(options.nativeTheme);
  const variant = options.variant ?? (native ? nativeThemeVariant(native) : "tonalSpot");
  const contrastLevel = options.contrastLevel ?? native?.contrast_level ?? 0;
  if (!native && (variant === "rainbow" || variant === "fruitSalad"))
    throw new Error(`Brand variant "${variant}" requires a native theme export`);
  if (
    native &&
    (native.seed !== seed ||
      nativeThemeVariant(native) !== variant ||
      native.contrast_level !== contrastLevel)
  )
    throw new Error("Native theme does not match the requested brand seed, variant or contrast");
  const selectors = { lightSelector: ":root.light,\n.light", darkSelector: ":root,\n.dark" };
  const standardCss = native
    ? nativeThemeCss(native, selectors)
    : cssFromSeed(seed, { ...selectors, variant: variant as SchemeVariant, contrastLevel });
  const high = options.highContrastTheme && parseNativeThemeExport(options.highContrastTheme);
  if (
    high &&
    (high.seed !== seed || nativeThemeVariant(high) !== variant || high.contrast_level !== 1)
  )
    throw new Error("Native high contrast theme does not match the requested brand theme");
  const highCss = high
    ? nativeThemeCss(high, selectors)
    : !native && contrastLevel !== 1
      ? cssFromSeed(seed, { ...selectors, variant: variant as SchemeVariant, contrastLevel: 1 })
      : undefined;
  const header =
    "/* SPDX-License-Identifier: Apache-2.0 */\n" +
    "/*\n" +
    ` * Aphrody brand sheet: M3 ${variant} roles from seed ${seed}, contrast ${contrastLevel},\n` +
    " * Pet-derived surfaces and roles, expressive shapes and M3 spring easings.\n" +
    " * GENERATED - do not hand-edit. Regenerate with: bun run brand\n" +
    " */\n\n";
  return (
    header +
    standardCss +
    (highCss ? `\n@media (prefers-contrast: more) {\n${highCss}}\n` : "") +
    "\n/* Exact Aphrody pet colours (identity PET_COLORS). */\n" +
    `:root {\n  --aphrody-pet-hair: ${PET_ACCENTS.hair};\n  --aphrody-pet-skin: ${PET_ACCENTS.skin};\n  --aphrody-pet-tunic: ${PET_ACCENTS.tunic};\n}\n` +
    "\n" +
    brandTokens(springsFromTokensCss(tokensCss))
  );
}
