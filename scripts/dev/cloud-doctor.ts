// SPDX-License-Identifier: Apache-2.0
// Native/cloud readiness check: one line per item, fail missing or mismatched requirements.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const standalone =
  process.argv.includes("--standalone") ||
  process.argv.includes("--cloud-only") ||
  process.env.APHRODY_STANDALONE === "1" ||
  process.env.CLAUDE_CODE_REMOTE === "true" ||
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true";

const out = (cmd: string[]): string | null => {
  try {
    const r = Bun.spawnSync(cmd, { windowsHide: true, cwd: root, stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? (r.stdout.toString().trim().split("\n")[0] ?? null) : null;
  } catch {
    return null;
  }
};
const pin = /"packageManager":\s*"bun@([^"]+)"/.exec(
  readFileSync(join(root, "package.json"), "utf8"),
)?.[1];
const sshConfig = existsSync(join(home, ".ssh/config"))
  ? readFileSync(join(home, ".ssh/config"), "utf8")
  : "";
const bunVersion = out([process.execPath, "--version"]);
const dispatcher = (): string | null => {
  try {
    return existsSync(Bun.resolveSync("@aphrody/yolo-cli/cli", import.meta.dir))
      ? "package available (run via bun)"
      : null;
  } catch {
    return null;
  }
};
const checks: [name: string, value: string | null, required: boolean, qualified?: boolean][] = [
  [
    "bun",
    bunVersion === pin ? pin! : bunVersion && `${bunVersion} (pin ${pin})`,
    true,
    bunVersion === pin,
  ],
  ["rustc", out(["rustc", "--version"]), true],
  ["cargo", out(["cargo", "--version"]), true],
  ["uv", out([process.execPath, "uv", "--version"]), true],
  ["aphrody", out(["aphrody", "--version"]), false],
  ["yolo", out(["yolo", "--version"]) ?? dispatcher(), false],
  [
    "git push remote",
    out(["git", "remote", "get-url", "--push", "workspace"]) ??
      out(["git", "remote", "get-url", "--push", "origin"]),
    true,
  ],
];

const aphrodyHome = process.env.APHRODY_HOME ?? join(home, ".aphrody");
const agentHomeReady = existsSync(join(aphrodyHome, "workspaces/aphrody/AGENTS.md"));
checks.push([
  "agent home (~/.aphrody)",
  agentHomeReady
    ? "initialized"
    : "uninitialized (run bun scripts/dev/cloud-agent-home.ts --apply)",
  false,
  agentHomeReady,
]);

for (const alias of ["vps", "dbfr"]) {
  if (!new RegExp(`^Host ${alias}$`, "m").test(sshConfig)) {
    checks.push([
      `ssh ${alias}`,
      standalone ? "not configured (optional in standalone cloud)" : null,
      !standalone,
      false,
    ]);
    continue;
  }
  const ok =
    Bun.spawnSync(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", alias, "true"], {
      windowsHide: true,
    }).exitCode === 0;
  checks.push([`ssh ${alias}`, ok ? "reachable" : null, !standalone]);
}
let failed = 0;
for (const [name, value, required, qualified = true] of checks) {
  const ok = qualified && value !== null && value !== "";
  if (!ok && required) failed++;
  console.log(`${ok ? "ok  " : required ? "FAIL" : "warn"} ${name}: ${value ?? "missing"}`);
}
process.exit(failed ? 1 : 0);
