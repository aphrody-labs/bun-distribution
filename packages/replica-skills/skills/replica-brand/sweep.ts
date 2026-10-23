#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Bun port of sweep.py from Replica (Copyright (c) 2026 Jake Schincariol, MIT; see
// packages/replica-skills/LICENSE). sweep.py stays beside this file as the upstream reference.
//
// Rebrand sweep for replica-brand and replica-deploy. Searches the clone's codebase for
// anything that still belongs to the original app: its name, its domain, its brand colours.
// Exits 1 when it finds anything, so it can block a deploy.
//
//   bun sweep.ts . --avoid "Calendly"
//   bun sweep.ts . --avoid "Calendly,Calendly LLC" --domains calendly.com --colors "#006bff,#0ae8f0"
//   bun sweep.ts . --config replica/brand.json --json
//
// --config reads {"avoid": [...], "domains": [...], "colors": [...]}. Names match
// case-insensitively anywhere, including inside identifiers. Colours match in any case and
// in short form (#06f matches #0066ff). File and folder names are checked as well as
// contents. Skipped: .git, node_modules, build output folders, lock files, binary files and
// the top-level replica/ planning folder (pass --include-replica to check it too).

import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  ".vercel",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
  ".expo",
  "DerivedData",
  ".gradle",
]);
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Podfile.lock",
  "Cargo.lock",
  "poetry.lock",
]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".avif",
  ".heic",
  ".psd",
  ".sketch",
  ".fig",
  ".jar",
  ".so",
  ".dylib",
]);
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;
const HEX_ONLY = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface SweepHit {
  file: string;
  line: number;
  kind: "name" | "domain" | "color" | "path";
  match: string;
  text: string;
}

type Pattern = { kind: "name" | "domain"; label: string; rx: RegExp };

export function normHex(hex: string): string {
  let h = hex.toLowerCase().replace(/^#+/, "");
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return `#${h}`;
}

function buildPatterns(avoid: readonly string[], domains: readonly string[]): Pattern[] {
  const patterns: Pattern[] = [];
  for (const raw of avoid) {
    const name = raw.trim();
    if (!name) continue;
    // "Acuity Scheduling" also matches AcuityScheduling and acuity-scheduling.
    const parts = name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(escape);
    patterns.push({ kind: "name", label: name, rx: new RegExp(parts.join("[\\s_-]?"), "i") });
  }
  for (const raw of domains) {
    const domain = raw.trim().toLowerCase();
    if (domain) patterns.push({ kind: "domain", label: domain, rx: new RegExp(escape(domain), "i") });
  }
  return patterns;
}

function isBinary(path: string, bytes: Uint8Array): boolean {
  return BINARY_EXT.has(extname(path).toLowerCase()) || bytes.subarray(0, 4096).includes(0);
}

/** Universal newlines, as Python's text-mode readlines() splits them. */
const LINE_BREAK = /\r\n|\r|\n/;

function relPath(root: string, path: string) {
  return relative(root, path) || ".";
}

export async function sweep(
  root: string,
  {
    avoid = [],
    domains = [],
    colors = [],
    includeReplica = false,
    maxSize = 2_000_000,
  }: {
    avoid?: readonly string[];
    domains?: readonly string[];
    colors?: readonly string[];
    includeReplica?: boolean;
    maxSize?: number;
  } = {},
): Promise<SweepHit[]> {
  const patterns = buildPatterns(avoid, domains);
  const wanted = new Set(
    colors
      .map(c => c.trim())
      .filter(c => HEX_ONLY.test(c))
      .map(normHex),
  );
  const hits: SweepHit[] = [];
  const top = resolve(root);
  const names = patterns.filter(p => p.kind === "name");
  const walk = async (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const isTop = dir === top;
    const dirs = entries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !(e.name === "replica" && isTop && !includeReplica))
      .map(e => e.name)
      .sort();
    const files = entries
      .filter(e => !e.isDirectory())
      .map(e => e.name)
      .sort();
    for (const d of dirs) {
      for (const p of names)
        if (p.rx.test(d))
          hits.push({
            file: `${relPath(top, join(dir, d))}/`,
            line: 0,
            kind: "path",
            match: p.label,
            text: "folder name",
          });
    }
    for (const name of files) {
      if (SKIP_FILES.has(name)) continue;
      const path = join(dir, name);
      const rel = relPath(top, path);
      for (const p of names)
        if (p.rx.test(name)) hits.push({ file: rel, line: 0, kind: "path", match: p.label, text: "file name" });
      let lines: string[];
      try {
        if (statSync(path).size > maxSize) continue;
        const bytes = await Bun.file(path).bytes();
        if (isBinary(path, bytes)) continue;
        lines = new TextDecoder("utf-8").decode(bytes).split(LINE_BREAK);
        if (lines.at(-1) === "") lines.pop();
      } catch {
        continue;
      }
      lines.forEach((line, index) => {
        const text = line.trim().slice(0, 160);
        for (const p of patterns)
          if (p.rx.test(line)) hits.push({ file: rel, line: index + 1, kind: p.kind, match: p.label, text });
        if (wanted.size > 0) {
          for (const m of line.matchAll(HEX)) {
            const hex = normHex(m[0]);
            if (wanted.has(hex)) hits.push({ file: rel, line: index + 1, kind: "color", match: hex, text });
          }
        }
      });
    }
    for (const d of dirs) await walk(join(dir, d));
  };
  await walk(top);
  return hits;
}

export function renderSweep(hits: readonly SweepHit[]): string {
  if (hits.length === 0) return "Clean. Nothing of the original's name, domain or colours found.";
  const byKind = new Map<string, number>();
  const out = hits.map(h => {
    byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
    const loc = h.line ? `${h.file}:${h.line}` : h.file;
    return `${h.kind.padEnd(7)} ${h.match.slice(0, 18).padEnd(18)} ${loc}  ${h.text}`;
  });
  const kinds = [...byKind].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k} ${n}`);
  out.push("", `${hits.length} hits (${kinds.join(", ")}). Replace every one before you launch.`);
  return out.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        avoid: { type: "string", default: "" },
        domains: { type: "string", default: "" },
        colors: { type: "string", default: "" },
        config: { type: "string" },
        "include-replica": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`sweep: ${(error as Error).message}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(
      "Usage: bun sweep.ts [root] --avoid <names> [--domains <list>] [--colors <hex list>] [--config brand.json] [--include-replica] [--json]",
    );
    return 0;
  }
  const list = (text: string) => text.split(",").filter(x => x.trim());
  const avoid = list(values.avoid);
  const domains = list(values.domains);
  const colors = list(values.colors);
  if (values.config) {
    try {
      const cfg = (await Bun.file(values.config).json()) as { avoid?: string[]; domains?: string[]; colors?: string[] };
      avoid.push(...(cfg.avoid ?? []));
      domains.push(...(cfg.domains ?? []));
      colors.push(...(cfg.colors ?? []));
    } catch (error) {
      console.error(`sweep: ${(error as Error).message}`);
      return 2;
    }
  }
  if (avoid.length + domains.length + colors.length === 0) {
    console.error("sweep: nothing to look for. Pass --avoid with the original app's name.");
    return 2;
  }
  const hits = await sweep(positionals[0] ?? ".", {
    avoid,
    domains,
    colors,
    includeReplica: values["include-replica"],
  });
  console.log(values.json ? JSON.stringify(hits, null, 2) : renderSweep(hits));
  return hits.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
