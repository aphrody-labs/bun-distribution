/**
 * Proves that the site stylesheet compiles to the same CSS before and after a
 * change of an explicitly selected host stylesheet / `packages/shenron-ui/src/styles.css`
 * (first use: moving the token layer into `@shenron/ui/styles.css`).
 *
 *   bun packages/shenron-ui/scripts/check-css-equivalence.ts --site-root <host-app> [--package-git-path <path>] [--ref <rev>] [--keep <dir>] [--limit <n>]
 *
 * Both sides are compiled like Next compiles the site: postcss +
 * `@tailwindcss/postcss`, `base` = the explicit host app, candidates scanned from the
 * working tree. Tailwind's Lightning CSS pass (without minification) flattens
 * nesting so the two outputs compare rule by rule. Each compilation runs in its
 * own `bun` process: the plugin caches compilers per input file.
 *
 * - Baseline: `git show <rev>:<host stylesheet>` in its own Git owner (default `HEAD`).
 *   When that revision already imports `@shenron/ui/styles.css`, the package
 *   stylesheet of the same revision is inlined at the import.
 * - Candidate: the working-tree `globals.css`; its `@import "@shenron/ui/styles.css"`
 *   resolves through the workspace link and the package `exports`.
 *
 * Verdict, exit 1 on any finding:
 * 1. Effective values: for every (layer, conditions, selector, property) the
 *    winning declaration (`!important` first, then the last one) is identical,
 *    and no such pair appears or disappears.
 * 2. Cascade order: reordering is allowed only without conflicting duplicates.
 *    Two winning declarations of the same property in the same layer whose
 *    relative order flipped must carry the same value or differ in specificity.
 * 3. Layer order, statement at-rules (`@import`, `@charset`, `@layer a, b;`) and
 *    atomic blocks (`@keyframes`, `@font-face`, `@property`, …) are identical.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { resolveCssHost, type CssHost } from "./css-host";
import postcss, { type AtRule, type ChildNode, type Container, type Rule } from "postcss";

const siteHost = () => resolveCssHost("--site-root", "SHENRON_SITE_ROOT", ["src", "app", "globals.css"]);
const PACKAGE_IMPORT = /@import\s+["']@shenron\/ui\/styles\.css["']\s*;/;

// ─── Compilation ────────────────────────────────────────────────────────────

/** Child mode: compiles `input` as if it were `from`, writes the CSS to `output`. */
async function compileChild(input: string, from: string, output: string): Promise<void> {
  const { default: tailwindcss } = await import("@tailwindcss/postcss");
  const css = await Bun.file(input).text();
  const result = await postcss([tailwindcss({ base: siteHost().directory, optimize: { minify: false } })]).process(
    css,
    { from },
  );
  await Bun.write(output, result.css);
}

async function compile(css: string, label: string, workDir: string): Promise<string> {
  const host = siteHost();
  const input = join(workDir, `${label}.input.css`);
  const output = join(workDir, `${label}.compiled.css`);
  await Bun.write(input, css);
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      import.meta.path,
      "--compile-child",
      input,
      host.stylesheet,
      output,
      "--site-root",
      host.directory,
    ],
    {
      cwd: resolve(import.meta.dir, ".."),
      stdout: "inherit",
      stderr: "inherit",
      timeout: 25000,
      windowsHide: true,
    },
  );
  const code = await child.exited;
  if (code !== 0) throw new Error(`compilation of the ${label} stylesheet failed (exit ${code})`);
  return Bun.file(output).text();
}

function gitShow(rev: string, path: string, repository: string): string | null {
  const res = Bun.spawnSync(["git", "show", "--end-of-options", `${rev}:${path}`], {
    cwd: repository,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10000,
    windowsHide: true,
  });
  return res.exitCode === 0 ? res.stdout.toString() : null;
}

