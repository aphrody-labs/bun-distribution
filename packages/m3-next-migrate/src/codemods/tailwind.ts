// SPDX-License-Identifier: Apache-2.0
// Tailwind v3 -> v4 (the CSS-first engine), aimed at the M3 preset: directives become `@import`, utilities that were
// renamed are renamed, `tailwind.config.js` becomes `@theme`, PostCSS and package.json follow.
import { type CodemodResult, unchanged } from "./types";
import {
  applyEdits,
  inSkipped,
  matching,
  objectValueOpen,
  properties,
  removeRange,
  skippedSpans,
  type Span,
} from "./lex";

// ---------------------------------------------------------------------------------------------------------------
// Class names
// ---------------------------------------------------------------------------------------------------------------

/** Utilities renamed in v4 (applied once per class, on the base utility, variants kept). */
export const RENAMED: Record<string, string> = {
  "shadow-sm": "shadow-xs",
  shadow: "shadow-sm",
  "drop-shadow-sm": "drop-shadow-xs",
  "drop-shadow": "drop-shadow-sm",
  "blur-sm": "blur-xs",
  blur: "blur-sm",
  "backdrop-blur-sm": "backdrop-blur-xs",
  "backdrop-blur": "backdrop-blur-sm",
  "rounded-sm": "rounded-xs",
  rounded: "rounded-sm",
  "outline-none": "outline-hidden",
  ring: "ring-3",
  "flex-shrink": "shrink",
  "flex-shrink-0": "shrink-0",
  "flex-grow": "grow",
  "flex-grow-0": "grow-0",
  "overflow-ellipsis": "text-ellipsis",
  "decoration-slice": "box-decoration-slice",
  "decoration-clone": "box-decoration-clone",
};
for (const dir of ["t", "tr", "r", "br", "b", "bl", "l", "tl"])
  RENAMED[`bg-gradient-to-${dir}`] = `bg-linear-to-${dir}`;

/** Split `hover:md:!p-4` into its variants and the utility; brackets protect colons (`[&:hover]:p-4`). */
function splitVariants(token: string): { variants: string; utility: string } {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i]!;
    if (c === "[" || c === "(") depth += 1;
    else if (c === "]" || c === ")") depth -= 1;
    else if (c === ":" && depth === 0) last = i;
  }
  return { variants: token.slice(0, last + 1), utility: token.slice(last + 1) };
}

const NON_COLOR = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "ellipsis",
  "clip",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "none",
  "fixed",
  "local",
  "scroll",
  "cover",
  "contain",
  "auto",
  "repeat",
  "no-repeat",
  "top",
  "bottom",
  "opacity",
  "t",
  "r",
  "b",
  "l",
  "x",
  "y",
  "s",
  "e",
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "collapse",
  "separate",
  "spacing",
  "inset",
  "offset",
  "0",
  "1",
  "2",
  "4",
  "8",
  "transparent",
  "current",
]);

const OPACITY_FAMILIES = new Set(["bg", "text", "border", "divide", "ring", "placeholder"]);

