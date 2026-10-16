#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Makes every workspace crate publishable on crates.io (PLAN §8): drops `publish = false`, inherits repository and
// license from the workspace (forks keep their upstream licence), derives a missing description from the crate's
// first `//!` line, and gives path dependencies the version of their target.
//
//   bun scripts/release/crates-io-prepare.ts [--apply]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../docs/aphrody");
// [patch.crates-io] overlays keep upstream names and are never published.
const SKIP = [/^crates\/native\/simdutf$/];

interface Meta {
  packages: {
    name: string;
    version: string;
    manifest_path: string;
    license: string | null;
    license_file: string | null;
    description: string | null;
    repository: string | null;
    publish: string[] | null;
  }[];
}

/** Upstream licence of forks whose manifest has none. */
export function forkLicense(dir: string): string {
  if (dir.startsWith("crates/tauri/")) return "Apache-2.0 OR MIT";
  return "";
}

/** First `//!` sentence of a crate root, without markdown decoration. */
export function docDescription(source: string): string | undefined {
  for (const line of source.split("\n")) {
    const m = /^\s*\/\/!\s?(.*)$/.exec(line);
    if (!m) {
      if (line.trim() === "" || line.startsWith("#![") || line.startsWith("// ")) continue;
      break;
    }
    const text = m[1]!.replace(/[`*_#]/g, "").trim();
    if (text) return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }
  return undefined;
}

/** Adds `version` to inline path dependencies that lack one. */
export function versionPathDeps(
  toml: string,
  versionOf: (path: string) => string | undefined,
): string {
  return toml.replace(
    /^(\s*[\w-]+\s*=\s*\{)([^}\n]*\bpath\s*=\s*"([^"]+)"[^}\n]*)\}/gm,
    (all, head: string, body: string, path: string) => {
      if (/\bversion\s*=/.test(body) || /\bworkspace\s*=\s*true/.test(body)) return all;
      const version = versionOf(path);
      return version ? `${head}${body.replace(/\s*$/, "")}, version = "${version}" }` : all;
    },
  );
}

/** Inserts `key` into the [package] table right after its `name`. */
function addPackageKey(toml: string, line: string): string {
  return toml.replace(/^(\[package\][^[]*?^name\s*=\s*"[^"]*"\s*$)/m, `$1\n${line}`);
}

if (import.meta.main) {
  const apply = Bun.argv.includes("--apply");
  const meta: Meta = JSON.parse(
    Bun.spawnSync(["cargo", "metadata", "--format-version", "1", "--no-deps", "--offline"], {
      windowsHide: true,
      cwd: ROOT,
      stdout: "pipe",
    }).stdout.toString(),
  );
  const versionByDir = new Map(meta.packages.map((p) => [dirname(p.manifest_path), p.version]));
  const counts = {
    publish: 0,
    repository: 0,
    license: 0,
    description: 0,
    pathVersions: 0,
    files: 0,
  };
  for (const p of meta.packages) {
    const dir = relative(ROOT, dirname(p.manifest_path));
    if (SKIP.some((r) => r.test(dir))) continue;
    const original = readFileSync(p.manifest_path, "utf8");
    let toml = original;
    if (/^publish\s*=\s*false\b.*$/m.test(toml)) {
      toml = toml.replace(/^publish\s*=\s*false\b.*\n/m, "");
      counts.publish++;
    }
    if (!p.repository) {
      toml = addPackageKey(toml, "repository.workspace = true");
      counts.repository++;
    }
    if (!p.license && !p.license_file) {
      const fork = forkLicense(dir);
      toml = addPackageKey(toml, fork ? `license = "${fork}"` : "license.workspace = true");
      counts.license++;
    }
    if (!p.description) {
      const rootFile = ["src/lib.rs", "src/main.rs", "lib.rs"]
        .map((f) => join(dirname(p.manifest_path), f))
        .find(existsSync);
      const doc = rootFile ? docDescription(readFileSync(rootFile, "utf8")) : undefined;
      toml = addPackageKey(
        toml,
        `description = ${JSON.stringify(doc ?? `Aphrody platform crate ${p.name}.`)}`,
      );
      counts.description++;
    }
    const before = toml;
    toml = versionPathDeps(toml, (path) =>
      versionByDir.get(resolve(dirname(p.manifest_path), path)),
    );
    if (toml !== before) counts.pathVersions++;
    if (toml !== original) {
      counts.files++;
      if (apply) writeFileSync(p.manifest_path, toml);
    }
  }
  console.log(`${apply ? "applied" : "plan"}: ${JSON.stringify(counts)}`);
}