/** Baseline source: `<rev>` globals.css, with the package stylesheet of `<rev>` inlined if imported. */
export function baselineSource(
  rev: string,
  host: CssHost = siteHost(),
): {
  css: string;
  inlinedPackage: boolean;
} {
  const globals = gitShow(rev, host.gitPath, host.repository);
  if (globals === null) throw new Error(`git show ${rev}:${host.gitPath} failed`);
  if (!PACKAGE_IMPORT.test(globals)) return { css: globals, inlinedPackage: false };
  const pkg = gitShow(rev, host.packageGitPath, host.repository);
  if (pkg === null) throw new Error(`git show ${rev}:${host.packageGitPath} failed`);
  return {
    css: globals.replace(PACKAGE_IMPORT, () => pkg),
    inlinedPackage: true,
  };
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/** Winning declaration of one (layer, conditions, selector, property) key. */
export interface Winner {
  layer: string;
  prop: string;
  value: string;
  important: boolean;
  order: number;
  specificity: number;
}

export interface Analysis {
  declarations: number;
  winners: Map<string, Winner>;
  layerOrder: string[];
  statements: string[];
  atomic: Map<string, string>;
}

const ATOMIC = new Set([
  "keyframes",
  "-webkit-keyframes",
  "font-face",
  "property",
  "page",
  "counter-style",
  "font-feature-values",
  "font-palette-values",
  "view-transition",
]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Specificity packed as a*1e6 + b*1e3 + c. */
export function specificity(selector: string): number {
  const [a, b, c] = specificityTuple(selector);
  return a * 1e6 + b * 1e3 + c;
}

function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

function specificityTuple(selector: string): [number, number, number] {
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  const s = selector;
  const readIdent = (): string => {
    let out = "";
    while (i < s.length) {
      const ch = s[i] as string;
      if (ch === "\\") {
        out += s.slice(i, i + 2);
        i += 2;
      } else if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) {
        out += ch;
        i++;
      } else break;
    }
    return out;
  };
  const readArgs = (): string | null => {
    if (s[i] !== "(") return null;
    let depth = 0;
    const start = i + 1;
    for (; i < s.length; i++) {
      if (s[i] === "\\") i++;
      else if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          return s.slice(start, i - 1);
        }
      }
    }
    return s.slice(start);
  };
  const maxOf = (list: string): [number, number, number] => {
    let best: [number, number, number] = [0, 0, 0];
    for (const part of splitTopLevel(list)) {
      const t = specificityTuple(part);
      if (t[0] * 1e6 + t[1] * 1e3 + t[2] > best[0] * 1e6 + best[1] * 1e3 + best[2]) best = t;
    }
    return best;
  };
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === "#") {
      i++;
      readIdent();
      a++;
    } else if (ch === ".") {
      i++;
      readIdent();
      b++;
    } else if (ch === "[") {
      let depth = 0;
      for (; i < s.length; i++) {
        if (s[i] === "\\") i++;
        else if (s[i] === "[") depth++;
        else if (s[i] === "]" && --depth === 0) break;
      }
      i++;
      b++;
    } else if (ch === ":") {
      const element = s[i + 1] === ":";
      i += element ? 2 : 1;
      const name = readIdent().toLowerCase();
      const args = readArgs();
      if (element || ["before", "after", "first-line", "first-letter"].includes(name)) c++;
      else if (name === "where") {
        /* zero specificity */
      } else if (["is", "not", "has", "matches", "-webkit-any", "-moz-any"].includes(name)) {
        const t = maxOf(args ?? "");
        a += t[0];
        b += t[1];
        c += t[2];
      } else {
        b++;
        const of = args?.match(/\sof\s(.+)$/);
        if (of?.[1]) {
          const t = maxOf(of[1]);
          a += t[0];
          b += t[1];
          c += t[2];
        }
      }
    } else if (/[a-zA-Z_-]/.test(ch) || ch.charCodeAt(0) > 127) {
      readIdent();
      c++;
    } else {
      i++;
    }
  }
  return [a, b, c];
}