/** Convert one whitespace-separated class list from v3 to v4. */
export function classListV3ToV4(list: string): { value: string; warnings: string[] } {
  const warnings: string[] = [];
  const tokens = list.split(/(\s+)/);
  const classes = tokens.filter((t) => t.trim() !== "");

  // bg-black bg-opacity-50 -> bg-black/50
  const drop = new Set<string>();
  const rewrite = new Map<string, string>();
  for (const token of classes) {
    const { variants, utility } = splitVariants(token);
    const m = /^(bg|text|border|divide|ring|placeholder)-opacity-(\d+)$/.exec(utility);
    if (!m || !OPACITY_FAMILIES.has(m[1]!)) continue;
    const candidates = classes.filter((c) => {
      const s = splitVariants(c);
      if (s.variants !== variants) return false;
      const parts = new RegExp(`^${m[1]}-(.+)$`).exec(s.utility);
      if (!parts) return false;
      const name = parts[1]!;
      // Not already translucent, not the opacity utility itself, not a size, alignment or width.
      return (
        !name.includes("/") &&
        !name.startsWith("opacity-") &&
        !NON_COLOR.has(name) &&
        !/^\d+(\.\d+)?$/.test(name) &&
        !/^(clip|origin|gradient|blend|linear|radial|conic)-/.test(name)
      );
    });
    if (candidates.length === 1) {
      drop.add(token);
      rewrite.set(candidates[0]!, `${candidates[0]}/${m[2]}`);
    } else
      warnings.push(
        `${token}: the opacity utility is gone; write the colour with a /${m[2]} modifier`,
      );
  }

  const out = tokens.map((t) => {
    if (t.trim() === "") return t;
    if (drop.has(t)) return "\0";
    let token = rewrite.get(t) ?? t;
    if (token.includes("$") || token.includes("{")) return token;
    const { variants, utility } = splitVariants(token);
    let u = utility;
    let important = false;
    if (u.startsWith("!")) {
      u = u.slice(1);
      important = true;
    }
    const renamed = RENAMED[u];
    if (renamed !== undefined) u = renamed;
    // bg-[--brand] -> bg-(--brand)
    u = u.replace(/-\[(--[\w-]+)\]/g, "-($1)");
    token = `${variants}${u}${important ? "!" : ""}`;
    return token;
  });
  // Remove dropped tokens with one adjacent space.
  const joined = out
    .join("")
    .replace(/ ?\0 ?/g, (m) => (m.startsWith(" ") && m.endsWith(" ") ? " " : ""));
  return { value: joined.replace(/\0/g, ""), warnings };
}

/** Calls whose string arguments are class lists. */
const CLASS_HELPERS = [
  "cn",
  "clsx",
  "cva",
  "twMerge",
  "classnames",
  "classNames",
  "tw",
  "twJoin",
  "cx",
];

