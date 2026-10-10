// SPDX-License-Identifier: Apache-2.0
/**
 * Generate the ecosystem catalog under `docs/ecosystem/`: every repository, crate, binary,
 * feature, Bun package and uv package of the Aphrody workspace, the exact clap command tree of
 * every shipped binary, and every MCP tool registered in source.
 *
 * Everything is extracted from the checkout next to this repository (cargo metadata, clap
 * derive definitions, MCP registrations, package manifests) — nothing is written by hand, so
 * the catalog cannot silently drift: `--check` fails when the committed output is stale.
 *
 * Usage: bun scripts/tools/workspace/ecosystem.ts [--root <workspace>] [--out <dir>] [--check]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadCargoMetadata } from "./repo-layering.ts";

/** The two active roots; retired category repositories remain migration history. */
export const APHRODY_REPOS = ["aphrody", "iecode"] as const;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface CrateInfo {
  name: string;
  path: string;
  description: string;
  bins: string[];
  features: string[];
}

export interface BunPackage {
  name: string;
  path: string;
  description: string;
  bins: string[];
}

export interface PythonPackage {
  name: string;
  path: string;
  description: string;
  scripts: string[];
}

export interface CommandNode {
  name: string;
  about: string;
  aliases: string[];
  cfg: string[];
  children: CommandNode[];
}

export interface CliBinary {
  binary: string;
  crate: string;
  repo: string;
  source: string;
  commands: CommandNode[];
}

export interface McpTool {
  name: string;
  description: string;
  file: string;
}

export interface McpServer {
  server: string;
  repo: string;
  kind: "rmcp" | "kernel-subsystem" | "json-catalog" | "bun-mcp";
  tools: McpTool[];
}

export interface RepoInfo {
  name: string;
  kind: "aphrody" | "experiment" | "shared";
  role: string;
  crates: CrateInfo[];
  bunPackages: BunPackage[];
  pythonPackages: PythonPackage[];
  errors: string[];
}

export interface Ecosystem {
  generator: string;
  repos: RepoInfo[];
  cli: CliBinary[];
  binariesWithoutClap: { binary: string; crate: string; repo: string }[];
  mcp: McpServer[];
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------------------------

const EXCLUDED = /(^|\/)(node_modules|vendor|third_party|third-party|target|dist|\.git)\//;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|fixtures|examples|benches|testdata)\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(^|\/)tests\.rs$|_tests?\.rs$/;

/** Tracked plus untracked-but-not-ignored files of a repository matching `patterns`. */
export function gitFiles(repoDir: string, patterns: string[]): string[] {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...patterns],
    { windowsHide: true, cwd: repoDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) return [];
  return [
    ...new Set(result.stdout.split("\0").filter((file) => file !== "" && !EXCLUDED.test(file))),
  ]
    .filter((file) => existsSync(join(repoDir, file)))
    .toSorted();
}

const read = (path: string): string => readFileSync(path, "utf8");
const posix = (path: string): string => path.replaceAll("\\", "/");

/** Nearest owner (longest directory prefix) of `file` among `owners` (dir -> name). */
function ownerOf(file: string, owners: [string, string][]): string | undefined {
  let best: [string, string] | undefined;
  for (const owner of owners) {
    const dir = owner[0];
    if (
      (dir === "" || file.startsWith(`${dir}/`)) &&
      (best === undefined || dir.length > best[0].length)
    )
      best = owner;
  }
  return best?.[1];
}

// ---------------------------------------------------------------------------------------------
// Rust tokenizer (enough of Rust to read clap derives and MCP registrations)
// ---------------------------------------------------------------------------------------------

export type Tok =
  | { k: "doc"; v: string }
  | { k: "attr"; v: string }
  | { k: "ident"; v: string }
  | { k: "str"; v: string }
  | { k: "punct"; v: string };