/** Flattens the compiled stylesheet into winning declarations and ordered structures. */
export function analyze(css: string): Analysis {
  const root = postcss.parse(css.replace(/\r\n/g, "\n"));
  const winners = new Map<string, Winner>();
  const layerOrder: string[] = [];
  const statements: string[] = [];
  const atomic = new Map<string, string>();
  let order = 0;
  let declarations = 0;
  let anonymousLayers = 0;

  const seeLayer = (path: string) => {
    if (!layerOrder.includes(path)) layerOrder.push(path);
  };

  const atomicKey = (node: AtRule): string => {
    const head = `@${node.name} ${collapse(node.params)}`;
    if (node.name !== "font-face") return head;
    const descriptors: string[] = [];
    node.walkDecls(d => {
      if (["font-family", "font-style", "font-weight", "font-stretch", "unicode-range"].includes(d.prop.toLowerCase()))
        descriptors.push(`${d.prop.toLowerCase()}:${collapse(d.value)}`);
    });
    return `${head}{${descriptors.sort().join(";")}}`;
  };

  const walk = (container: Container, layer: string[], conds: string[], selectors: string[] | null) => {
    container.each((node: ChildNode) => {
      if (node.type === "atrule") {
        const name = node.name.toLowerCase();
        if (name === "layer") {
          if (!node.nodes) {
            for (const n of node.params.split(",").map(p => p.trim())) seeLayer([...layer, n].join("."));
            statements.push(`@layer ${collapse(node.params)} @ ${layer.join(".")}`);
            return;
          }
          const n = node.params.trim() || `<anonymous-${++anonymousLayers}>`;
          const path = [...layer, n];
          seeLayer(path.join("."));
          walk(node, path, conds, selectors);
          return;
        }
        if (ATOMIC.has(name)) {
          const key = `${layer.join(".")} | ${conds.join(" & ")} | ${atomicKey(node)}`;
          atomic.set(key, collapse(node.toString()));
          order++;
          return;
        }
        if (!node.nodes) {
          statements.push(`@${name} ${collapse(node.params)} @ ${layer.join(".")}`);
          return;
        }
        // Conditional group rules (@media, @supports, @container, @starting-style, …)
        // and any other block at-rule scope their content.
        walk(node, layer, [...conds, `@${name} ${collapse(node.params)}`], selectors);
        return;
      }
      if (node.type === "rule") {
        const rule = node as Rule;
        const own = splitTopLevel(rule.selector).map(collapse);
        const composed = selectors
          ? selectors.flatMap(parent =>
              own.map(child => (child.includes("&") ? child.replaceAll("&", parent) : `${parent} ${child}`)),
            )
          : own;
        walk(rule, layer, conds, composed);
        return;
      }
      if (node.type === "decl") {
        declarations++;
        order++;
        const prop = node.prop.startsWith("--") ? node.prop : node.prop.toLowerCase();
        const value = collapse(node.value);
        const layerName = layer.join(".");
        for (const selector of selectors ?? ["<top-level>"]) {
          const key = `${layerName} | ${conds.join(" & ")} | ${selector} | ${prop}`;
          const previous = winners.get(key);
          if (previous && previous.important && !node.important) continue;
          winners.set(key, {
            layer: layerName,
            prop,
            value,
            important: node.important,
            order,
            specificity: specificity(selector),
          });
        }
      }
    });
  };

  walk(root, [], [], null);
  return { declarations, winners, layerOrder, statements, atomic };
}

export interface Findings {
  changed: string[];
  added: string[];
  removed: string[];
  orderConflicts: string[];
  structure: string[];
}

function diffMaps(base: Map<string, string>, next: Map<string, string>, label: string, out: Findings): void {
  for (const [key, value] of base) {
    const other = next.get(key);
    if (other === undefined) out.removed.push(`${label} ${key}`);
    else if (other !== value) out.changed.push(`${label} ${key}: ${value} → ${other}`);
  }
  for (const key of next.keys()) if (!base.has(key)) out.added.push(`${label} ${key}`);
}

