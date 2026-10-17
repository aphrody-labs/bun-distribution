// SPDX-License-Identifier: Apache-2.0
/** Installs the merged RE toolkit into Claude: steam + replica skills (user skills) and MCP servers. */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const skillsDir = join(homedir(), ".claude", "skills");
const sources: [string, string][] = [["steam-re", join(root, "packages/re/plugin/skills/steam")]];
for (const [name, rel] of [
  ["steamcmd", "vendor/steam/steam-claude-skills/steamcmd"],
  ["steamos-maintenance", "vendor/steam/steamos-claude-skill"],
  ["idapython", "vendor/re/ida-pro-mcp/skills/idapython"],
] as const)
  if (existsSync(join(root, rel, "SKILL.md"))) sources.push([name, join(root, rel)]);
const replica = join(root, "packages/re/replica");
for (const d of readdirSync(replica, { withFileTypes: true }))
  if (d.isDirectory() && existsSync(join(replica, d.name, "SKILL.md")))
    sources.push([d.name, join(replica, d.name)]);

mkdirSync(skillsDir, { recursive: true });
for (const [name, src] of sources) {
  const dest = join(skillsDir, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

const target = process.env.CARGO_TARGET_DIR ?? join(process.env.LOCALAPPDATA ?? "", "Aphrody", "cache", "cargo-target");
const exe = (n: string) => join(target, "release", `${n}${process.platform === "win32" ? ".exe" : ""}`);
const servers: [string, string[]][] = [
  ["steam", ["bun", join(root, "packages/re/src/steam/mcp-server.ts")]],
];
if (existsSync(exe("aphrody-nie-mcp"))) servers.push(["nie", [exe("aphrody-nie-mcp")]]);
for (const [name, cmd] of servers) {
  await Bun.$`claude mcp remove -s user ${name}`.quiet().nothrow();
  await Bun.$`claude mcp add -s user ${name} -- ${cmd}`.quiet();
}
console.log(`skills: ${sources.map((s) => s[0]).join(", ")}\nmcp: ${servers.map((s) => s[0]).join(", ")}`);
