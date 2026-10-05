#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Aggressive first-party dependency dedup: rewrite crates that pin an explicit
// version of a dep already in [workspace.dependencies] to inherit the single
// workspace pin (`workspace = true`), preserving features/default-features/optional.
// This collapses our own version divergence onto the highest version we chose at
// the workspace. It does NOT touch third-party transitive requirements.
//
//   bun scripts/tools/dedup-workspace-deps.ts [--apply] [--domain crates/web]
// Dry-run by default (prints what would change + any risky local>workspace pins).
import { Glob } from "bun";

// The FSL drive tree is a SEPARATE nested Cargo workspace: its members inherit
// *its* [workspace.dependencies], not the root's, so root inheritance is invalid
// there. *-sys crates pin for native ABI. Everything else — the Tauri fork
// included — is fair game: the user assumes the right to diverge from upstream.
const DENY_PATH = [/^crates\/os\/drive\//, /^crates\/ui\/drive\//];
const DENY_NAME = [/-sys$/];

const root = await Bun.file("Cargo.toml").text();
const wdBlock = root.slice(root.indexOf("[workspace.dependencies]"));
const wsVersion = new Map<string, string>();
for (const line of wdBlock.split("\n")) {
  if (line.trim().startsWith("[") && !line.includes("workspace.dependencies")) break;
  const m = line.match(/^([a-z0-9_-]+)\s*=\s*(?:\{[^}]*\bversion\s*=\s*)?"=?([0-9][0-9.]*)"/i);
  if (m) wsVersion.set(m[1], m[2]);
}

const apply = process.argv.includes("--apply");
const domainArg = process.argv.find((a, i) => process.argv[i - 1] === "--domain");

const major = (v: string) =>
  v.startsWith("0.") ? v.split(".").slice(0, 2).join(".") : v.split(".")[0];
let changed = 0;
let risky = 0;
const touchedFiles = new Set<string>();

for await (const rel of new Glob("crates/**/Cargo.toml").scan(".")) {
  if (DENY_PATH.some((re) => re.test(rel))) continue;
  if (domainArg && !rel.startsWith(domainArg)) continue;
  const text = await Bun.file(rel).text();
  const lines = text.split("\n");
  let fileChanged = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)([a-z0-9_-]+)\s*=\s*(\{.*\}|"[^"]*")\s*$/i);
    if (!m) continue;
    const [, indent, name, rhs] = m;
    if (!wsVersion.has(name) || DENY_NAME.some((re) => re.test(name))) continue;
    if (/workspace\s*=\s*true/.test(rhs)) continue;
    const verM = rhs.match(/version\s*=\s*"=?([0-9][0-9.]*)"|^"=?([0-9][0-9.]*)"$/);
    const localVer = verM?.[1] ?? verM?.[2];
    if (!localVer) continue; // git/path dep, leave it
    const wsVer = wsVersion.get(name)!;
    // Preserve features / optional from the local table. `default-features = false`
    // CANNOT be set on an inheriting member — Cargo rejects it (it must live on the
    // [workspace.dependencies] entry). A member that disables default features has
    // different semantics from the workspace pin, so leave it explicit.
    const feats = rhs.match(/features\s*=\s*(\[[^\]]*\])/)?.[1];
    const defFalse = /default-features\s*=\s*false/.test(rhs);
    const optional = /optional\s*=\s*true/.test(rhs);
    if (defFalse) continue; // not safely inheritable; keep the explicit pin
    const parts = ["workspace = true"];
    if (optional) parts.push("optional = true");
    if (feats) parts.push(`features = ${feats}`);
    const repl = `${indent}${name} = { ${parts.join(", ")} }`;
    if (major(localVer) !== major(wsVer)) {
      risky++;
      console.log(`RISKY ${rel}: ${name} local=${localVer} ws=${wsVer} (major differs — SKIPPED)`);
      continue; // never silently change a major; leave it for manual review
    }
    if (apply) lines[i] = repl;
    fileChanged = true;
    changed++;
  }
  if (fileChanged) {
    touchedFiles.add(rel);
    if (apply) await Bun.write(rel, lines.join("\n"));
  }
}

console.log(
  `\n${apply ? "APPLIED" : "DRY-RUN"}: ${changed} dep sites -> workspace inheritance across ${touchedFiles.size} files; ${risky} risky (major differs) skipped.`,
);