/** Decode a Rust (non-raw) string literal body. */
export function decodeRustString(body: string): string {
  return body.replace(
    /\\(\r?\n\s*|u\{([0-9a-fA-F]+)\}|x([0-9a-fA-F]{2})|.)/g,
    (_m, esc: string, uni?: string, hex?: string) => {
      if (uni !== undefined) return String.fromCodePoint(Number.parseInt(uni, 16));
      if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
      if (esc.startsWith("\n") || esc.startsWith("\r")) return "";
      return ({ n: "\n", t: "\t", r: "\r", "0": "\0" } as Record<string, string>)[esc] ?? esc;
    },
  );
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  const isIdent = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
  /** Read a string starting at the opening quote (or `r#..."`); returns [decoded, end]. */
  const readString = (start: number): [string, number] => {
    let j = start;
    let raw = false;
    let hashes = 0;
    if (src[j] === "b") j += 1;
    if (src[j] === "r") {
      raw = true;
      j += 1;
      while (src[j] === "#") {
        hashes += 1;
        j += 1;
      }
    }
    j += 1; // opening quote
    const bodyStart = j;
    if (raw) {
      const close = `"${"#".repeat(hashes)}`;
      const end = src.indexOf(close, j);
      const stop = end < 0 ? n : end;
      return [src.slice(bodyStart, stop), stop + close.length];
    }
    while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
    return [decodeRustString(src.slice(bodyStart, j)), j + 1];
  };
  while (i < n) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const line = src.slice(i, end < 0 ? n : end);
      if (line.startsWith("///") && !line.startsWith("////"))
        out.push({ k: "doc", v: line.slice(3).replace(/^ /, "").trimEnd() });
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      continue;
    }
    if (c === "#" && (src[i + 1] === "[" || (src[i + 1] === "!" && src[i + 2] === "["))) {
      const inner = src[i + 1] === "!";
      let j = i + (inner ? 3 : 2);
      const start = j;
      let depth = 1;
      while (j < n && depth > 0) {
        const d = src[j];
        if (
          d === '"' ||
          ((d === "r" || d === "b") &&
            !isIdent(src[j - 1]) &&
            /^(b?r#*"|b")/.test(src.slice(j, j + 4)))
        ) {
          j = readString(j)[1];
          continue;
        }
        if (d === "[") depth += 1;
        else if (d === "]") depth -= 1;
        j += 1;
      }
      if (!inner) out.push({ k: "attr", v: src.slice(start, j - 1).trim() });
      i = j;
      continue;
    }
    if (c === '"' || ((c === "r" || c === "b") && /^(b?r#*"|b")/.test(src.slice(i, i + 4)))) {
      const [value, end] = readString(i);
      out.push({ k: "str", v: value });
      i = end;
      continue;
    }
    if (c === "'") {
      if (src[i + 1] === "\\") {
        const end = src.indexOf("'", i + 3);
        i = end < 0 ? n : end + 1;
      } else if (src[i + 2] === "'") {
        i += 3;
      } else {
        i += 1;
        while (isIdent(src[i])) i += 1;
      }
      continue;
    }
    if (isIdent(c)) {
      let j = i;
      while (isIdent(src[j])) j += 1;
      out.push({ k: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    out.push({ k: "punct", v: c });
    i += 1;
  }
  return out;
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Index just past the group opened at `start` (`(`, `[` or `{`). */
function skipGroup(toks: Tok[], start: number): number {
  let depth = 0;
  for (let i = start; i < toks.length; i += 1) {
    const t = toks[i] as Tok;
    if (t.k !== "punct") continue;
    if (t.v in OPEN) depth += 1;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return toks.length;
}

/** Split tokens on top-level commas (angle brackets count as nesting). */
function splitTop(toks: Tok[]): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "punct") {
      if (t.v in OPEN || t.v === "<") depth += 1;
      else if (t.v === ")" || t.v === "]" || t.v === "}" || t.v === ">") depth -= 1;
      else if (t.v === "," && depth === 0) {
        parts.push(cur);
        cur = [];
        continue;
      }
    }
    cur.push(t);
  }
  if (cur.length > 0) parts.push(cur);
  return parts;
}

// ---------------------------------------------------------------------------------------------
// clap derive model
// ---------------------------------------------------------------------------------------------

interface Meta {
  docs: string[];
  attrs: string[];
}

interface Field extends Meta {
  name: string;
  type: string | undefined;
}

interface Variant extends Meta {
  name: string;
  shape: "unit" | "tuple" | "named";
  type: string | undefined;
  fields: Field[];
}

export interface ClapItem extends Meta {
  kind: "enum" | "struct";
  name: string;
  file: string;
  crate: string;
  repo: string;
  derives: string[];
  variants: Variant[];
  fields: Field[];
}

function leadingMeta(toks: Tok[]): [Meta, number] {
  const meta: Meta = { docs: [], attrs: [] };
  let i = 0;
  for (; i < toks.length; i += 1) {
    const t = toks[i] as Tok;
    if (t.k === "doc") meta.docs.push(t.v);
    else if (t.k === "attr") meta.attrs.push(t.v);
    else break;
  }
  return [meta, i];
}

const WRAPPERS = new Set(["Option", "Box", "Vec", "Arc", "Rc"]);

/** Last concrete type name in a type expression (`Option<Box<a::FooArgs>>` -> `FooArgs`). */
export function typeName(toks: Tok[]): string | undefined {
  const idents = toks.filter((t) => t.k === "ident" && /^[A-Z]/.test(t.v) && !WRAPPERS.has(t.v));
  return idents.at(-1)?.v;
}

function parseFields(toks: Tok[]): Field[] {
  const fields: Field[] = [];
  for (const part of splitTop(toks)) {
    const [meta, start] = leadingMeta(part);
    let i = start;
    if (part[i]?.k === "ident" && part[i]?.v === "pub") {
      i += 1;
      if (part[i]?.v === "(") i = skipGroup(part, i);
    }
    const name = part[i];
    if (name?.k !== "ident" || part[i + 1]?.v !== ":") continue;
    fields.push({ ...meta, name: name.v, type: typeName(part.slice(i + 2)) });
  }
  return fields;
}

function parseVariants(toks: Tok[]): Variant[] {
  const variants: Variant[] = [];
  for (const part of splitTop(toks)) {
    const [meta, start] = leadingMeta(part);
    const name = part[start];
    if (name?.k !== "ident") continue;
    const next = part[start + 1];
    if (next?.v === "(") {
      const end = skipGroup(part, start + 1);
      variants.push({
        ...meta,
        name: name.v,
        shape: "tuple",
        type: typeName(part.slice(start + 2, end - 1)),
        fields: [],
      });
    } else if (next?.v === "{") {
      const end = skipGroup(part, start + 1);
      variants.push({
        ...meta,
        name: name.v,
        shape: "named",
        type: undefined,
        fields: parseFields(part.slice(start + 2, end - 1)),
      });
    } else {
      variants.push({ ...meta, name: name.v, shape: "unit", type: undefined, fields: [] });
    }
  }
  return variants;
}

const CLAP_DERIVES = new Set(["Parser", "Subcommand", "Args"]);

/** Every enum/struct deriving `Parser`, `Subcommand` or `Args` in a Rust source file. */
export function clapItems(src: string, file: string, crate: string, repo: string): ClapItem[] {
  const toks = tokenize(src);
  const items: ClapItem[] = [];
  let pending: Meta = { docs: [], attrs: [] };
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i] as Tok;
    if (t.k === "doc") {
      pending.docs.push(t.v);
      continue;
    }
    if (t.k === "attr") {
      pending.attrs.push(t.v);
      continue;
    }
    if (t.k === "ident" && t.v === "pub") {
      if (toks[i + 1]?.v === "(") i = skipGroup(toks, i + 1) - 1;
      continue;
    }
    if (t.k === "ident" && (t.v === "enum" || t.v === "struct") && toks[i + 1]?.k === "ident") {
      const name = (toks[i + 1] as Tok).v;
      let j = i + 2;
      let angle = 0;
      while (j < toks.length) {
        const v = (toks[j] as Tok).v;
        if (v === "<") angle += 1;
        else if (v === ">") angle -= 1;
        else if (angle === 0 && (v === "{" || v === "(" || v === ";")) break;
        j += 1;
      }
      const opener = toks[j]?.v;
      const end = opener === "{" || opener === "(" ? skipGroup(toks, j) : j + 1;
      const derives = pending.attrs
        .filter((a) => a.startsWith("derive("))
        .flatMap((a) =>
          a
            .slice(7, -1)
            .split(",")
            .map((d) => d.trim().split("::").at(-1) ?? ""),
        );
      if (opener === "{" && derives.some((d) => CLAP_DERIVES.has(d))) {
        const body = toks.slice(j + 1, end - 1);
        items.push({
          ...pending,
          kind: t.v,
          name,
          file,
          crate,
          repo,
          derives,
          variants: t.v === "enum" ? parseVariants(body) : [],
          fields: t.v === "struct" ? parseFields(body) : [],
        });
      }
      i = end - 1;
      pending = { docs: [], attrs: [] };
      continue;
    }
    pending = { docs: [], attrs: [] };
  }
  return items;
}

/** Parsed `#[command(...)]` / `#[clap(...)]` / `#[arg(...)]` keys of an attribute list. */
function clapAttr(attrs: string[]): { flags: Set<string>; values: Map<string, string[]> } {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  for (const attr of attrs) {
    const m = /^(command|clap|arg)\s*\(([\s\S]*)\)$/.exec(attr);
    if (m === null) continue;
    const body = m[2] as string;
    for (const kv of body.matchAll(/([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\[\s\S])*)"/g)) {
      const key = kv[1] as string;
      values.set(key, [...(values.get(key) ?? []), decodeRustString(kv[2] as string)]);
    }
    for (const list of body.matchAll(/([A-Za-z_]+)\s*=\s*\[([^\]]*)\]/g)) {
      const key = list[1] as string;
      const items = [...(list[2] as string).matchAll(/"((?:[^"\\]|\\[\s\S])*)"/g)].map(
        (s) => s[1] as string,
      );
      values.set(key, [...(values.get(key) ?? []), ...items]);
    }
    for (const bare of body
      .replace(/"(?:[^"\\]|\\[\s\S])*"/g, '""')
      .matchAll(/(?:^|[(,])\s*([A-Za-z_]+)\s*(?=,|\)|$)/g)) {
      flags.add(bare[1] as string);
    }
    if (/\bhide\s*=\s*true\b/.test(body)) flags.add("hide");
  }
  return { flags, values };
}

