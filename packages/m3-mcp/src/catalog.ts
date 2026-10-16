// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Resolve the M3 source root without assuming a particular checkout layout. */
const roots = [
  process.env.APHRODY_M3_ROOT,
  resolve(process.cwd(), "m3"),
  resolve(import.meta.dir, "../aphrody-m3"),
].filter((root): root is string => !!root);
export const ROOT =
  roots.find((root) => existsSync(join(root, "packages/m3-tokens"))) ??
  roots[0]!;

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

export function listPackages(root = ROOT): string[] {
  const dir = join(root, "packages");
  const packages = readdirSync(dir).flatMap((d) => {
    const p = join(dir, d, "package.json");
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, "utf8"));
    return [`${j.name}@${j.version ?? "0.0.0"}  packages/${d}`];
  });
  const own = join(import.meta.dir, "../package.json");
  if (existsSync(own)) {
    const j = JSON.parse(readFileSync(own, "utf8"));
    const entry = `${j.name}@${j.version ?? "0.0.0"}  external/${j.name}`;
    if (!packages.some((p) => p.startsWith(`${j.name}@`))) packages.push(entry);
  }
  return packages;
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
    return exports.startsWith("./") &&
      exports.endsWith(".css") &&
      !exports.includes("*")
      ? [exports]
      : [];
  if (Array.isArray(exports)) return exports.flatMap(exportedSheets);
  if (exports && typeof exports === "object")
    return Object.values(exports).flatMap(exportedSheets);
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
      add({
        name: m[1]!,
        value: m[2]!.trim(),
        source: `packages/m3-tokens/${path}`,
      });
    }
  }
  // `dynamic-color.ts` is the public module of the roles; it re-exports the list from `native-theme.ts`.
  const list = ["src/dynamic-color.ts", "src/native-theme.ts"]
    .map(
      (file) =>
        /export const ROLES = \[([\s\S]*?)\]/.exec(read(join(pkg, file)))?.[1],
    )
    .find((roles) => roles !== undefined);
  const roles = (list ?? "").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
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
  const checked = [
    ...new Set([...input.matchAll(/--md-[\w-]+/g)].map((m) => m[0])),
  ];
  return { checked, unknown: checked.filter((n) => !known.has(n)) };
}

function* walk(dir: string, includeJson = false): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      e.name === "node_modules" ||
      e.name.startsWith(".git") ||
      e.isSymbolicLink()
    )
      continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, includeJson);
    else if ((includeJson ? /\.(md|mdx|json)$/ : /\.(md|mdx)$/).test(e.name))
      yield p;
  }
}

/** The single native Web acquisition corpus, explicitly configurable for qualified hosts. */
export function designCorpusRoot(
  root = ROOT,
  configured = process.env.APHRODY_DESIGN_CORPUS,
): string | undefined {
  const corpus = resolve(
    configured ?? join(root, "../var/mirrors/design-sync"),
  );
  return existsSync(join(corpus, "AI_READY.md")) &&
    statSync(corpus).isDirectory()
    ? corpus
    : undefined;
}

export function searchDocs(
  query: string,
  limit = 20,
  root = ROOT,
  corpus = designCorpusRoot(root),
): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  const docs = join(root, "docs");
  const sources = [
    ...(corpus
      ? [...walk(corpus, true)].map((file) => ({
          file,
          source: `design-sync/${relative(corpus, file).replaceAll("\\", "/")}`,
        }))
      : []),
    ...(existsSync(docs)
      ? [...walk(docs)].map((file) => ({
          file,
          source: relative(root, file).replaceAll("\\", "/"),
        }))
      : []),
  ];
  for (const { file, source } of sources) {
    const lines = read(file).split("\n");
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (lines[i]!.toLowerCase().includes(q))
        hits.push(`${source}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

export function researchLinks(
  root = ROOT,
  corpus = designCorpusRoot(root),
): { files: string[]; links: string[] } {
  if (corpus) {
    const documents = [...walk(corpus, true)];
    const links = [
      ...new Set(
        documents.flatMap((file) =>
          [...read(file).matchAll(/https?:\/\/[^\s<>"'\])]+/g)].map((match) =>
            match[0].replace(/[.,;]+$/, ""),
          ),
        ),
      ),
    ].toSorted();
    return {
      files: documents.map(
        (file) => `design-sync/${relative(corpus, file).replaceAll("\\", "/")}`,
      ),
      links,
    };
  }
  const dir = join(root, "docs/research");
  const files = existsSync(dir)
    ? [...walk(dir)].map((f) => relative(root, f))
    : [];
  // The link index moved with the M3 integrations to the Bun fork checkout next to this repository.
  const index = [
    dir,
    join(
      root,
      "../../bun/packages/bun-aphrody-web/integrations/m3/docs/research",
    ),
  ]
    .map((research) => join(research, "GOOGLE-LINKS.md"))
    .find((file) => existsSync(file));
  if (index && !index.startsWith(dir)) files.push(relative(root, index));
  const links = [
    ...read(index ?? "").matchAll(
      /^\|\s*([^|]+?)\s*\|\s*(https?:\/\/\S+)\s*\|/gm,
    ),
  ].map((m) => `${m[1]}  ${m[2]}`);
  return { files, links };
}

export function listTemplates(root = ROOT): string[] {
  const rows: string[] = [];
  for (const base of ["templates", "examples", "examples/tauri"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir)) {
      if (
        statSync(join(dir, e)).isDirectory() &&
        !(base === "examples" && e === "tauri")
      )
        rows.push(`${base}/${e}`);
    }
  }
  return rows;
}
