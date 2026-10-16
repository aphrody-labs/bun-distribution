/**
 * Generates `packages/shenron-ui/src/tokens.ts` from `packages/shenron-ui/src/styles.css`.
 *
 *   bun packages/shenron-ui/scripts/generate-tokens.ts          # rewrite src/tokens.ts
 *   bun packages/shenron-ui/scripts/generate-tokens.ts --check  # exit 1 when src/tokens.ts is stale
 *
 * The stylesheet is the single source of truth: Tailwind reads its `@theme inline`
 * blocks and the site imports it. The TypeScript module is a checked projection
 * of it (colour, radius and font defaults), never a second hand-written copy.
 *
 * Extraction rules:
 * - `color`: every `var(--dbz-<name>, <default>)` of the stylesheet, keyed by the
 *   camel-cased `<name>`; the same variable must carry the same default
 *   everywhere (the `@theme inline` block and its `:root` mirror), otherwise
 *   generation fails.
 * - `radius`: `--radius` of the `:root` mirror (`base`) and the `--radius-*`
 *   declarations of `@theme`.
 * - `font`: the `--font-*` declarations of `@theme`.
 * - `ember`: the stylesheet fallback of `--dbz-ember` (it follows the accent)
 *   next to the `DEFAULT_SITE_THEME` value of the /admin/design editor. Both are
 *   pinned to today's rendering by owner decision OWN-7.
 */
import { join } from "node:path";
import postcss, { type ChildNode, type Declaration } from "postcss";

export const STYLES_PATH = join(import.meta.dir, "..", "src", "styles.css");
export const TOKENS_PATH = join(import.meta.dir, "..", "src", "tokens.ts");

/**
 * `DEFAULT_SITE_THEME.colors.ember` in `apps/shenron/site/src/lib/site-theme.ts`: what the
 * editor injects as soon as any theme colour is saved (OWN-7, value pinned).
 */
export const EMBER_SITE_THEME_DEFAULT = "#ff6b1a";

export interface TokenSet {
  /** Colour key → `--dbz-*` runtime override variable. */
  colorVars: Record<string, string>;
  /** Colour key → stylesheet default (fallback of `var(--dbz-*, …)`). */
  color: Record<string, string>;
  radius: Record<string, string>;
  font: Record<string, string>;
  ember: { css: string; siteThemeDefault: string };
}

/** Collapses whitespace the way it reads in a single-line declaration. */
export function normalizeValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .trim();
}