function cfgOf(attrs: string[]): string[] {
  return attrs
    .filter((a) => /^cfg\s*\(/.test(a))
    .map((a) => a.replace(/^cfg\s*\(([\s\S]*)\)$/, "$1").replace(/\s+/g, " "));
}

/** First paragraph of a doc comment, collapsed to one line. */
export function summary(docs: string[], limit = 240): string {
  const lines: string[] = [];
  for (const line of docs) {
    if (line.trim() === "") {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(line.trim());
  }
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** clap's default subcommand naming (heck kebab-case). */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export function reexportedParser(
  index: ClapIndex,
  source: string,
  binary: string,
  repo: string,
): ClapItem | undefined {
  const owners = new Set(
    [...source.matchAll(/pub\s+use\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*::\s*\*\s*;/g)].map(
      (match) => match[1],
    ),
  );
  const candidates = index
    .parsers()
    .filter(
      (parser) =>
        parser.repo === repo &&
        owners.has(parser.crate.replaceAll("-", "_")) &&
        !TEST_PATH.test(parser.file) &&
        clapAttr(parser.attrs).values.get("name")?.[0] === binary,
    );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export class ClapIndex {
  private readonly byName = new Map<string, ClapItem[]>();

  add(item: ClapItem): void {
    this.byName.set(item.name, [...(this.byName.get(item.name) ?? []), item]);
  }

  resolve(
    name: string | undefined,
    from: { file: string; crate: string; repo: string },
  ): ClapItem | undefined {
    if (name === undefined) return undefined;
    const candidates = this.byName.get(name) ?? [];
    return (
      candidates.find((c) => c.file === from.file && c.repo === from.repo) ??
      candidates.find((c) => c.crate === from.crate && c.repo === from.repo) ??
      candidates.find((c) => c.repo === from.repo) ??
      candidates[0]
    );
  }

  parsers(): ClapItem[] {
    return [...this.byName.values()].flat().filter((item) => item.derives.includes("Parser"));
  }

  /** Subcommands reachable from the fields of a struct (or struct-like variant). */
  fieldCommands(fields: Field[], owner: ClapItem, stack: Set<ClapItem>): CommandNode[] {
    const out: CommandNode[] = [];
    for (const field of fields) {
      const { flags } = clapAttr(field.attrs);
      if (!flags.has("subcommand") && !flags.has("flatten")) continue;
      const target = this.resolve(field.type, owner);
      if (target === undefined || stack.has(target)) continue;
      out.push(...this.commandsOf(target, stack));
    }
    return out;
  }

  commandsOf(item: ClapItem, stack: Set<ClapItem> = new Set()): CommandNode[] {
    const next = new Set(stack).add(item);
    if (item.kind === "struct") return this.fieldCommands(item.fields, item, next);
    const out: CommandNode[] = [];
    for (const variant of item.variants) {
      const { flags, values } = clapAttr(variant.attrs);
      if (flags.has("hide") || flags.has("skip") || flags.has("external_subcommand")) continue;
      const target = variant.shape === "tuple" ? this.resolve(variant.type, item) : undefined;
      if (flags.has("flatten")) {
        if (target !== undefined && !next.has(target)) out.push(...this.commandsOf(target, next));
        continue;
      }
      let children: CommandNode[] = [];
      if (target !== undefined && !next.has(target)) children = this.commandsOf(target, next);
      else if (variant.shape === "named") children = this.fieldCommands(variant.fields, item, next);
      const aliases = [
        ...(values.get("visible_alias") ?? []),
        ...(values.get("visible_aliases") ?? []),
        ...(values.get("alias") ?? []),
        ...(values.get("aliases") ?? []),
      ];
      const docs = values.get("about")?.[0] ?? summary(variant.docs);
      out.push({
        name: values.get("name")?.[0] ?? kebab(variant.name),
        about: docs.replace(/\s+/g, " ").trim(),
        aliases: [...new Set(aliases)].toSorted(),
        cfg: cfgOf(variant.attrs),
        children,
      });
    }
    return out;
  }
}

export function countCommands(nodes: CommandNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countCommands(node.children), 0);
}

// ---------------------------------------------------------------------------------------------
// MCP tool extraction
// ---------------------------------------------------------------------------------------------

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** rmcp `#[tool(...)]` methods, grouped by the `impl` type that hosts them. */
export function rmcpTools(src: string): { server: string; name: string; description: string }[] {
  const toks = tokenize(src);
  const out: { server: string; name: string; description: string }[] = [];
  let impl = "";
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i] as Tok;
    if (t.k === "ident" && t.v === "impl") {
      let j = i + 1;
      const head: Tok[] = [];
      while (j < toks.length && toks[j]?.v !== "{" && toks[j]?.v !== ";")
        head.push(toks[j++] as Tok);
      const forAt = head.findIndex((h) => h.k === "ident" && h.v === "for");
      impl = typeName(forAt >= 0 ? head.slice(forAt + 1) : head) ?? impl;
      continue;
    }
    if (t.k !== "attr" || !/^tool\s*\(/.test(t.v)) continue;
    const body = t.v.replace(/^tool\s*\(([\s\S]*)\)$/, "$1");
    const desc = /\bdescription\s*=\s*"((?:[^"\\]|\\[\s\S])*)"/.exec(body);
    const named = /\bname\s*=\s*"((?:[^"\\]|\\[\s\S])*)"/.exec(body);
    let j = i + 1;
    while (j < toks.length && (toks[j]?.k === "attr" || toks[j]?.k === "doc")) j += 1;
    while (
      j < toks.length &&
      toks[j]?.k === "ident" &&
      ["pub", "async", "const", "unsafe"].includes(toks[j]?.v ?? "")
    ) {
      j += 1;
      if (toks[j]?.v === "(") j = skipGroup(toks, j);
    }
    if (toks[j]?.v !== "fn" || toks[j + 1]?.k !== "ident") continue;
    const fnName = (toks[j + 1] as Tok).v;
    out.push({
      server: impl,
      name: named !== null ? decodeRustString(named[1] as string) : fnName,
      description: desc !== null ? oneLine(decodeRustString(desc[1] as string)) : "",
    });
  }
  return out;
}

