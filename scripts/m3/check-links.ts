#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// check-links.ts: every relative link of the Markdown documentation resolves.
//
//   bun scripts/check-links.ts [--json] [path..]
//
// Scans README.md files, docs/, packages/*, apps/*, templates/, examples/ (not node_modules, dist,
// forks, nested repositories). Inline links `[t](target)`, reference definitions `[id]: target` and
// HTML `href`/`src` in Markdown are checked; URLs, `mailto:`, pure `#anchors` and code blocks are not.
// A link that leaves this repository must exist in the enclosing host checkout (aphrody) when there
// is one, and is a warning otherwise. `#anchor` suffixes are checked against the target's headings.
// Exit 1 on any error.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hostRoot, nestedRepos } from "./check-assets.ts";

export const REPO = resolve(dirname(import.meta.path), "..");

export interface LinkFinding {
  file: string;
  line: number;
  link: string;
  severity: "error" | "warn";
  message: string;
}

const SKIP = new Set(["node_modules", "dist", ".git", "target", "forks", "upstream", ".next"]);

function markdownFiles(dir: string, skip: string[], out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (skip.some((s) => p === s || p.startsWith(s + sep))) continue;
    if (e.isDirectory()) markdownFiles(p, skip, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

/** GitHub-style heading slug. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const anchorCache = new Map<string, Set<string>>();
/** Anchors of a Markdown file: heading slugs (with -1, -2 suffixes for repeats) and explicit ids. */
export function anchors(file: string): Set<string> {
  const cached = anchorCache.get(file);
  if (cached) return cached;
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const set = new Set<string>();
  const seen = new Map<string, number>();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) set.add(m[1]!);
  anchorCache.set(file, set);
  return set;
}

/** Links of a Markdown document with their 1-based line numbers (code blocks and spans excluded). */
export function links(text: string): Array<{ link: string; line: number }> {
  const out: Array<{ link: string; line: number }> = [];
  let fence = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)) out.push({ link: m[1]!, line: i + 1 });
    const def = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/.exec(line);
    if (def) out.push({ link: def[1]!, line: i + 1 });
    for (const m of line.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) out.push({ link: m[1]!, line: i + 1 });
  });
  return out;
}

const external = (link: string) => /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//");

export function checkLinks(repo = REPO, roots: string[] = [repo]): LinkFinding[] {
  const host = hostRoot(repo);
  const nested = nestedRepos(repo);
  const findings: LinkFinding[] = [];
  const files = roots.flatMap((r) => (statSync(r).isDirectory() ? markdownFiles(r, nested) : [r]));
  for (const file of files) {
    const rel = relative(repo, file);
    for (const { link, line } of links(readFileSync(file, "utf8"))) {
      if (external(link) || /[{}$]/.test(link)) continue;
      const [rawPath, anchor] = link.split("#", 2) as [string, string | undefined];
      if (rawPath === "") {
        if (anchor && !anchors(file).has(decodeURIComponent(anchor).toLowerCase()))
          findings.push({ file: rel, line, link, severity: "error", message: `anchor #${anchor} not found in this file` });
        continue;
      }
      if (rawPath.startsWith("/")) continue; // site-absolute: served by an app, not a file of the repo
      let path: string;
      try {
        path = decodeURIComponent(rawPath.replace(/\?.*$/, ""));
      } catch {
        path = rawPath;
      }
      const target = resolve(dirname(file), path);
      const inside = target === repo || target.startsWith(repo + sep);
      if (!existsSync(target)) {
        if (inside) findings.push({ file: rel, line, link, severity: "error", message: "target does not exist" });
        else if (host && target.startsWith(host + sep)) findings.push({ file: rel, line, link, severity: "error", message: `target missing from the host checkout ${host}` });
        else findings.push({ file: rel, line, link, severity: "warn", message: "host target outside this repository (no host checkout)" });
        continue;
      }
      if (anchor && target.endsWith(".md") && statSync(target).isFile() && !anchors(target).has(decodeURIComponent(anchor).toLowerCase()))
        findings.push({ file: rel, line, link, severity: "error", message: `anchor #${anchor} not found in ${relative(repo, target)}` });
    }
  }
  return findings;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
  const findings = checkLinks(REPO, paths.length ? paths : [REPO]);
  const errors = findings.filter((f) => f.severity === "error");
  if (args.includes("--json")) console.log(JSON.stringify({ errors: errors.length, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.file}:${f.line} ${f.link} (${f.message})`);
    console.log(`check-links: ${errors.length} errors, ${findings.length - errors.length} warnings`);
  }
  process.exit(errors.length ? 1 : 0);
}