/** Compares two analyses; empty arrays everywhere mean the stylesheets are equivalent. */
export function compare(base: Analysis, next: Analysis): Findings {
  const out: Findings = {
    changed: [],
    added: [],
    removed: [],
    orderConflicts: [],
    structure: [],
  };

  const show = (w: Winner) => `${w.value}${w.important ? " !important" : ""}`;
  for (const [key, w] of base.winners) {
    const other = next.winners.get(key);
    if (!other) out.removed.push(`${key} = ${show(w)}`);
    else if (show(other) !== show(w)) out.changed.push(`${key}: ${show(w)} → ${show(other)}`);
  }
  for (const [key, w] of next.winners) if (!base.winners.has(key)) out.added.push(`${key} = ${show(w)}`);

  if (base.layerOrder.join(",") !== next.layerOrder.join(","))
    out.structure.push(`layer order: ${base.layerOrder.join(", ")} → ${next.layerOrder.join(", ")}`);
  if (base.statements.join("\n") !== next.statements.join("\n"))
    out.structure.push(`statement at-rules: [${base.statements.join("; ")}] → [${next.statements.join("; ")}]`);
  diffMaps(base.atomic, next.atomic, "at-rule", out);

  // Cascade order among keys present on both sides, per (layer, property, importance).
  const groups = new Map<string, Array<{ key: string; a: Winner; b: Winner }>>();
  for (const [key, a] of base.winners) {
    const b = next.winners.get(key);
    if (!b || a.important !== b.important) continue;
    const group = `${a.layer}\u0000${a.prop}\u0000${a.important}`;
    let list = groups.get(group);
    if (!list) groups.set(group, (list = []));
    list.push({ key, a, b });
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => x.a.order - y.a.order);
    let monotonic = true;
    for (let i = 1; i < list.length && monotonic; i++)
      if ((list[i] as (typeof list)[number]).b.order < (list[i - 1] as (typeof list)[number]).b.order)
        monotonic = false;
    if (monotonic) continue;
    for (let i = 0; i < list.length; i++) {
      const x = list[i] as (typeof list)[number];
      for (let j = i + 1; j < list.length; j++) {
        const y = list[j] as (typeof list)[number];
        if (y.b.order > x.b.order) continue; // same relative order
        if (x.a.value === y.a.value) continue; // reordering without conflict
        if (x.a.specificity !== y.a.specificity) continue; // specificity decides, not order
        out.orderConflicts.push(`${x.key} (${x.a.value}) now after ${y.key} (${y.a.value})`);
      }
    }
  }
  return out;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "--compile-child") {
    const [, input, from, output] = argv;
    if (!input || !from || !output) throw new Error("usage: --compile-child <input> <from> <output>");
    await compileChild(input, from, output);
    return 0;
  }

  const rev = argValue(argv, "--ref") ?? "HEAD";
  const keep = argValue(argv, "--keep");
  const limit = Number(argValue(argv, "--limit") ?? 25);
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000)
    throw new Error("--limit must be an integer from 0 to 1000");
  const host = siteHost();
  const workDir = mkdtempSync(join(tmpdir(), "shenron-ui-css-"));

  try {
    const baseline = baselineSource(rev, host);
    const candidate = await Bun.file(host.stylesheet).text();
    const [baseCss, nextCss] = await Promise.all([
      compile(baseline.css, "baseline", workDir),
      compile(candidate, "candidate", workDir),
    ]);
    if (keep) {
      mkdirSync(keep, { recursive: true });
      await Bun.write(join(keep, "baseline.css"), baseCss);
      await Bun.write(join(keep, "candidate.css"), nextCss);
    }

    const base = analyze(baseCss);
    const next = analyze(nextCss);
    const findings = compare(base, next);
    const total =
      findings.changed.length +
      findings.added.length +
      findings.removed.length +
      findings.orderConflicts.length +
      findings.structure.length;

    console.log(
      `css-equivalence: baseline ${rev}:${host.gitPath}${baseline.inlinedPackage ? " (+ package stylesheet inlined)" : ""} vs working tree ${relative(host.repository, host.stylesheet).replaceAll("\\", "/")} + @shenron/ui/styles.css`,
    );
    console.log(
      `css-equivalence: declarations ${base.declarations} → ${next.declarations}; selector+property pairs ${base.winners.size} → ${next.winners.size}; layers ${base.layerOrder.length}; atomic at-rules ${base.atomic.size} → ${next.atomic.size}`,
    );
    const report = (title: string, items: string[]) => {
      console.log(`css-equivalence: ${title}: ${items.length}`);
      for (const item of items.slice(0, limit)) console.log(`  ${item}`);
      if (items.length > limit) console.log(`  … ${items.length - limit} more`);
    };
    report("changed effective values", findings.changed);
    report("added pairs", findings.added);
    report("removed pairs", findings.removed);
    report("cascade-order conflicts", findings.orderConflicts);
    report("structure differences", findings.structure);
    console.log(total === 0 ? "css-equivalence: OK" : `css-equivalence: FAILED (${total} findings)`);
    return total === 0 ? 0 : 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
