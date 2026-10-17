#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Read-only live inventory of the local OpenAI desktop install (the `OpenAI.Codex` MSIX) and its
 * user roots, through a private hidden Aphrody OS kernel: metadata, hashes and structural
 * classification only, never secret or user content.
 *
 * Usage: bun scripts/tools/os/scripts/live-openai-inventory.ts [--artifact-root var/winclean-live/openai]
 * Output: manifest.json, file-map.json, binary-analysis.json, asar-map.json, system-profile.json,
 * os-info.json and yolo-status.json in <artifact-root>/<stamp> and <artifact-root>/latest.
 */
import { readdir, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import {
  artifactDirs,
  type Json,
  parseOptions,
  repoRoot,
  sessionStamp,
  withKernel,
  writeArtifacts,
} from "./kernel-session.ts";
import { findMsixPackage } from "./msix.ts";

const SENSITIVE = /(token|secret|cookie|credential|password|passwd|auth|private[-_]?key|\.env($|\.))/i;
const KINDS: Array<[string, Set<string>]> = [
  ["binary", new Set([".exe", ".dll", ".sys", ".node", ".msi", ".appx"])],
  ["archive", new Set([".asar", ".zip", ".7z", ".pak"])],
  ["database-metadata-only", new Set([".db", ".sqlite", ".sqlite3", ".wal", ".shm"])],
  ["configuration-metadata-only", new Set([".json", ".jsonl", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf"])],
  ["application-source", new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".html"])],
  ["asset", new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp"])],
];
const PE_EXTENSIONS = new Set([".exe", ".dll", ".sys"]);
const MAX_HASH_BYTES = 1024 ** 3;

/** Classification of one file; sensitive names never get more than metadata. */
export function classify(path: string, rootKind: string): string {
  if (SENSITIVE.test(path)) return "sensitive-metadata-only";
  const extension = extname(path).toLowerCase();
  for (const [kind, extensions] of KINDS) if (extensions.has(extension)) return kind;
  return rootKind.startsWith("msix-") ? "application-data" : "user-data-metadata-only";
}

/** Every regular file under `base`, without following links; unreadable entries are skipped. */
async function walk(base: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [base];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2), ["artifact-root"]);
  if (options.has("help")) {
    console.log(
      "Usage: bun scripts/tools/os/scripts/live-openai-inventory.ts [--artifact-root var/winclean-live/openai]",
    );
    return 0;
  }
  const pkg = findMsixPackage("OpenAI.Codex");
  if (!pkg) throw new Error("OpenAI.Codex MSIX package not installed.");
  const installRoot = resolve(pkg.installLocation);
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const appData = process.env.APPDATA ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const userRoots = [
    { kind: "user-appdata", path: join(appData, "OpenAI") },
    { kind: "user-local", path: join(localAppData, "OpenAI") },
    {
      kind: "msix-localcache",
      path: join(localAppData, "Packages", pkg.family, "LocalCache"),
    },
    {
      kind: "msix-localstate",
      path: join(localAppData, "Packages", pkg.family, "LocalState"),
    },
    { kind: "codex-home", path: join(home, ".codex") },
    { kind: "chatgpt-home", path: join(home, ".chatgpt") },
  ].filter(root => existsSync(root.path) && statSync(root.path).isDirectory());
  const scanRoots = [{ kind: "msix-install", path: installRoot }, ...userRoots];

  const stamp = sessionStamp();
  const dirs = artifactDirs(options.get("artifact-root") ?? "var/winclean-live/openai", stamp);
  return withKernel("openai-inventory", stamp, async kernel => {
    const yolo = Bun.spawnSync(
      [kernel.aphrody, "yolo", "--root", repoRoot, "--socket", kernel.endpoint, "--json", "win", "status"],
      { windowsHide: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    const yoloText = yolo.stdout.toString().trim();
    let yoloStatus: Json;
    try {
      yoloStatus = JSON.parse(yoloText) as Json;
    } catch {
      yoloStatus = yoloText
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as Json);
    }

    const records: Array<Record<string, Json>> = [];
    const binaries: Json[] = [];
    for (const root of scanRoots) {
      const base = resolve(root.path);
      for (const path of await walk(base)) {
        const info = await stat(path).catch(() => undefined);
        if (!info) continue;
        const classification = classify(path, root.kind);
        const sensitive = classification === "sensitive-metadata-only";
        const extension = extname(path).toLowerCase();
        records.push({
          path,
          rootKind: root.kind,
          relativePath: relative(base, path),
          extension,
          bytes: info.size,
          lastWriteTimeUtc: info.mtime.toISOString(),
          classification,
          sensitive,
        });
        if (classification === "binary" && !sensitive && info.size <= MAX_HASH_BYTES) {
          const hash = await kernel.tryCall("binary_hash_multi", { path });
          const pe = PE_EXTENSIONS.has(extension) ? await kernel.tryCall("binary_parse_pe_header", { path }) : null;
          binaries.push({ path, bytes: info.size, hash, pe });
        }
      }
    }

    const asarPath = join(installRoot, "app", "resources", "app.asar");
    const asar = existsSync(asarPath)
      ? await kernel.call("asar_list", { path: asarPath })
      : { success: false, error: "app.asar not found" };
    const asarPayload = ((asar as Record<string, Json>).structuredContent ?? asar) as Record<string, Json>;
    const profile = await kernel.call("get_system_profile");
    const os = await kernel.call("get_os_info");
    const sensitiveCount = records.filter(record => record.sensitive).length;
    const asarFiles = typeof asarPayload.totalFiles === "number" ? asarPayload.totalFiles : 0;
    const manifest = {
      schema: "aphrody.openai.local.inventory.v1",
      status: "verified-live-read-only",
      session: stamp,
      package: {
        name: pkg.name,
        version: pkg.version,
        family: pkg.family,
        installRoot,
      },
      roots: scanRoots,
      counts: {
        files: records.length,
        binaries: binaries.length,
        sensitiveMetadataOnly: sensitiveCount,
        asarFiles,
      },
      policy: "metadata, hashes and structural classification only; no secret or user-content extraction",
      consumers: ["aphrody-re", "codex", "gui-electron"],
      artifacts: [
        "manifest.json",
        "file-map.json",
        "binary-analysis.json",
        "asar-map.json",
        "system-profile.json",
        "os-info.json",
        "yolo-status.json",
      ],
    };
    writeArtifacts(dirs, {
      "manifest.json": manifest,
      "file-map.json": records,
      "binary-analysis.json": binaries,
      "asar-map.json": asar,
      "system-profile.json": profile,
      "os-info.json": os,
      "yolo-status.json": yoloStatus,
    });
    console.log(
      JSON.stringify({
        status: manifest.status,
        session: stamp,
        latest: dirs.latest,
        files: records.length,
        binaries: binaries.length,
        asarFiles,
        sensitiveMetadataOnly: sensitiveCount,
      }),
    );
    return 0;
  });
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
