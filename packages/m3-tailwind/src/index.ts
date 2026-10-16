// SPDX-License-Identifier: Apache-2.0
// Tailwind v4 CSS-first preset for Material 3. Everything is generated from @aphrody/m3-tokens (the
// TypeScript tables for roles, type, breakpoints, springs and directional shapes; the token sheets for
// the corner scale, motion durations, easings, elevation and state layers), so the utilities
// (`bg-primary`, `rounded-large`, `text-body-large`, `ease-emphasized`, `shadow-elevation-2`,
// `shape-large-top`, `state-layer`, `motion-expressive-default-spatial`, `compact:`, `m3-open:`) and the
// runtime `--md-sys-*` custom properties never drift.
import { readFileSync } from "node:fs";
import {
  BREAKPOINTS,
  HEIGHT_BREAKPOINTS,
} from "@aphrody/m3-tokens/breakpoints";
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import {
  DIRECTIONAL_SHAPES,
  EMPHASIZED_STYLES,
  EXPRESSIVE_SPRINGS,
  TYPE_BASE,
  type TypeStyleName,
} from "@aphrody/m3-tokens/expressive";
import { springToCss } from "./spring";

export {
  springPosition,
  springSettleMs,
  springToCss,
  type SpringCss,
} from "./spring";

const kebab = (s: string): string => s.replace(/([A-Z])/g, "-$1").toLowerCase();
const sheet = (specifier: string): string =>
  readFileSync(Bun.fileURLToPath(import.meta.resolve(specifier)), "utf8");

/** `m3-tokens.css`, the generated static tokens (corner scale, motion, elevation, state layers). */
const TOKENS = sheet("@aphrody/m3-tokens/m3-tokens.css");

/** Names (the part after `prefix`) of the custom properties of the token sheet that start with `prefix`. */
function names(prefix: string, suffix = ":"): string[] {
  const found = new Set<string>();
  for (const match of TOKENS.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
    const prop = match[1]!;
    if (prop.startsWith(prefix) && (suffix === ":" || prop.endsWith(suffix)))
      found.add(
        prop.slice(
          prefix.length,
          suffix === ":" ? undefined : prop.length - suffix.length,
        ),
      );
  }
  return [...found];
}

/** The corner scale, `none` to `full`, in sheet order. */
export const SHAPES: readonly string[] = names("--md-sys-shape-corner-");
/** Directional corners of `expressive.css` (`large-top`, `large-start`, ...). */
export const DIRECTIONAL_SHAPE_NAMES = Object.keys(DIRECTIONAL_SHAPES);
/** Easing curves: standard, emphasized (with decelerate/accelerate), legacy and linear. */
export const EASINGS: readonly string[] = names("--md-sys-motion-easing-");
/** Duration steps, `short1` to `extra-long4`. */
export const DURATIONS: readonly string[] = names("--md-sys-motion-duration-");
/** Elevation levels (`0` to `5`). */
export const ELEVATIONS: readonly string[] = names("--md-sys-elevation-level");
/** Interaction states that carry a state-layer opacity. */
export const STATE_LAYERS: readonly string[] = names(
  "--md-sys-state-",
  "-state-layer-opacity",
);

export interface SpringDef {
  /** Utility and theme suffix: `fast-spatial`, `expressive-default-spatial`, ... */
  name: string;
  damping: number;
  stiffness: number;
}

/** Standard springs (from the token sheet) then the Expressive spatial springs (from `expressive.ts`). */
const springValue = (name: string, kind: "damping" | "stiffness"): number =>
  Number(
    new RegExp(`--md-sys-motion-spring-${name}-${kind}:\\s*([\\d.]+)`).exec(
      TOKENS,
    )?.[1],
  );

export function springDefs(): SpringDef[] {
  const out: SpringDef[] = [];
  for (const speed of ["fast", "default", "slow"]) {
    for (const kind of ["spatial", "effects"]) {
      const name = `${speed}-${kind}`;
      out.push({
        name,
        damping: springValue(name, "damping"),
        stiffness: springValue(name, "stiffness"),
      });
    }
  }
  for (const [speed, token] of Object.entries(EXPRESSIVE_SPRINGS)) {
    out.push({
      name: `expressive-${speed}-spatial`,
      damping: token.damping,
      stiffness: token.stiffness,
    });
  }
  return out;
}

export interface PresetOptions {
  /** Emit `@theme static` so every variable is kept even when no utility uses it. Default false (`inline`). */
  keepUnused?: boolean;
}

const lines = (entries: [string, string][]): string =>
  entries.map(([k, v]) => `  ${k}: ${v};`).join("\n");

const rem = (px: number): string => `${px / 16}rem`;

export function colorEntries(): [string, string][] {
  return ROLES.map((r) => [
    `--color-${kebab(r)}`,
    `var(--md-sys-color-${kebab(r)})`,
  ]);
}