/** Literal `ToolDefinition::new("name", "description", ...)` registrations. */
export function kernelTools(src: string): { name: string; description: string }[] {
  const toks = tokenize(src);
  const out: { name: string; description: string }[] = [];
  for (let i = 0; i + 6 < toks.length; i += 1) {
    if (
      toks[i]?.v !== "ToolDefinition" ||
      toks[i + 1]?.v !== ":" ||
      toks[i + 2]?.v !== ":" ||
      toks[i + 3]?.v !== "new" ||
      toks[i + 4]?.v !== "("
    )
      continue;
    const name = toks[i + 5];
    const comma = toks[i + 6];
    const desc = toks[i + 7];
    if (name?.k === "str" && comma?.v === "," && desc?.k === "str")
      out.push({ name: name.v, description: oneLine(desc.v) });
  }
  return out;
}

/** Subsystem name declared by `fn name(&self) -> &str { "..." }` in a file, if unique. */
export function subsystemName(src: string): string | undefined {
  const names = [
    ...src.matchAll(
      /fn\s+name\s*\(\s*&self\s*\)\s*->\s*&(?:'static\s+)?str\s*\{\s*"([^"]+)"\s*\}/g,
    ),
  ].map((m) => m[1] as string);
  return new Set(names).size === 1 ? names[0] : undefined;
}

/** JSON tool catalogs (`{"name": ..., "description": ..., "inputSchema": ...}`) in JSON or `json!`. */
export function jsonCatalogTools(src: string): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  const re = /"name"\s*:\s*"([A-Za-z0-9_.-]+)"\s*,\s*"description"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/g;
  for (const m of src.matchAll(re)) {
    const after = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 4000);
    const nextName = after.search(/"name"\s*:/);
    const schema = after.search(/"inputSchema"\s*:/);
    if (schema < 0 || (nextName >= 0 && nextName < schema)) continue;
    let description: string;
    try {
      description = JSON.parse(`"${m[2] as string}"`) as string;
    } catch {
      description = decodeRustString(m[2] as string); // `json!` literal with Rust-only escapes
    }
    out.push({ name: m[1] as string, description: oneLine(description) });
  }
  return out;
}

/** Read a JS string literal (or `+`-concatenation of literals) starting at `at`. */
function jsString(src: string, at: number): string | undefined {
  let i = at;
  let out = "";
  let any = false;
  for (;;) {
    while (/\s/.test(src[i] ?? "")) i += 1;
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") break;
    let j = i + 1;
    let body = "";
    while (j < src.length && src[j] !== q) {
      if (src[j] === "\\") {
        const e = src[j + 1] ?? "";
        body += ({ n: "\n", t: "\t" } as Record<string, string>)[e] ?? e;
        j += 2;
      } else body += src[j++];
    }
    if (q === "`" && body.includes("${")) body = body.replace(/\$\{[^}]*\}/g, "…");
    out += body;
    any = true;
    i = j + 1;
    while (/\s/.test(src[i] ?? "")) i += 1;
    if (src[i] !== "+") break;
    i += 1;
  }
  return any ? out : undefined;
}

