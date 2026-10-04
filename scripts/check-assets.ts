#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// check-assets.ts: every asset referenced by code, styles, HTML, Tauri configs and docs exists, and
// every app ships its icons.
//
//   bun scripts/check-assets.ts [--json] [path..]
//
// References checked (relative ones; URLs, data:, fragments, template expressions and site-absolute
// `/x` paths served by an app are not files of this repository):
//   code   import specifiers with an asset extension (`./logo.svg?url`), `new URL("./x", import.meta.url)`
//   css    `url(...)` and relative `@import`
//   html   `src` / `href` of local files
//   json   `bundle.icon[]` and a relative `$schema` of tauri.conf.json, `icons[].src` of web manifests
//   md     image targets `![..](path)`
// A reference that leaves this repository is a host reference: it must exist in the enclosing checkout
// (aphrody, when this repository is its design/aphrody-m3 submodule); without one it is reported as a
// warning, since the standalone checkout cannot hold host assets.
// Apps: every apps/* web entry declares a favicon; every Tauri config lists bundle icons that exist,
// including the .ico and .icns desktop formats. Nested repositories (packages/nie-ui) own their gates.
// Generated outputs are rebuilt, not checked: dist/, node_modules/, the fonts/upstream sync target.
// Exit 1 on any error.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");

export interface Finding {
  file: string;
  ref: string;
  severity: "error" | "warn";
  message: string;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "target", ".next", ".turbo", "coverage", "upstream", "forks"]);
const ASSET_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|icns|bmp|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|lottie|riv|wasm|glb|gltf|hdr|ktx2|css|scss)$/i;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const ts = new Bun.Transpiler({ loader: "ts" });
const tsx = new Bun.Transpiler({ loader: "tsx" });

/** The checkout that contains this repository as a submodule, if any (holds host assets). */
export function hostRoot(repo = REPO): string | undefined {
  for (let dir = dirname(repo); dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "package.json"))) return dir;
  }
  return undefined;
}

/** Nested repositories (git submodules checked out inside packages/). */
export function nestedRepos(repo = REPO): string[] {
  const base = join(repo, "packages");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((d) => join(base, d))
    .filter((d) => existsSync(join(d, ".git")));
}

