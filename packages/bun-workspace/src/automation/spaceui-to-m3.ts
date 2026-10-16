// SPDX-License-Identifier: Apache-2.0
// Mechanical SpaceUI → Material 3 class rewrite.
//
//   bun scripts/spaceui-to-m3.ts <dir>... [--check]
//
// Rewrites the Tailwind classes of SpaceUI-derived sources (m3/packages/m3-primitives, m3-forms,
// m3-ai, m3-explorer) from the SpaceUI vocabulary to the M3 utilities of
// @aphrody/m3-theme/tailwind.css. It is the first, deterministic pass of the fusion; component
// anatomy (heights, shapes, selected indicators, focus rings) is then aligned to the M3 specs by
// hand. Re-run it after a `packages/aphrody-spaceui` update on the freshly copied upstream files.
// With --check it only reports, and exits 1 if anything would change.
//
// Colour tokens follow crates/aphrody-m3-tokens/src/spaceui.rs: SpaceUI tokens that the alias
// sheet renders as state layers (`app-hover`, ...) become opacity modifiers on the content role
// (`bg-on-surface/8`), which is how M3 composes state layers over any container.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** SpaceUI colour token → M3 utility colour (`role` or `role/opacity`). */
export const COLOR: Record<string, string> = {
  accent: "primary",
  "accent-faint": "primary",
  "accent-deep": "primary",
  ink: "on-surface",
  "ink-dull": "on-surface-variant",
  "ink-faint": "outline",
  app: "surface",
  "app-box": "surface-container",
  "app-dark-box": "surface-container-low",
  "app-darker-box": "surface-container-lowest",
  "app-light-box": "surface-container-highest",
  "app-overlay": "surface-container-high",
  "app-overlay-shade": "surface-container-highest",
  "app-input": "surface-container-highest",
  "app-focus": "surface-container-lowest",
  "app-line": "outline-variant",
  "app-divider": "outline-variant",
  "app-button": "surface-container-high",
  "app-selected": "secondary-container",
  "app-selected-item": "on-surface/10",
  "app-hover": "on-surface/8",
  "app-active": "on-surface/10",
  "app-shade": "shadow",
  "app-frame": "outline-variant",
  "app-slider": "surface-container-highest",
  "app-explorer-scrollbar": "outline-variant",
  sidebar: "surface-container-low",
  "sidebar-box": "surface-container",
  "sidebar-line": "outline-variant",
  "sidebar-ink": "on-surface",
  "sidebar-ink-dull": "on-surface-variant",
  "sidebar-ink-faint": "outline",
  "sidebar-divider": "outline-variant",
  "sidebar-button": "surface-container-high",
  "sidebar-selected": "secondary-container",
  "sidebar-shade": "shadow",
  menu: "surface-container",
  "menu-line": "outline-variant",
  "menu-ink": "on-surface",
  "menu-faint": "on-surface-variant",
  "menu-hover": "on-surface/8",
  "menu-selected": "secondary-container",
  "menu-shade": "shadow",
  "status-success": "success",
  "status-warning": "warning",
  "status-error": "error",
  "status-info": "primary",
};

/** Tailwind default palette hue → M3 role (the shade is dropped). */
export const PALETTE: Record<string, string> = {
  red: "error",
  rose: "error",
  green: "success",
  emerald: "success",
  lime: "success",
  yellow: "warning",
  amber: "warning",
  orange: "warning",
  blue: "primary",
  sky: "primary",
  indigo: "primary",
  cyan: "tertiary",
  teal: "tertiary",
  violet: "tertiary",
  purple: "tertiary",
  fuchsia: "tertiary",
  pink: "tertiary",
  gray: "outline",
  zinc: "outline",
  neutral: "outline",
  slate: "outline",
  stone: "outline",
};

export const RADIUS: Record<string, string> = {
  "": "extra-small",
  xs: "extra-small",
  sm: "extra-small",
  md: "small",
  lg: "small",
  xl: "medium",
  "2xl": "large",
  "3xl": "extra-large",
  window: "medium",
};

export const TEXT: Record<string, string> = {
  tiny: "label-small",
  xs: "body-small",
  sm: "body-medium",
  base: "body-large",
  lg: "title-medium",
  xl: "title-large",
  "2xl": "headline-small",
  "3xl": "headline-medium",
  "4xl": "headline-large",
  "5xl": "display-small",
  "6xl": "display-medium",
  "7xl": "display-large",
};

/** Label roles win over body roles when the same class list sets a medium weight. */
export const LABEL: Record<string, string> = {
  tiny: "label-small",
  xs: "label-medium",
  sm: "label-large",
};

export const SHADOW: Record<string, string> = {
  "": "md3-1",
  xs: "md3-1",
  sm: "md3-1",
  md: "md3-2",
  lg: "md3-3",
  xl: "md3-4",
  "2xl": "md3-5",
};

export const EASE: Record<string, string> = {
  "in-out": "standard",
  out: "standard-decelerate",
  in: "standard-accelerate",
};

const COLOR_UTILS =
  "bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|fill|stroke|from|via|to|divide|outline|shadow|placeholder|caret|decoration|accent";

const colorTokens = Object.keys(COLOR)
  .toSorted((a, b) => b.length - a.length)
  .join("|");