/** Bun/TS MCP registrations: `registerTool(<name>, { description })` and `.tool(<name>, <description>)`. */
export function tsTools(src: string): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  for (const m of src.matchAll(/\bregisterTool\s*\(\s*(["'`])([A-Za-z0-9_.:-]+)\1\s*,/g)) {
    const window = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3000);
    const d = /\bdescription\s*:\s*/.exec(window);
    const next = window.search(/\bregisterTool\s*\(/);
    const description =
      d !== null && (next < 0 || d.index < next)
        ? jsString(window, d.index + d[0].length)
        : undefined;
    out.push({ name: m[2] as string, description: oneLine(description ?? "") });
  }
  for (const m of src.matchAll(/\.tool\s*\(\s*(["'`])([A-Za-z0-9_.:-]+)\1\s*,\s*/g)) {
    const description = jsString(src, (m.index ?? 0) + m[0].length);
    out.push({ name: m[2] as string, description: oneLine(description ?? "") });
  }
  return out;
}

/** Bun kernel subsystem: `registerSubsystem({ name })` and its `{ name, description }` tool specs. */
export function bunSubsystemTools(
  src: string,
): { subsystem: string; tools: { name: string; description: string }[] } | undefined {
  const call = /\bregisterSubsystem\s*\(\s*\{\s*name\s*:\s*(["'`])([A-Za-z0-9_.-]+)\1/.exec(src);
  if (call === null) return undefined;
  const tools: { name: string; description: string }[] = [];
  const spec = /\bname\s*:\s*(["'`])([A-Za-z0-9_.:-]+)\1\s*,\s*description\s*:\s*/g;
  for (const m of src.matchAll(spec)) {
    // The registration's own `name`/`description` describe the subsystem, not a tool.
    if ((m.index ?? 0) >= call.index && (m.index ?? 0) < call.index + call[0].length) continue;
    const description = jsString(src, (m.index ?? 0) + m[0].length);
    tools.push({ name: m[2] as string, description: oneLine(description ?? "") });
  }
  return { subsystem: call[2] as string, tools };
}

// ---------------------------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------------------------

/** `[project]` name/description and `[project.scripts]` keys of a pyproject.toml. */
export function readPyproject(text: string): {
  name?: string;
  description?: string;
  scripts: string[];
} {
  let section = "";
  const out: { name?: string; description?: string; scripts: string[] } = { scripts: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      section = header[1] as string;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const key = (kv[1] as string).replace(/^"|"$/g, "");
    const value = /^"((?:[^"\\]|\\[\s\S])*)"/.exec(kv[2] as string)?.[1];
    if (section === "project" && key === "name") out.name = value;
    if (section === "project" && key === "description") out.description = value;
    if (section === "project.scripts") out.scripts.push(key);
  }
  out.scripts.sort();
  return out;
}

interface MetaPackage {
  name: string;
  description: string | null;
  manifest_path: string;
  features: Record<string, string[]>;
  targets: { name: string; kind: string[]; src_path: string }[];
  dependencies: { name: string }[];
}

/** Dispatch table of the single `aphrody` binary (former standalone binaries, now `aphrody <tool>`). */
const MULTICALL = "crates/infra/aphrody-command/src/multicall.rs";

/**
 * `aphrody <tool>` names whose entry point is another crate's `cli_main`: the binaries retired into the
 * multi-call binary keep their clap tree in that crate, so it is indexed under the multi-call name.
 */
export function multicallTools(
  dir: string,
  repo: string,
  packages: MetaPackage[],
): {
  binary: string;
  crate: string;
  repo: string;
  src: string;
  libSrc?: string;
  usesClap: boolean;
}[] {
  const table = join(dir, MULTICALL);
  if (!existsSync(table)) return [];
  const crates = new Map(packages.map((pkg) => [pkg.name.replaceAll("-", "_"), pkg]));
  const out = [];
  for (const m of read(table).matchAll(
    /tool\(\s*"([^"]+)",\s*&\[[^\]]*\],\s*Target::Entry\(([a-z0-9_]+)::([a-z0-9_:]+)\)/g,
  )) {
    const local = m[2] === "crate";
    const pkg = crates.get(local ? "aphrody_command" : (m[2] as string));
    const lib = pkg?.targets.find((t) => t.kind.some((k) => k === "lib" || k === "rlib"));
    if (pkg === undefined || lib === undefined) continue;
    let entry = lib.src_path;
    if (local) {
      const segments = (m[3] as string).split("::");
      const fn = segments.pop();
      if (fn === undefined || segments.length === 0) continue;
      const module = join(dirname(lib.src_path), ...segments);
      entry = [module + ".rs", join(module, "mod.rs")].find(existsSync) ?? "";
      if (!entry) continue;
      // Follow a named local reexport to its actual function owner, rather than
      // selecting an unrelated Parser from the merged command crate.
      const source = read(entry);
      if (!new RegExp(`\\bfn\\s+${fn}\\s*\\(`).test(source)) {
        const reexport = new RegExp(`pub\\s+use\\s+([a-z0-9_]+)::${fn}\\s*;`).exec(source);
        if (reexport === null) continue;
        const moduleDir = basename(entry) === "mod.rs" ? dirname(entry) : entry.slice(0, -3);
        const child = join(moduleDir, reexport[1] as string);
        entry = [child + ".rs", join(child, "mod.rs")].find(existsSync) ?? "";
        if (!entry || !new RegExp(`\\bfn\\s+${fn}\\s*\\(`).test(read(entry))) continue;
      }
    }
    out.push({
      binary: `aphrody ${m[1]}`,
      crate: pkg.name,
      repo,
      src: entry,
      libSrc: entry,
      usesClap: pkg.dependencies.some((d) => d.name === "clap"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------------------------

export function collect(root: string): Ecosystem {
  const candidates = APHRODY_REPOS;
  const repoNames = candidates.filter((repo) => existsSync(join(root, repo)));
  const repos: RepoInfo[] = [];
  const index = new ClapIndex();
  const binTargets: {
    binary: string;
    crate: string;
    repo: string;
    src: string;
    libSrc?: string;
    usesClap: boolean;
  }[] = [];
  const multicallTargets: typeof binTargets = [];
  const mcp = new Map<string, McpServer>();
  const addTool = (repo: string, server: string, kind: McpServer["kind"], tool: McpTool): void => {
    const key = `${repo}\0${server}`;
    const entry = mcp.get(key) ?? { server, repo, kind, tools: [] };
    if (!entry.tools.some((t) => t.name === tool.name)) entry.tools.push(tool);
    mcp.set(key, entry);
  };

  for (const repo of repoNames) {
    const dir = realpathSync(join(root, repo));
    const info: RepoInfo = {
      name: repo,
      kind: "aphrody",
      role: {
        aphrody: "Canonical Rust/Bun monorepo",
        iecode: "Active game-domain workspace",
      }[repo],
      crates: [],
      bunPackages: [],
      pythonPackages: [],
      errors: [],
    };
    const crateDirs: [string, string][] = [];
    if (existsSync(join(dir, "Cargo.toml"))) {
      const metadata = loadCargoMetadata<MetaPackage>(dir);
      if ("error" in metadata) info.errors.push(metadata.error);
      else {
        for (const pkg of metadata.packages) {
          const crateDir = posix(dirname(pkg.manifest_path)).slice(posix(dir).length + 1);
          const bins = pkg.targets.filter((t) => t.kind.includes("bin"));
          const lib = pkg.targets.find((t) =>
            t.kind.some((k) => k === "lib" || k === "rlib" || k === "cdylib"),
          );
          crateDirs.push([crateDir, pkg.name]);
          info.crates.push({
            name: pkg.name,
            path: crateDir,
            description: oneLine(pkg.description ?? ""),
            bins: bins.map((b) => b.name).toSorted(),
            features: Object.keys(pkg.features)
              .filter((f) => !f.startsWith("dep:"))
              .toSorted(),
          });
          const usesClap = pkg.dependencies.some((d) => d.name === "clap");
          for (const bin of bins) {
            binTargets.push({
              binary: bin.name,
              crate: pkg.name,
              repo,
              src: bin.src_path,
              libSrc: lib?.src_path,
              usesClap,
            });
          }
        }
        multicallTargets.push(...multicallTools(dir, repo, metadata.packages));
      }
    }
    info.crates.sort((a, b) => a.name.localeCompare(b.name));

    const pkgDirs: [string, string][] = [];
    for (const file of gitFiles(dir, ["package.json", "**/package.json"])) {
      if (TEST_PATH.test(file)) continue;
      let json: { name?: string; description?: string; bin?: string | Record<string, string> };
      try {
        json = JSON.parse(read(join(dir, file))) as typeof json;
      } catch {
        continue;
      }
      if (typeof json.name !== "string") continue;
      const pkgDir = file === "package.json" ? "" : file.slice(0, -"/package.json".length);
      pkgDirs.push([pkgDir, json.name]);
      const bins =
        typeof json.bin === "string"
          ? [json.name.replace(/^@[^/]+\//, "")]
          : Object.keys(json.bin ?? {});
      info.bunPackages.push({
        name: json.name,
        path: pkgDir || ".",
        description: oneLine(json.description ?? ""),
        bins: bins.toSorted(),
      });
    }
    info.bunPackages.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

    for (const file of gitFiles(dir, ["pyproject.toml", "**/pyproject.toml"])) {
      if (TEST_PATH.test(file)) continue;
      const py = readPyproject(read(join(dir, file)));
      if (py.name === undefined) continue;
      info.pythonPackages.push({
        name: py.name,
        path: dirname(file),
        description: oneLine(py.description ?? ""),
        scripts: py.scripts,
      });
    }
    info.pythonPackages.sort((a, b) => a.name.localeCompare(b.name));

    for (const file of gitFiles(dir, ["*.rs"])) {
      const src = read(join(dir, file));
      const crate = ownerOf(file, crateDirs) ?? repo;
      if (/derive\([^)]*\b(Parser|Subcommand|Args)\b/.test(src)) {
        for (const item of clapItems(src, file, crate, repo)) index.add(item);
      }
      if (TEST_PATH.test(file)) continue;
      if (src.includes("#[tool(")) {
        for (const tool of rmcpTools(src))
          addTool(repo, `${crate}${tool.server ? ` (${tool.server})` : ""}`, "rmcp", {
            name: tool.name,
            description: tool.description,
            file,
          });
      }
      if (src.includes("ToolDefinition::new(")) {
        const subsystem = subsystemName(src);
        for (const tool of kernelTools(src))
          addTool(
            repo,
            subsystem !== undefined ? `${crate} subsystem \`${subsystem}\`` : crate,
            "kernel-subsystem",
            { ...tool, file },
          );
      }
      if (src.includes('"inputSchema"')) {
        for (const tool of jsonCatalogTools(src))
          addTool(repo, crate, "json-catalog", { ...tool, file });
      }
    }
    for (const file of gitFiles(dir, ["**/tools.json"])) {
      if (TEST_PATH.test(file)) continue;
      const crate = ownerOf(file, crateDirs) ?? repo;
      for (const tool of jsonCatalogTools(read(join(dir, file))))
        addTool(repo, crate, "json-catalog", { ...tool, file });
    }
    for (const file of gitFiles(dir, ["*.ts", "*.mts", "*.tsx"])) {
      if (TEST_PATH.test(file)) continue;
      const src = read(join(dir, file));
      const subsystem = bunSubsystemTools(src);
      if (subsystem !== undefined) {
        const pkg = ownerOf(file, pkgDirs) ?? repo;
        for (const tool of subsystem.tools)
          addTool(repo, `${pkg} subsystem \`${subsystem.subsystem}\``, "kernel-subsystem", {
            ...tool,
            file,
          });
      }
      if (!/\bregisterTool\s*\(|\.tool\s*\(\s*["'`]/.test(src)) continue;
      if (!/modelcontextprotocol|McpServer/.test(src) && !/\bregisterTool\s*\(/.test(src)) continue;
      const pkg = ownerOf(file, pkgDirs) ?? repo;
      for (const tool of tsTools(src)) addTool(repo, pkg, "bun-mcp", { ...tool, file });
    }
    repos.push(info);
  }

  const parserNames = new Set(index.parsers().map((p) => p.name));
  const cli: CliBinary[] = [];
  const binariesWithoutClap: Ecosystem["binariesWithoutClap"] = [];
  for (const bin of [...binTargets, ...multicallTargets]) {
    let parser: ClapItem | undefined;
    const from = { file: "", crate: bin.crate, repo: bin.repo };
    for (const path of [bin.src, bin.libSrc]) {
      if (parser !== undefined || path === undefined || !existsSync(path)) continue;
      const text = read(path);
      for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*::\s*(?:try_)?parse(?:_from)?\b/g)) {
        if (parserNames.has(m[1] as string)) {
          parser = index.resolve(m[1], {
            ...from,
            file: posix(path).slice(posix(realpathSync(join(root, bin.repo))).length + 1),
          });
          break;
        }
      }
    }
    if (parser === undefined && bin.libSrc !== undefined && existsSync(bin.libSrc)) {
      parser = reexportedParser(index, read(bin.libSrc), bin.binary, bin.repo);
    }
    if (parser === undefined && bin.usesClap) {
      const own = index
        .parsers()
        .filter((p) => p.crate === bin.crate && p.repo === bin.repo && !TEST_PATH.test(p.file));
      parser =
        own.find((p) => clapAttr(p.attrs).values.get("name")?.[0] === bin.binary) ??
        (own.length === 1 ? own[0] : undefined);
    }
    if (parser === undefined) {
      binariesWithoutClap.push({ binary: bin.binary, crate: bin.crate, repo: bin.repo });
      continue;
    }
    cli.push({
      binary: bin.binary,
      crate: bin.crate,
      repo: bin.repo,
      source: `${parser.file}#${parser.name}`,
      commands: index.commandsOf(parser),
    });
  }
  cli.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      a.binary.localeCompare(b.binary) ||
      a.crate.localeCompare(b.crate),
  );
  binariesWithoutClap.sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.binary.localeCompare(b.binary),
  );

  const servers = [...mcp.values()].filter((s) => s.tools.length > 0);
  for (const server of servers) server.tools.sort((a, b) => a.name.localeCompare(b.name));
  servers.sort((a, b) => a.repo.localeCompare(b.repo) || a.server.localeCompare(b.server));

  const counts = {
    repos: repos.length,
    aphrodyRepos: repos.filter((r) => r.kind === "aphrody").length,
    experimentRepos: repos.filter((r) => r.kind === "experiment").length,
    sharedRepos: repos.filter((r) => r.kind === "shared").length,
    crates: repos.reduce((n, r) => n + r.crates.length, 0),
    binaries: binTargets.length,
    bunPackages: repos.reduce((n, r) => n + r.bunPackages.length, 0),
    pythonPackages: repos.reduce((n, r) => n + r.pythonPackages.length, 0),
    cliBinaries: cli.length,
    cliCommands: cli.reduce((n, b) => n + countCommands(b.commands), 0),
    mcpServers: servers.length,
    mcpTools: servers.reduce((n, s) => n + s.tools.length, 0),
    mcpUniqueToolNames: new Set(servers.flatMap((s) => s.tools.map((t) => t.name))).size,
  };
  return {
    generator: "scripts/tools/workspace/ecosystem.ts",
    repos,
    cli,
    binariesWithoutClap,
    mcp: servers,
    counts,
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const clip = (text: string, limit = 200): string =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
const HEADER =
  "<!-- @generated by scripts/tools/workspace/ecosystem.ts — do not edit; run `bun scripts/tools/workspace/ecosystem.ts` -->\n";

export function renderEcosystem(eco: Ecosystem): string {
  const c = eco.counts;
  const out: string[] = [
    HEADER,
    "# Aphrody ecosystem catalog",
    "",
    "Every repository, crate, binary, feature, Bun package and uv package of the workspace, extracted",
    "from the checkout. Companion files: [CLI.md](CLI.md) (exact command trees), [MCP-TOOLS.md](MCP-TOOLS.md)",
    "(every MCP tool), [ecosystem.json](ecosystem.json) (machine-readable). Check here before writing new",
    "code: reuse an existing crate, command or tool instead of duplicating it.",
    "",
    `Totals: ${c.repos} repositories (${c.aphrodyRepos} aphrody, ${c.sharedRepos} shared, ${c.experimentRepos} experiments), ${c.crates} crates, ${c.binaries} binaries, ${c.bunPackages} Bun packages, ${c.pythonPackages} uv packages, ${c.cliCommands} CLI commands, ${c.mcpTools} MCP tools.`,
    "",
    "| Repository | Kind | Role |",
    "| --- | --- | --- |",
    ...eco.repos.map((r) => `| [${r.name}](#${r.name}) | ${r.kind} | ${cell(r.role)} |`),
    "",
  ];
  for (const repo of eco.repos) {
    out.push(`## ${repo.name}`, "");
    if (repo.kind === "experiment")
      out.push("_Experiment converging into aphrody: reuse or port from it, do not grow it._", "");
    if (repo.kind === "shared")
      out.push("_Shared integration repository: applications retain domain logic and data._", "");
    if (repo.role !== "") out.push(repo.role, "");
    for (const error of repo.errors) out.push(`> extraction error: ${error}`, "");
    if (repo.crates.length > 0) {
      out.push(
        `### Crates (${repo.crates.length})`,
        "",
        "| Crate | Path | Description | Binaries | Features |",
        "| --- | --- | --- | --- | --- |",
      );
      for (const k of repo.crates) {
        out.push(
          `| \`${k.name}\` | ${k.path} | ${cell(k.description)} | ${k.bins.map((b) => `\`${b}\``).join(", ")} | ${cell(k.features.join(", "))} |`,
        );
      }
      out.push("");
    }
    if (repo.bunPackages.length > 0) {
      out.push(
        `### Bun packages (${repo.bunPackages.length})`,
        "",
        "| Package | Path | Description | Bin |",
        "| --- | --- | --- | --- |",
      );
      for (const p of repo.bunPackages)
        out.push(
          `| \`${p.name}\` | ${p.path} | ${cell(p.description)} | ${p.bins.map((b) => `\`${b}\``).join(", ")} |`,
        );
      out.push("");
    }
    if (repo.pythonPackages.length > 0) {
      out.push(
        `### uv packages (${repo.pythonPackages.length})`,
        "",
        "| Package | Path | Description | Scripts |",
        "| --- | --- | --- | --- |",
      );
      for (const p of repo.pythonPackages)
        out.push(
          `| \`${p.name}\` | ${p.path} | ${cell(p.description)} | ${p.scripts.map((s) => `\`${s}\``).join(", ")} |`,
        );
      out.push("");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function renderTree(prefix: string, nodes: CommandNode[], depth: number, out: string[]): void {
  for (const node of nodes) {
    const path = `${prefix} ${node.name}`;
    const extras = [
      node.aliases.length > 0 ? `aliases: ${node.aliases.join(", ")}` : "",
      node.cfg.length > 0 ? `cfg: ${node.cfg.join("; ")}` : "",
    ].filter((e) => e !== "");
    const about = node.about !== "" ? ` — ${clip(node.about)}` : "";
    out.push(
      `${"  ".repeat(depth)}- \`${path}\`${about}${extras.length > 0 ? ` _(${extras.join("; ")})_` : ""}`,
    );
    renderTree(path, node.children, depth + 1, out);
  }
}

/**
 * Render the installable Rust command boundary of Infra separately from the
 * ecosystem-wide command tree.  This keeps the distinction between a Cargo
 * library and a CLI executable observable: a crate is not presented as an
 * installable command unless Cargo metadata declares a binary target for it.
 */
function renderInfraRustCliInventory(eco: Ecosystem, out: string[]): void {
  const infra = eco.repos.find((repo) => repo.name === "aphrody-infra");
  if (infra === undefined) return;

  const commands = eco.cli.filter((cli) => cli.repo === infra.name);
  const commandByCrate = new Map(commands.map((cli) => [cli.crate, cli]));
  const binaries = infra.crates.filter((krate) => krate.bins.length > 0);
  const libraries = infra.crates.filter((krate) => krate.bins.length === 0);

  out.push(
    "## Aphrody Infra Rust CLI inventory",
    "",
    "This section is generated from Cargo metadata and Clap derives. It lists only executable Rust",
    "targets in the Infra workspace; Nushell plugins and external developer tools are deliberately out",
    "of scope. Libraries remain callable through `aphrody-infra` subcommands but do not install a command.",
    "",
    `Totals: ${infra.crates.length} Rust crates, ${binaries.reduce((n, krate) => n + krate.bins.length, 0)} executable targets, ${libraries.length} library-only crates.`,
    "",
    "| Cargo crate | Executable | Parser | Commands |",
    "| --- | --- | --- | ---: |",
  );
  for (const krate of binaries) {
    for (const binary of krate.bins) {
      const cli = commandByCrate.get(krate.name);
      out.push(
        `| \`${krate.name}\` | \`${binary}\` | ${cli === undefined ? "not detected" : `\`${cli.source}\``} | ${cli === undefined ? "—" : countCommands(cli.commands)} |`,
      );
    }
  }
  out.push(
    "",
    `Library-only crates: ${libraries.map((krate) => `\`${krate.name}\``).join(", ")}.`,
    "",
  );
}

export function renderCli(eco: Ecosystem): string {
  const out: string[] = [
    HEADER,
    "# CLI command trees",
    "",
    "Exact subcommand trees of every shipped binary, read from its clap derive definitions (hidden",
    "commands omitted; `cfg:` marks commands compiled only under a feature or target). Flags are not",
    "listed: run `<command> --help` for them. See [ECOSYSTEM.md](ECOSYSTEM.md) for the crates behind them.",
    "",
    `Totals: ${eco.counts.cliBinaries} binaries with a clap surface, ${eco.counts.cliCommands} commands.`,
    "",
  ];
  renderInfraRustCliInventory(eco, out);
  let repo = "";
  for (const bin of eco.cli) {
    if (bin.repo !== repo) {
      repo = bin.repo;
      out.push(`## ${repo}`, "");
    }
    out.push(
      `### \`${bin.binary}\``,
      "",
      `Crate \`${bin.crate}\`, parser \`${bin.source}\`, ${countCommands(bin.commands)} commands.`,
      "",
    );
    if (bin.commands.length === 0) out.push("_No subcommands (flags only)._");
    renderTree(bin.binary, bin.commands, 0, out);
    out.push("");
  }
  if (eco.binariesWithoutClap.length > 0) {
    out.push("## Binaries without a detected clap surface", "");
    for (const b of eco.binariesWithoutClap)
      out.push(`- \`${b.binary}\` (${b.repo} / \`${b.crate}\`)`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function renderMcp(eco: Ecosystem): string {
  const out: string[] = [
    HEADER,
    "# MCP tools",
    "",
    "Every MCP tool registered in source, grouped by server: rmcp `#[tool]` routers, kernel subsystem",
    "`ToolDefinition`s, JSON tool catalogs, and Bun `registerTool` servers. Descriptions are clipped; the",
    "full text is in [ecosystem.json](ecosystem.json). The kernel re-exports its subsystems' tools through",
    "`aphrody-kernel`, so one tool name can appear under several servers.",
    "",
    `Totals: ${eco.counts.mcpServers} servers, ${eco.counts.mcpTools} tool registrations, ${eco.counts.mcpUniqueToolNames} unique tool names.`,
    "",
  ];
  for (const server of eco.mcp) {
    out.push(
      `## ${server.repo} — ${server.server}`,
      "",
      `Kind: ${server.kind}. ${server.tools.length} tools.`,
      "",
      "| Tool | Description |",
      "| --- | --- |",
    );
    for (const tool of server.tools)
      out.push(`| \`${tool.name}\` | ${cell(clip(tool.description))} |`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function render(eco: Ecosystem): Record<string, string> {
  return {
    "ECOSYSTEM.md": renderEcosystem(eco),
    "CLI.md": renderCli(eco),
    "MCP-TOOLS.md": renderMcp(eco),
    "ecosystem.json": `${JSON.stringify(eco, null, 2)}\n`,
  };
}

/** Files whose committed content differs from a fresh generation. */
export function staleFiles(outDir: string, files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(
      ([name, content]) =>
        !existsSync(join(outDir, name)) ||
        read(join(outDir, name)).replace(/\r\n/g, "\n") !== content,
    )
    .map(([name]) => name);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const root = resolve(option("--root") ?? join(import.meta.dir, "..", "..", "..", ".."));
  const outDir = resolve(
    option("--out") ?? join(import.meta.dir, "..", "..", "..", "docs", "ecosystem"),
  );
  const eco = collect(root);
  const files = render(eco);
  const errors = eco.repos.flatMap((r) => r.errors.map((e) => `${r.name}: ${e}`));
  for (const error of errors) console.error(`error: ${error}`);
  const summaryLine = Object.entries(eco.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (args.includes("--check")) {
    const stale = staleFiles(outDir, files);
    for (const name of stale)
      console.error(`stale: ${join(outDir, name)} (run: bun scripts/tools/workspace/ecosystem.ts)`);
    console.log(summaryLine);
    process.exit(stale.length === 0 && errors.length === 0 ? 0 : 1);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content);
  console.log(summaryLine);
  process.exit(errors.length === 0 ? 0 : 1);
}
