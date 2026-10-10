// SPDX-License-Identifier: Apache-2.0
/**
 * Icon and version resources of a Windows exe compiled by `bun build --compile`, shared by every kit
 * (publish-creator.ts, stage-omar-kit.ts). `bun build --windows-icon` only works when compiling on Windows, so from
 * Linux the pinned rcedit (MIT, electron/rcedit) edits the PE resources under Wine. No code signing: the repository
 * defines no signing key for these binaries.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const RCEDIT = {
  url: "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe",
  sha256: "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a",
};

export interface ExeBranding {
  /** Path of the .ico. */
  icon: string;
  /** Four-part file and product version, e.g. `0.1.0.0`. */
  version: string;
  /** ProductName, FileDescription, CompanyName, LegalCopyright, OriginalFilename, InternalName... */
  strings: Record<string, string>;
  /** Folder holding the pinned rcedit and the Wine prefix (default: ~/.cache/creator-kit, kept for the cache already there). */
  cacheDir?: string;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function run(argv: string[], env: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(argv, {
    windowsHide: true,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`${argv.slice(0, 4).join(" ")} failed (${code}):\n${stderr || stdout}`);
}

async function ensureRcedit(cache: string): Promise<string> {
  const rcedit = join(cache, "rcedit-x64.exe");
  const cached = existsSync(rcedit)
    ? new Uint8Array(await Bun.file(rcedit).arrayBuffer())
    : undefined;
  if (cached && sha256Hex(cached) === RCEDIT.sha256) return rcedit;
  const res = await fetch(RCEDIT.url);
  if (!res.ok) throw new Error(`rcedit download: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (sha256Hex(bytes) !== RCEDIT.sha256) throw new Error("rcedit: SHA-256 mismatch");
  await mkdir(cache, { recursive: true });
  await writeFile(rcedit, bytes);
  return rcedit;
}

export async function brandExe(exe: string, branding: ExeBranding): Promise<void> {
  const cache = branding.cacheDir ?? join(homedir(), ".cache/creator-kit");
  const rcedit = await ensureRcedit(cache);
  const args = [
    rcedit,
    exe,
    "--set-icon",
    branding.icon,
    "--set-file-version",
    branding.version,
    "--set-product-version",
    branding.version,
  ];
  for (const [key, value] of Object.entries(branding.strings))
    args.push("--set-version-string", key, value);
  const runner = process.platform === "win32" ? args : ["wine", ...args];
  await run(runner, { WINEDEBUG: "-all", WINEPREFIX: join(cache, "wine") });
}