/** `rounded-*` for the corner scale; directional corners are `shape-*` utilities (a radius list, not a length). */
export function shapeEntries(): [string, string][] {
  return SHAPES.map((s) => [
    `--radius-${s}`,
    `var(--md-sys-shape-corner-${s})`,
  ]);
}

export function textEntries(): [string, string][] {
  const out: [string, string][] = [];
  for (const name of Object.keys(TYPE_BASE) as TypeStyleName[]) {
    const p = `--md-sys-typescale-${name}`;
    out.push(
      [`--text-${name}`, `var(${p}-size)`],
      [`--text-${name}--line-height`, `var(${p}-line-height)`],
      [`--text-${name}--letter-spacing`, `var(${p}-tracking)`],
      [`--text-${name}--font-weight`, `var(${p}-weight)`],
    );
  }
  for (const s of EMPHASIZED_STYLES) {
    const p = `--md-sys-typescale-${s.name}-emphasized`;
    out.push(
      [`--text-${s.name}-emphasized`, `var(${p}-size)`],
      [`--text-${s.name}-emphasized--line-height`, `var(${p}-line-height)`],
      [`--text-${s.name}-emphasized--letter-spacing`, `var(${p}-tracking)`],
      [`--text-${s.name}-emphasized--font-weight`, `var(${p}-weight)`],
    );
  }
  return out;
}

export function fontEntries(): [string, string][] {
  return [
    ["--font-brand", "var(--md-ref-typeface-brand)"],
    ["--font-plain", "var(--md-ref-typeface-plain)"],
    ["--font-code", "var(--md-ref-typeface-code)"],
    ["--font-sans", "var(--md-ref-typeface-plain)"],
    ["--font-mono", "var(--md-ref-typeface-code)"],
  ];
}

export function easeEntries(): [string, string][] {
  const out: [string, string][] = EASINGS.map((e) => [
    `--ease-${e}`,
    `var(--md-sys-motion-easing-${e})`,
  ]);
  for (const s of springDefs())
    out.push([
      `--ease-spring-${s.name}`,
      springToCss(s.damping, s.stiffness).easing,
    ]);
  return out;
}

/** `duration-short1`, `duration-extra-long4`, `duration-spring-fast-spatial` (Tailwind's `--transition-duration-*`). */
export function durationEntries(): [string, string][] {
  const out: [string, string][] = DURATIONS.map((d) => [
    `--transition-duration-${d}`,
    `var(--md-sys-motion-duration-${d})`,
  ]);
  for (const s of springDefs())
    out.push([
      `--transition-duration-spring-${s.name}`,
      `${springToCss(s.damping, s.stiffness).durationMs}ms`,
    ]);
  return out;
}

export function shadowEntries(): [string, string][] {
  return ELEVATIONS.map((n) => [
    `--shadow-elevation-${n}`,
    `var(--md-sys-elevation-level${n})`,
  ]);
}

/** Window size classes as `medium:`, `expanded:`, `large:`, `extra-large:` (min-width, rem). */
export function breakpointEntries(): [string, string][] {
  return Object.entries(BREAKPOINTS)
    .filter(([, px]) => px > 0)
    .map(([name, px]) => [`--breakpoint-${name}`, rem(px)]);
}

/** Corner scale plus directional shapes, the values of the `shape-*` utility. */
export function shapeUtilityEntries(): [string, string][] {
  return [
    ...SHAPES.map((s): [string, string] => [
      `--shape-${s}`,
      `var(--md-sys-shape-corner-${s})`,
    ]),
    ...DIRECTIONAL_SHAPE_NAMES.map((s): [string, string] => [
      `--shape-${s}`,
      `var(--md-sys-shape-corner-${s})`,
    ]),
  ];
}

/** The `@theme` block. Pair it with `m3-tokens.css`, `expressive.css` and a colour sheet at runtime. */
export function themeCss(options: PresetOptions = {}): string {
  const kind = options.keepUnused ? "static" : "inline";
  return `@theme ${kind} {\n${lines([
    ...colorEntries(),
    ...shapeEntries(),
    ...shapeUtilityEntries(),
    ...textEntries(),
    ...fontEntries(),
    ...easeEntries(),
    ...durationEntries(),
    ...shadowEntries(),
    ...breakpointEntries(),
  ])}\n}\n`;
}

