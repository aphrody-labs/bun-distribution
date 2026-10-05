// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const ROOT = join(import.meta.dir, "../../..");

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

export function listPackages(root = ROOT): string[] {
  const dir = join(root, "packages");
  return readdirSync(dir).flatMap((d) => {
    const p = join(dir, d, "package.json");
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, "utf8"));
    return [`${j.name}@${j.version ?? "0.0.0"}  packages/${d}`];
  });
}

export interface Token {
  name: string;
  value: string;
  source: string;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Local CSS targets of the token package's exports, including conditional exports and aliases. */
function exportedSheets(exports: unknown): string[] {
  if (typeof exports === "string")
    return exports.startsWith("./") && exports.endsWith(".css") && !exports.includes("*")
      ? [exports]
      : [];
  if (Array.isArray(exports)) return exports.flatMap(exportedSheets);
  if (exports && typeof exports === "object") return Object.values(exports).flatMap(exportedSheets);
  return [];
}

/** Every exported `--md-*` CSS property and dynamic colour role, once per name. */
export function loadTokens(root = ROOT): Token[] {
  const pkg = join(root, "packages/m3-tokens");
  const manifest = read(join(pkg, "package.json"));
  const exports: unknown = manifest
    ? (JSON.parse(manifest) as { exports?: unknown }).exports
    : undefined;
  const out = new Map<string, Token>();
  const add = (token: Token) => {
    // The first declaration is representative; theme/direction variants do not create new names.
    if (!out.has(token.name)) out.set(token.name, token);
  };
  for (const target of new Set(exportedSheets(exports))) {
    const file = resolve(pkg, target);
    const path = relative(pkg, file).replaceAll("\\", "/");
    if (
      isAbsolute(path) ||
      path === ".." ||
      path.startsWith("../") ||
      path.split("/").includes("node_modules")
    )
      continue;
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/(--md-[\w-]+)\s*:\s*([^;]+);/g)) {
      add({ name: m[1]!, value: m[2]!.trim(), source: `packages/m3-tokens/${path}` });
    }
  }
  const dyn = read(join(pkg, "src/dynamic-color.ts"));
  const roles = (/export const ROLES = \[([\s\S]*?)\]/.exec(dyn)?.[1] ?? "").replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    "",
  );
  for (const m of roles.matchAll(/["'](\w+)["']/g)) {
    add({
      name: `--md-sys-color-${kebab(m[1]!)}`,
      value: "(dynamic colour role)",
      source: "packages/m3-tokens/src/dynamic-color.ts",
    });
  }
  return [...out.values()];
}

export function lookupTokens(query: string, limit = 50, root = ROOT): Token[] {
  const q = query.toLowerCase();
  return loadTokens(root)
    .filter((t) => t.name.includes(q) || t.value.toLowerCase().includes(q))
    .slice(0, limit);
}

/** Validate token names or every `var(--md-*)` / `--md-*` reference found in a CSS snippet. */
export function validateTokens(
  input: string,
  root = ROOT,
): { checked: string[]; unknown: string[] } {
  const known = new Set(loadTokens(root).map((t) => t.name));
  const checked = [...new Set([...input.matchAll(/--md-[\w-]+/g)].map((m) => m[0]))];
  return { checked, unknown: checked.filter((n) => !known.has(n)) };
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".git")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(md|mdx)$/.test(e)) yield p;
  }
}

export function searchDocs(query: string, limit = 20, root = ROOT): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  const docs = join(root, "docs");
  if (!existsSync(docs)) return hits;
  for (const f of walk(docs)) {
    const lines = read(f).split("\n");
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (lines[i]!.toLowerCase().includes(q))
        hits.push(`${relative(root, f)}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

export function researchLinks(root = ROOT): { files: string[]; links: string[] } {
  const dir = join(root, "docs/research");
  const files = existsSync(dir) ? [...walk(dir)].map((f) => relative(root, f)) : [];
  const links = [
    ...read(join(dir, "GOOGLE-LINKS.md")).matchAll(/^\|\s*([^|]+?)\s*\|\s*(https?:\/\/\S+)\s*\|/gm),
  ].map((m) => `${m[1]}  ${m[2]}`);
  return { files, links };
}

export function listTemplates(root = ROOT): string[] {
  const rows: string[] = [];
  for (const base of ["templates", "examples", "examples/tauri"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir)) {
      if (statSync(join(dir, e)).isDirectory() && !(base === "examples" && e === "tauri"))
        rows.push(`${base}/${e}`);
    }
  }
  return rows;
}
