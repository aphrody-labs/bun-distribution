// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { KitPaths } from "./paths.ts";
import type { System } from "./system.ts";

export type ToolName =
  | "git"
  | "wireguard"
  | "ssh"
  | "sshKeygen"
  | "aphrody-mcp"
  | "aphrody"
  | "claude"
  | "winget";

/**
 * Installed tools are looked up on PATH first, then in their usual folders: right after `winget install` the PATH of the
 * running process is stale, so the usual folders are what finds Git or WireGuard in the same session.
 */
export function findTool(
  sys: System,
  paths: KitPaths,
  name: ToolName,
): string | undefined {
  const systemRoot = sys.env.SystemRoot ?? "C:\\Windows";
  const candidates: Record<ToolName, string[]> = {
    git: [
      join(paths.programFiles, "Git", "cmd", "git.exe"),
      join(paths.localAppData, "Programs", "Git", "cmd", "git.exe"),
    ],
    wireguard: [join(paths.programFiles, "WireGuard", "wireguard.exe")],
    ssh: [join(systemRoot, "System32", "OpenSSH", "ssh.exe")],
    sshKeygen: [join(systemRoot, "System32", "OpenSSH", "ssh-keygen.exe")],
    "aphrody-mcp": [join(paths.home, ".local", "bin", "aphrody-mcp.exe")],
    aphrody: [
      join(paths.home, ".local", "bin", "aphrody.exe"),
      ...latestAphrodyBuilds(paths),
    ],
    claude: [
      join(paths.home, ".local", "bin", "claude.exe"),
      join(paths.appData, "npm", "claude.cmd"),
    ],
    winget: [
      join(paths.localAppData, "Microsoft", "WindowsApps", "winget.exe"),
    ],
  };
  const lookup: Record<ToolName, string> = {
    git: "git",
    wireguard: "wireguard",
    ssh: "ssh",
    sshKeygen: "ssh-keygen",
    "aphrody-mcp": "aphrody-mcp",
    aphrody: "aphrody",
    claude: "claude",
    winget: "winget",
  };
  const onPath = sys.which(lookup[name]);
  if (onPath) return onPath;
  return candidates[name].find((candidate) => existsSync(candidate));
}

/** `%USERPROFILE%\.local\lib\aphrody\<release>\aphrody.exe`, newest first (what the public installer lays down). */
function latestAphrodyBuilds(paths: KitPaths): string[] {
  const base = join(paths.home, ".local", "lib", "aphrody");
  try {
    return readdirSync(base)
      .map((release) => ({
        release,
        mtime: statSync(join(base, release)).mtimeMs,
      }))
      .toSorted((a, b) => b.mtime - a.mtime)
      .map((entry) => join(base, entry.release, "aphrody.exe"));
  } catch {
    return [];
  }
}

/** First dotted version in a `--version` output (`aphrody 1.0.0-canary (abc)` gives 1.0.0). */
export function parseVersion(output: string): string | undefined {
  return /\b(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
}

export async function toolVersion(
  sys: System,
  exe: string,
): Promise<string | undefined> {
  const result = await sys.run([exe, "--version"], { timeoutMs: 20_000 });
  return result.code === 0
    ? parseVersion(`${result.stdout} ${result.stderr}`)
    : undefined;
}