/** Variants: colour scheme, adaptive window classes and the Base UI state attributes. */
export function variantsCss(): string {
  const widthMedium = rem(BREAKPOINTS.medium);
  const height = (name: "medium" | "expanded"): string =>
    `@custom-variant h-${name} (@media (height >= ${rem(HEIGHT_BREAKPOINTS[name])}));`;
  return `/* Colour scheme: the \`.dark\` class (M3Html, <m3-theme>) or the OS preference unless \`.light\` forces light. */
@custom-variant dark {
  &:where(.dark, .dark *) {
    @slot;
  }
  @media (prefers-color-scheme: dark) {
    &:where(:not(.light, .light *)) {
      @slot;
    }
  }
}

/* Window size classes (width): \`medium:\` and up come from the breakpoints; \`compact:\` is the class below them. */
@custom-variant compact (@media (width < ${widthMedium}));
/* Window height classes: \`h-compact:\` below 480dp, \`h-medium:\` from 480dp, \`h-expanded:\` from 900dp. */
@custom-variant h-compact (@media (height < ${rem(HEIGHT_BREAKPOINTS.medium)}));
${height("medium")}
${height("expanded")}

/* Base UI state attributes (and their ARIA twins) at zero specificity. */
@custom-variant m3-open (&:where([data-open], [data-popup-open], [open], [aria-expanded="true"]));
@custom-variant m3-on (&:where([data-checked], [data-selected], [data-pressed], [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]));
@custom-variant m3-highlighted (&:where([data-highlighted]));
@custom-variant m3-disabled (&:where(:disabled, [data-disabled], [aria-disabled="true"]));
@custom-variant m3-invalid (&:where([data-invalid], [aria-invalid="true"]));
@custom-variant m3-enter (&:where([data-starting-style]));
@custom-variant m3-exit (&:where([data-ending-style]));
@custom-variant m3-vertical (&:where([data-orientation="vertical"]));
@custom-variant m3-horizontal (&:where([data-orientation="horizontal"]));
`;
}

/** `typescale-<style>[-emphasized]`: family, weight, size, line height and tracking of one style at once. */
function typescaleUtilities(): string {
  const styles = [
    ...(Object.keys(TYPE_BASE) as TypeStyleName[]).map((n) => `${n}`),
    ...EMPHASIZED_STYLES.map((s) => `${s.name}-emphasized`),
  ];
  return styles
    .map((n) => {
      const p = `--md-sys-typescale-${n}`;
      return `@utility typescale-${n} {
  font-family: var(${p}-font);
  font-weight: var(${p}-weight);
  font-size: var(${p}-size);
  line-height: var(${p}-line-height);
  letter-spacing: var(${p}-tracking);
}`;
    })
    .join("\n");
}

/** `motion-<spring>`: the spring easing and its settle time in one class (`transition` supplies the property). */
function motionUtilities(): string {
  return springDefs()
    .map((s) => {
      const { easing, durationMs } = springToCss(s.damping, s.stiffness);
      return `@utility motion-${s.name} {
  --tw-ease: ${easing};
  --tw-duration: ${durationMs}ms;
  transition-timing-function: ${easing};
  transition-duration: ${durationMs}ms;
}`;
    })
    .join("\n");
}

const opacity = (state: string): string =>
  `var(--md-sys-state-${state}-state-layer-opacity)`;

/** Utilities: shape, state layer, typescale, spring motion. */
export function utilitiesCss(): string {
  return `/* shape-large-top, shape-extra-small, ...: the corner scale and the directional (RTL-aware) corners. */
@utility shape-* {
  border-radius: --value(--shape-*);
}

/*
 * state-layer: the M3 state layer (hover, focus, pressed, dragged) painted over the element in its
 * content colour; \`state-layer-primary\` picks the role. Base UI \`data-highlighted\`, \`data-pressed\`,
 * \`data-dragged\` and \`data-disabled\` are honoured. All states share one specificity, so the later
 * state (pressed over hover) wins, as in the spec.
 */
@utility state-layer {
  position: relative;
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-color: var(--m3-state-layer-color, currentColor);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }
  @media (hover: hover) {
    &:hover::after {
      opacity: ${opacity("hover")};
    }
  }
  &:is(:focus-visible, [data-highlighted])::after {
    opacity: ${opacity("focus")};
  }
  &:is(:active, [data-pressed])::after {
    opacity: ${opacity("pressed")};
  }
  &:is([data-dragged])::after {
    opacity: ${opacity("dragged")};
  }
  &:is(:disabled, [data-disabled], [aria-disabled="true"])::after {
    opacity: 0;
  }
}
@utility state-layer-* {
  --m3-state-layer-color: --value(--color-*);
}

${typescaleUtilities()}

${motionUtilities()}
`;
}

/** Contents of `preset.css`. */
export function presetCss(): string {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/*
 * Material 3 preset for Tailwind v4 (CSS-first). GENERATED from @aphrody/m3-tokens: bun run generate.
 * Usage:
 *   @import "tailwindcss";
 *   @import "@aphrody/m3-tokens/m3-tokens.css";
 *   @import "@aphrody/m3-tokens/expressive.css";
 *   @import "@aphrody/m3-tailwind/preset.css";
 * and set the colour roles at runtime (applyDynamicColor / cssFromSeed / @aphrody/m3-theme/tokens.css).
 */

${themeCss()}
${variantsCss()}
${utilitiesCss()}`;
}