/** String literals (and static template parts) inside `[start, end)`. */
function stringLiterals(
  src: string,
  start: number,
  end: number,
  spans: readonly Span[],
): { start: number; end: number }[] {
  return spans.filter(
    (s) =>
      s.start >= start &&
      s.end <= end &&
      /^["'`]/.test(src[s.start]!) &&
      src[s.end - 1] === src[s.start],
  );
}

/** Convert class lists in JSX/HTML/JS sources: `className=`, `class=` and the class helper calls. */
export function tailwindClassesV4(source: string): CodemodResult {
  const spans = skippedSpans(source);
  const edits: { start: number; end: number; text: string }[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  const convert = (lit: { start: number; end: number }) => {
    if (seen.has(lit.start)) return;
    seen.add(lit.start);
    const text = source.slice(lit.start + 1, lit.end - 1);
    if (text.includes("${")) {
      // Only the static parts of a template literal.
      return;
    }
    const { value, warnings: w } = classListV3ToV4(text);
    warnings.push(...w);
    if (value !== text) edits.push({ start: lit.start + 1, end: lit.end - 1, text: value });
  };

  const attr = /\b(?:className|class)\s*=\s*/g;
  for (let m = attr.exec(source); m !== null; m = attr.exec(source)) {
    if (inSkipped(spans, m.index)) continue;
    const at = m.index + m[0].length;
    const c = source[at];
    if (c === '"' || c === "'") {
      const lit = spans.find((s) => s.start === at);
      if (lit) convert(lit);
    } else if (c === "{") {
      const close = matching(source, at, spans);
      if (close !== -1) for (const lit of stringLiterals(source, at, close, spans)) convert(lit);
    }
  }
  const call = new RegExp(`\\b(?:${CLASS_HELPERS.join("|")})\\s*\\(`, "g");
  for (let m = call.exec(source); m !== null; m = call.exec(source)) {
    if (inSkipped(spans, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = matching(source, open, spans);
    if (close !== -1) for (const lit of stringLiterals(source, open, close, spans)) convert(lit);
  }
  const tagged = /\btw`/g;
  for (let m = tagged.exec(source); m !== null; m = tagged.exec(source)) {
    const lit = spans.find((s) => s.start === m.index + 2);
    if (lit) convert(lit);
  }
  if (edits.length === 0) return { code: source, changes: [], warnings: [...new Set(warnings)] };
  return {
    code: applyEdits(source, edits),
    changes: [
      `${edits.length} class list${edits.length === 1 ? "" : "s"} converted to Tailwind v4 names`,
    ],
    warnings: [...new Set(warnings)],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------------------------------

const directive = (name: string): RegExp =>
  new RegExp(`^[ \\t]*@tailwind\\s+${name}\\s*;[ \\t]*\\n?`, "m");

/** `@tailwind` directives, `@layer utilities` rules and `theme()` in a stylesheet. */
export function tailwindCssV4(source: string): CodemodResult {
  let code = source;
  const changes: string[] = [];
  const warnings: string[] = [];

  const hasAll = ["base", "components", "utilities"].every((n) => directive(n).test(code));
  if (hasAll) {
    code = code
      .replace(directive("base"), '@import "tailwindcss";\n')
      .replace(directive("components"), "")
      .replace(directive("utilities"), "");
    changes.push('@tailwind base, components, utilities -> @import "tailwindcss"');
  } else {
    const partial: [string, string][] = [
      [
        "base",
        '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/preflight.css" layer(base);\n',
      ],
      ["components", ""],
      ["utilities", '@import "tailwindcss/utilities.css" layer(utilities);\n'],
    ];
    for (const [name, to] of partial) {
      if (directive(name).test(code)) {
        code = code.replace(directive(name), to);
        changes.push(`@tailwind ${name} -> ${to === "" ? "(removed)" : "@import"}`);
      }
    }
  }

  // @layer utilities { .name { ... } }  ->  @utility name { ... }
  const spans = skippedSpans(code);
  const layer = /@layer\s+utilities\s*\{/g;
  const edits: { start: number; end: number; text: string }[] = [];
  for (let m = layer.exec(code); m !== null; m = layer.exec(code)) {
    if (inSkipped(spans, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = matching(code, open, spans);
    if (close === -1) continue;
    const inner = code.slice(open + 1, close);
    const rules = [...inner.matchAll(/(^|\n)([ \t]*)\.([\w-]+)\s*\{([^{}]*)\}/g)];
    const rest = inner
      .replace(/(^|\n)([ \t]*)\.([\w-]+)\s*\{([^{}]*)\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (rules.length > 0 && rest === "") {
      const text = rules.map((r) => `@utility ${r[3]} {${r[4]}}`).join("\n\n");
      edits.push({ start: m.index, end: close + 1, text });
      changes.push(`@layer utilities .${rules.map((r) => r[3]).join(", .")} -> @utility`);
    } else if (inner.trim() !== "") {
      warnings.push(
        "@layer utilities holds rules with selectors the codemod does not convert (pseudo-classes, nesting): convert them to @utility by hand",
      );
    }
  }
  if (edits.length > 0) code = applyEdits(code, edits);

  // theme(colors.red.500) -> var(--color-red-500)
  const theme = code.replace(/theme\(\s*(?:colors\.)([\w.-]+?)\s*\)/g, (_all, path: string) => {
    changes.push(`theme(colors.${path}) -> var(--color-${path.replace(/\./g, "-")})`);
    return `var(--color-${path.replace(/\./g, "-")})`;
  });
  code = theme.replace(/theme\(\s*spacing\.(\d+(?:\.\d+)?)\s*\)/g, (_all, n: string) => {
    changes.push(`theme(spacing.${n}) -> calc(var(--spacing) * ${n})`);
    return `calc(var(--spacing) * ${n})`;
  });
  if (/theme\(\s*['"]?[\w.]+/.test(code))
    warnings.push(
      "theme() calls remain: replace them with var(--...) of the matching @theme variable",
    );
  if (/@apply[^;]*\b(?:!|\w+-opacity-)/.test(code))
    warnings.push(
      "@apply with an important prefix or an -opacity- utility: rewrite it with the v4 syntax (p-4!, bg-black/50)",
    );

  return code === source && warnings.length === 0 ? unchanged(source) : { code, changes, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// tailwind.config.js -> @theme
// ---------------------------------------------------------------------------------------------------------------

const THEME_NAMESPACES: Record<string, string> = {
  colors: "color",
  borderRadius: "radius",
  spacing: "spacing",
  screens: "breakpoint",
  boxShadow: "shadow",
  fontFamily: "font",
  fontSize: "text",
  fontWeight: "font-weight",
  letterSpacing: "tracking",
  lineHeight: "leading",
  transitionTimingFunction: "ease",
};

/** Flatten `{ brand: { 500: "#f00", DEFAULT: "#a00" } }` to `[["brand-500", "#f00"], ["brand", "#a00"]]`. */
function flatten(src: string, open: number, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const prop of properties(src, open)) {
    const name = prop.key === "DEFAULT" ? prefix : prefix ? `${prefix}-${prop.key}` : prop.key;
    if (prop.value.startsWith("{")) out.push(...flatten(src, prop.valueStart, name));
    else {
      const str = /^(["'`])((?:\\.|(?!\1).)*)\1$/.exec(prop.value);
      if (str) out.push([name.replace(/\./g, "_"), str[2]!]);
      else if (prop.value.startsWith("[")) {
        const items = [...prop.value.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!);
        if (items.length > 0) out.push([name, items.join(", ")]);
      }
    }
  }
  return out;
}