function walk(dir: string, out: string[], skip: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (skip.some((s) => path === s || path.startsWith(s + sep))) continue;
    if (entry.isDirectory()) walk(path, out, skip);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** Whether `ref` names a file of this repository (relative path, not a URL or expression). */
export function isLocalRef(ref: string): boolean {
  if (!ref || ref.startsWith("#") || ref.startsWith("%23") || ref.startsWith("/") || ref.startsWith("~")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) return false; // http:, data:, mailto:, m3:, bun:
  if (/[{}$`<>*]|\$\{/.test(ref)) return false; // template expressions and globs
  return ref.startsWith("./") || ref.startsWith("../") || !ref.includes(":");
}

const strip = (ref: string) => decodeURI(ref.replace(/[?#].*$/, ""));

/** References of one file: [ref, kind]. */
export function references(file: string, text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const ext = extname(file).toLowerCase();
  const add = (ref: string | undefined, kind: string) => {
    if (ref !== undefined) out.push([ref.trim(), kind]);
  };
  if (CODE.test(file)) {
    let imports: string[] = [];
    try {
      imports = (/\.[cm]?tsx$|\.jsx$/.test(file) ? tsx : ts).scanImports(text).map((i) => i.path);
    } catch {
      // a file the transpiler rejects is reported by the typecheck gate
    }
    for (const spec of imports) if (ASSET_EXT.test(strip(spec)) && spec.startsWith(".")) add(spec, "import");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const m of code.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) add(m[1], "url");
  } else if (ext === ".css" || ext === ".scss") {
    // `url()` inside an inline SVG data URI (`filter="url(%23n)"`) is part of that document.
    const css = text.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) add(m[1], "css-url");
    for (const m of text.matchAll(/@import\s+["'](\.[^"']+)["']/g)) add(m[1], "css-import");
  } else if (ext === ".html") {
    for (const m of text.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/g)) if (!/^\w+$/.test(m[1]!)) add(m[1], "html");
  } else if (ext === ".json" || ext === ".webmanifest") {
    if (/tauri\.conf\.json$|tauri\.[a-z]+\.conf\.json$/.test(file)) {
      try {
        const conf = JSON.parse(text);
        for (const icon of conf?.bundle?.icon ?? []) add(icon, "tauri-icon");
        if (typeof conf?.$schema === "string") add(conf.$schema, "schema");
      } catch {
        // invalid JSON is the business of the JSON linters
      }
    } else if (ext === ".webmanifest" || file.endsWith("manifest.json")) {
      try {
        for (const icon of JSON.parse(text)?.icons ?? []) add(icon?.src, "manifest-icon");
      } catch {
        // not a manifest
      }
    }
  } else if (ext === ".md") {
    const body = text.replace(/```[\s\S]*?```/g, "");
    for (const m of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1], "md-image");
  }
  return out;
}

/** Check every reference under `roots` (default: the whole repository). */
export function checkAssets(repo = REPO, roots: string[] = [repo]): Finding[] {
  const host = hostRoot(repo);
  const nested = nestedRepos(repo);
  const findings: Finding[] = [];
  const files = roots.flatMap((r) => (statSync(r).isDirectory() ? walk(r, [], nested) : [r]));
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|css|scss|html|json|webmanifest|md)$/.test(file) || file.endsWith(".d.ts")) continue;
    if (/(?:^|[\\/])(?:test|tests|__tests__)[\\/]fixtures[\\/]|__testfixtures__/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const [ref, kind] of references(file, text)) {
      if (!isLocalRef(ref)) continue;
      const target = resolve(dirname(file), strip(ref));
      const rel = relative(repo, file);
      if (existsSync(target)) continue;
      const inside = target === repo || target.startsWith(repo + sep);
      if (inside) {
        findings.push({ file: rel, ref, severity: "error", message: `${kind} ${ref} does not exist` });
      } else if (host && (target === host || target.startsWith(host + sep))) {
        findings.push({ file: rel, ref, severity: "error", message: `${kind} ${ref} is missing from the host checkout ${host}` });
      } else {
        findings.push({ file: rel, ref, severity: "warn", message: `${kind} ${ref} is a host asset outside this repository (no host checkout)` });
      }
    }
  }
  return findings;
}

/** Icons every app must ship: a favicon per web app, desktop formats per Tauri config. */
export function checkAppIcons(repo = REPO): Finding[] {
  const findings: Finding[] = [];
  const apps = join(repo, "apps");
  for (const name of existsSync(apps) ? readdirSync(apps) : []) {
    const dir = join(apps, name);
    if (!existsSync(join(dir, "package.json"))) continue;
    const html = walk(dir, [], []).filter((f) => f.endsWith("index.html"));
    if (html.length === 0) continue;
    for (const file of html) {
      const text = readFileSync(file, "utf8");
      const icon = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i.exec(text);
      if (!icon) findings.push({ file: relative(repo, file), ref: "", severity: "error", message: "web app entry declares no favicon (<link rel=\"icon\">)" });
    }
  }
  for (const file of walk(repo, [], nestedRepos(repo)).filter((f) => f.endsWith("tauri.conf.json"))) {
    const conf = JSON.parse(readFileSync(file, "utf8"));
    const icons: string[] = conf?.bundle?.icon ?? [];
    const rel = relative(repo, file);
    if (icons.length === 0) {
      findings.push({ file: rel, ref: "", severity: "error", message: "Tauri config lists no bundle.icon" });
      continue;
    }
    for (const fmt of [".ico", ".icns", ".png"]) {
      if (!icons.some((i) => i.endsWith(fmt))) findings.push({ file: rel, ref: "", severity: "error", message: `bundle.icon has no ${fmt} icon` });
    }
  }
  return findings;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const paths = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
  const findings = [...checkAssets(REPO, paths.length ? paths : [REPO]), ...(paths.length ? [] : checkAppIcons(REPO))];
  const errors = findings.filter((f) => f.severity === "error");
  if (args.includes("--json")) console.log(JSON.stringify({ host: hostRoot() ?? null, errors: errors.length, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.file}: ${f.message}`);
    console.log(`check-assets: ${errors.length} errors, ${findings.length - errors.length} warnings (host: ${hostRoot() ?? "none"})`);
  }
  process.exit(errors.length ? 1 : 0);
}