const colorRe = new RegExp(
  `(?<![\\w-])((?:[\\w\\[\\]&:.-]+:)*!?)(${COLOR_UTILS})-(${colorTokens})(?:/(\\d+))?(?![\\w-])`,
  "g",
);
const paletteRe = new RegExp(
  `(?<![\\w-])((?:[\\w\\[\\]&:.-]+:)*!?)(${COLOR_UTILS})-(${Object.keys(PALETTE).join("|")})-(\\d{2,3})(?:/(\\d+))?(?![\\w-])`,
  "g",
);
const radiusRe =
  /(?<![\w-])((?:[\w[\]&:.-]+:)*!?)rounded(-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(xs|sm|md|lg|xl|2xl|3xl|window))?(?![\w-])/g;
const textRe = /(?<![\w-])((?:[\w[\]&:.-]+:)*!?)text-(tiny|xs|sm|base|lg|xl|[2-7]xl)(?![\w-])/g;
const shadowRe = /(?<![\w-])((?:[\w[\]&:.-]+:)*!?)shadow(?:-(xs|sm|md|lg|xl|2xl))?(?![\w-/])/g;
const easeRe = /(?<![\w-])((?:[\w[\]&:.-]+:)*!?)ease-(in-out|out|in)(?![\w-])/g;

/** Combine an M3 state-layer opacity with an upstream opacity modifier. */
function withAlpha(target: string, alpha?: string): string {
  if (!alpha) return target;
  const [role, layer] = target.split("/");
  if (!layer) return `${role}/${alpha}`;
  const combined = Math.max(1, Math.round((Number(layer) * Number(alpha)) / 100));
  return `${role}/${combined}`;
}

/** Rewrite one class list (the content of one string or template literal). */
export function rewriteClasses(list: string): string {
  const medium = /(?<![\w-])font-(medium|semibold|bold)(?![\w-])/.test(list);
  return list
    .replace(colorRe, (_, variants, util, token, alpha) => {
      return `${variants}${util}-${withAlpha(COLOR[token]!, alpha)}`;
    })
    .replace(paletteRe, (_, variants, util, hue, _shade, alpha) => {
      return `${variants}${util}-${withAlpha(PALETTE[hue]!, alpha)}`;
    })
    .replace(radiusRe, (_, variants, side = "", size = "") => {
      return `${variants}rounded${side}-${RADIUS[size]!}`;
    })
    .replace(textRe, (_, variants, size) => {
      const role = (medium && LABEL[size]) || TEXT[size]!;
      return `${variants}text-${role}`;
    })
    .replace(shadowRe, (_, variants, size = "") => `${variants}shadow-${SHADOW[size]!}`)
    .replace(easeRe, (_, variants, curve) => `${variants}ease-${EASE[curve]!}`);
}

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;

/** Bare words that are Tailwind classes on their own. */
const STANDALONE = new Set(
  (
    "flex grid block inline hidden relative absolute fixed sticky static truncate uppercase " +
    "lowercase capitalize italic underline rounded shadow border grow shrink contents visible " +
    "invisible group peer container isolate antialiased transform transition outline ring " +
    "table collapse resize select-none"
  ).split(" "),
);

/**
 * Whether a literal (or one `${}`-free chunk of a template literal) is a class list rather than
 * prose, a key or a URL: every bare word must be a standalone class and at least one token must
 * look like a utility.
 */
export function looksLikeClassList(body: string): boolean {
  const tokens = body
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  let utility = false;
  for (const token of tokens) {
    if (/^[a-z]+$/.test(token)) {
      if (!STANDALONE.has(token)) return false;
      utility = true;
    } else if (/^(?:[\w[\]&:.-]+:)?!?-?[a-z][\w[\]/.%#-]*$/.test(token)) {
      utility ||= token.includes("-");
    } else {
      return false;
    }
  }
  return utility;
}

/** Rewrite every class-list string literal of a source file. */
export function rewriteSource(source: string): string {
  return source.replace(LITERAL, (whole, quote: string, body: string) => {
    if (/^(?:\.{0,2}\/|@|node:|https?:)/.test(body)) return whole;
    if (!looksLikeClassList(body)) return whole;
    const next = rewriteClasses(body);
    return next === body ? whole : `${quote}${next}${quote}`;
  });
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name !== "node_modules" && entry.name !== "dist" ? walk(full) : [];
      }
      return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

export async function runSpaceUiToM3(args: string[]): Promise<number> {
  const check = args.includes("--check");
  const dirs = args.filter(a => a !== "--check");
  if (dirs.length === 0) {
    console.error("usage: bun scripts/spaceui-to-m3.ts <dir>... [--check]");
    return 2;
  }
  const files = (await Promise.all(dirs.map(walk))).flat();
  const results = await Promise.all(
    files.map(async file => {
      const before = await readFile(file, "utf8");
      const after = rewriteSource(before);
      if (after === before) return false;
      if (!check) await writeFile(file, after);
      return true;
    }),
  );
  let changed = 0;
  results.forEach((rewritten, i) => {
    if (!rewritten) return;
    changed++;
    console.log(`${check ? "would rewrite" : "rewrote"} ${files[i]}`);
  });
  console.log(`${changed} file(s) ${check ? "to rewrite" : "rewritten"}`);
  return check && changed > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(await runSpaceUiToM3(process.argv.slice(2)));