export function tailwindConfigToCss(source: string, path: string): CodemodResult {
  const warnings: string[] = [];
  const lines: string[] = [];
  const themeVars: string[] = [];

  const themeOpen = objectValueOpen(source, "theme");
  if (themeOpen !== -1) {
    const themeProps = properties(source, themeOpen);
    const extendProp = themeProps.find((p) => p.key === "extend");
    const groups = [
      ...themeProps.filter((p) => p.key !== "extend"),
      ...(extendProp ? properties(source, extendProp.valueStart) : []),
    ];
    for (const group of groups) {
      const ns = THEME_NAMESPACES[group.key];
      if (!ns) {
        warnings.push(`theme.${group.key} has no @theme namespace here: port it by hand`);
        continue;
      }
      if (!group.value.startsWith("{")) continue;
      for (const [name, value] of flatten(source, group.valueStart)) {
        const clean = value.replace(/"/g, "'");
        themeVars.push(`  --${ns}-${name}: ${clean};`);
      }
      if (!extendProp || !properties(source, extendProp.valueStart).includes(group))
        warnings.push(
          `theme.${group.key} replaced the default scale in v3: in v4 it only adds to it unless you reset it with --${ns}-*: initial`,
        );
    }
  }
  const dark = /darkMode\s*:\s*(?:\[\s*)?["'](class|selector|media)["']/.exec(source);
  if (dark && dark[1] !== "media") lines.push("@custom-variant dark (&:where(.dark, .dark *));");
  const plugins = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)]
    .map((m) => m[1]!)
    .filter((n) => n.startsWith("@tailwindcss/") || n.startsWith("tailwindcss-"));
  for (const plugin of plugins) lines.push(`@plugin "${plugin}";`);
  if (/\bcontent\s*:/.test(source))
    warnings.push(
      'content: v4 finds sources by itself; add `@source "../path";` only for files outside the project (node_modules, other packages)',
    );
  if (/\bsafelist\s*:/.test(source)) warnings.push('safelist: use `@source inline("...")`');
  if (/\bprefix\s*:/.test(source)) warnings.push('prefix: use `@import "tailwindcss" prefix(tw);`');
  if (/\bimportant\s*:/.test(source))
    warnings.push('important: use `@import "tailwindcss" important;`');
  if (/\bkeyframes\s*:|\banimation\s*:/.test(source))
    warnings.push(
      "keyframes and animation: define --animate-* in @theme and the @keyframes next to it by hand",
    );

  const header = [
    "/* From tailwind.config: M3 apps replace the colours with the preset: */",
    '/* @import "@aphrody/m3-tokens/m3-tokens.css"; @import "@aphrody/m3-tokens/expressive.css"; @import "@aphrody/m3-tailwind/preset.css"; */',
  ].join("\n");
  const css = [
    header,
    ...(lines.length > 0 ? ["", ...lines] : []),
    ...(themeVars.length > 0 ? ["", "@theme {", ...themeVars, "}"] : []),
    "",
  ].join("\n");
  const rename = path.replace(/tailwind\.config\.[cm]?[jt]s$/, "tailwind-theme.css");
  return {
    code: css,
    changes: [
      `${path} -> ${rename} (@theme with ${themeVars.length} variable${themeVars.length === 1 ? "" : "s"}${plugins.length ? `, ${plugins.length} @plugin` : ""})`,
    ],
    warnings,
    rename,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PostCSS and package.json
// ---------------------------------------------------------------------------------------------------------------

export function postcssConfigV4(source: string): CodemodResult {
  if (!/\btailwindcss\b/.test(source)) return unchanged(source);
  let code = source;
  const changes: string[] = [];
  const quoted = /(["'])tailwindcss\1(\s*:\s*\{[^}]*\})/;
  const bare = /(^|[\s,{])tailwindcss(\s*:\s*\{[^}]*\})/;
  if (quoted.test(code)) code = code.replace(quoted, '"@tailwindcss/postcss"$2');
  else if (bare.test(code)) code = code.replace(bare, '$1"@tailwindcss/postcss"$2');
  else if (/\brequire\(\s*["']tailwindcss["']\s*\)/.test(code))
    code = code.replace(/require\(\s*["']tailwindcss["']\s*\)/g, 'require("@tailwindcss/postcss")');
  if (code !== source) changes.push("tailwindcss -> @tailwindcss/postcss");
  for (const plugin of ["autoprefixer", "postcss-import"]) {
    const open = objectValueOpen(code, "plugins");
    const hit = open === -1 ? undefined : properties(code, open).find((p) => p.key === plugin);
    if (hit) {
      code = removeRange(code, hit.start, hit.end);
      changes.push(`removed ${plugin} (v4 handles imports and prefixes)`);
    } else if (new RegExp(`["']${plugin}["']`).test(code) && /plugins\s*:\s*\[/.test(code)) {
      code = code.replace(new RegExp(`\\s*["']${plugin}["']\\s*,?`), "");
      changes.push(`removed ${plugin} (v4 handles imports and prefixes)`);
    }
  }
  return code === source ? unchanged(source) : { code, changes, warnings: [] };
}

export function tailwindPackageJsonV4(source: string): CodemodResult {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(source);
  } catch {
    return unchanged(source);
  }
  const groupName = pkg.devDependencies?.["tailwindcss"]
    ? "devDependencies"
    : pkg.dependencies?.["tailwindcss"]
      ? "dependencies"
      : undefined;
  if (!groupName) return unchanged(source);
  const group = pkg[groupName]!;
  const changes: string[] = [];
  const current = group["tailwindcss"]!;
  if (/^[\^~]?3\./.test(current) || /^[\^~]?[0-2]\./.test(current)) {
    group["tailwindcss"] = "^4.1.0";
    changes.push(`tailwindcss ${current} -> ^4.1.0`);
    if (!group["@tailwindcss/postcss"]) {
      group["@tailwindcss/postcss"] = "^4.1.0";
      changes.push("added @tailwindcss/postcss");
    }
  }
  for (const name of ["autoprefixer", "postcss-import"]) {
    for (const g of [pkg.dependencies, pkg.devDependencies]) {
      if (g?.[name] !== undefined) {
        delete g[name];
        changes.push(`removed ${name}`);
      }
    }
  }
  if (changes.length === 0) return unchanged(source);
  const indent = /^\{\n([ \t]+)/.exec(source)?.[1] ?? "  ";
  return {
    code: JSON.stringify(pkg, null, indent) + (source.endsWith("\n") ? "\n" : ""),
    changes,
    warnings: [],
  };
}