/** `orange-dark` → `orangeDark`, `logo-titre2` → `logoTitre2`. */
export function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Index of the parenthesis closing the one opened at `open`, or -1. */
function closingParen(value: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the first comma at nesting depth 0, or -1. */
function topLevelComma(value: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/** Every `var(--name, fallback)` call of a declaration value, nested ones included. */
export function varFallbacks(
  value: string,
): Array<{ name: string; fallback: string }> {
  const found: Array<{ name: string; fallback: string }> = [];
  const pattern = /\bvar\(/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const open = match.index + 3;
    const close = closingParen(value, open);
    if (close === -1) continue;
    const args = value.slice(open + 1, close);
    const comma = topLevelComma(args);
    if (comma === -1) continue;
    found.push({
      name: args.slice(0, comma).trim(),
      fallback: normalizeValue(args.slice(comma + 1)),
    });
  }
  return found;
}

function inTheme(node: ChildNode): boolean {
  return (
    node.parent?.type === "atrule" &&
    (node.parent as { name: string }).name === "theme"
  );
}

function inRootRule(node: ChildNode): boolean {
  const parent = node.parent;
  return (
    parent?.type === "rule" &&
    (parent as { selectors: string[] }).selectors
      .map((s) => s.trim())
      .includes(":root")
  );
}

/** Extracts the token set from the stylesheet source. Throws on inconsistent defaults. */
export function extractTokens(css: string): TokenSet {
  const root = postcss.parse(css.replace(/\r\n/g, "\n"));
  const colorVars: Record<string, string> = {};
  const color: Record<string, string> = {};
  const radius: Record<string, string> = {};
  const font: Record<string, string> = {};
  const errors: string[] = [];

  const record = (
    target: Record<string, string>,
    key: string,
    value: string,
    what: string,
  ) => {
    const previous = target[key];
    if (previous !== undefined && previous !== value) {
      errors.push(`${what}: "${previous}" then "${value}"`);
      return;
    }
    target[key] = value;
  };

  root.walkDecls((decl: Declaration) => {
    for (const { name, fallback } of varFallbacks(decl.value)) {
      if (!name.startsWith("--dbz-")) continue;
      const key = camelCase(name.slice("--dbz-".length));
      record(colorVars, key, name, `variable of colour "${key}"`);
      record(color, key, fallback, `default of ${name}`);
    }
    const value = normalizeValue(decl.value);
    if (decl.prop === "--radius" && inRootRule(decl))
      record(radius, "base", value, "--radius");
    else if (decl.prop.startsWith("--radius-") && inTheme(decl))
      record(
        radius,
        camelCase(decl.prop.slice("--radius-".length)),
        value,
        decl.prop,
      );
    else if (decl.prop.startsWith("--font-") && inTheme(decl))
      record(
        font,
        camelCase(decl.prop.slice("--font-".length)),
        value,
        decl.prop,
      );
  });

  if (errors.length > 0) {
    throw new Error(
      `styles.css: inconsistent token declarations\n  ${errors.join("\n  ")}`,
    );
  }
  const missing = [
    Object.keys(color).length === 0 && "var(--dbz-*, <default>) colours",
    color.ember === undefined && "var(--dbz-ember, <default>)",
    radius.base === undefined && ":root --radius",
    font.sans === undefined && "@theme --font-sans",
  ].filter(Boolean);
  if (missing.length > 0)
    throw new Error(`styles.css: missing ${missing.join(", ")}`);

  return {
    colorVars,
    color,
    radius,
    font,
    ember: {
      css: color.ember as string,
      siteThemeDefault: EMBER_SITE_THEME_DEFAULT,
    },
  };
}

/** String literal quoted the way oxfmt prints it (double quotes unless that adds escapes). */
function quote(value: string): string {
  const doubles = value.split('"').length - 1;
  const singles = value.split("'").length - 1;
  const q = doubles > singles ? "'" : '"';
  const escaped = value.replaceAll("\\", "\\\\").replaceAll(q, `\\${q}`);
  return `${q}${escaped}${q}`;
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name);
}

function objectLines(record: Record<string, string>, indent: string): string[] {
  return Object.entries(record).map(
    ([k, v]) => `${indent}${key(k)}: ${quote(v)},`,
  );
}

/** Renders the `src/tokens.ts` module (LF line endings, oxfmt layout). */
export function renderTokensModule(set: TokenSet): string {
  const lines = [
    "/**",
    " * Design tokens of `@shenron/ui`, generated from `src/styles.css`.",
    " *",
    " * Do not edit by hand: run `bun packages/shenron-ui/scripts/generate-tokens.ts`.",
    " * `--check` and `test/tokens.test.ts` fail when this file drifts from the",
    " * stylesheet.",
    " *",
    " * `color` holds the fallbacks of `var(--dbz-*, <default>)`, i.e. what the site",
    " * renders while /admin/design has no saved theme. `ember` records its two",
    " * defaults, pinned by owner decision OWN-7: the stylesheet fallback follows the",
    " * accent colour, while the editor default (`DEFAULT_SITE_THEME`) is injected as",
    " * soon as any theme colour is saved.",
    " */",
    "",
    "/** Runtime override variable of each colour token (/admin/design). */",
    "export const colorVars = {",
    ...objectLines(set.colorVars, "\t"),
    "} as const;",
    "",
    "export const tokens = {",
    "\tcolor: {",
    ...objectLines(set.color, "\t\t"),
    "\t},",
    "\tradius: {",
    ...objectLines(set.radius, "\t\t"),
    "\t},",
    "\tfont: {",
    ...objectLines(set.font, "\t\t"),
    "\t},",
    "\tember: {",
    `\t\tcss: ${quote(set.ember.css)},`,
    `\t\tsiteThemeDefault: ${quote(set.ember.siteThemeDefault)},`,
    "\t},",
    "} as const;",
    "",
    "export type Tokens = typeof tokens;",
    "export type ColorToken = keyof typeof tokens.color;",
    "",
  ];
  return lines.join("\n");
}

/** Renders the module expected for the stylesheet currently on disk. */
export async function expectedTokensModule(
  stylesPath = STYLES_PATH,
): Promise<string> {
  return renderTokensModule(extractTokens(await Bun.file(stylesPath).text()));
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
  const check = argv.includes("--check");
  // `--styles` / `--tokens` point the generator at other files (tests only).
  const stylesPath = argValue(argv, "--styles") ?? STYLES_PATH;
  const tokensPath = argValue(argv, "--tokens") ?? TOKENS_PATH;
  const expected = await expectedTokensModule(stylesPath);
  const file = Bun.file(tokensPath);
  const current = (await file.exists())
    ? (await file.text()).replace(/\r\n/g, "\n")
    : null;

  if (check) {
    if (current === expected) {
      console.log("tokens: src/tokens.ts is up to date with src/styles.css");
      return 0;
    }
    const want = expected.split("\n");
    const have = current?.split("\n") ?? [];
    const line = want.findIndex((l, i) => l !== have[i]);
    console.error(
      current === null
        ? "tokens: src/tokens.ts is missing"
        : `tokens: src/tokens.ts is stale (first difference at line ${line + 1}: expected ${JSON.stringify(want[line])}, found ${JSON.stringify(have[line])})`,
    );
    console.error(
      "tokens: run `bun packages/shenron-ui/scripts/generate-tokens.ts`",
    );
    return 1;
  }

  if (current === expected) {
    console.log("tokens: src/tokens.ts already up to date");
    return 0;
  }
  await Bun.write(tokensPath, expected);
  console.log("tokens: wrote src/tokens.ts");
  return 0;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
