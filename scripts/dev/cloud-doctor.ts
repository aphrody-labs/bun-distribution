// SPDX-License-Identifier: Apache-2.0
// Cloud/WSL readiness check: one line per item, exit 1 when a required item is missing.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const home = process.env.HOME ?? "";
const out = (cmd: string[]) => {
  try {
    const r = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? r.stdout.toString().trim().split("\n")[0] : null;
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
const checks: [name: string, value: string | null, required: boolean][] = [
  [
    "bun",
    out(["bun", "--version"]) === pin
      ? pin!
      : out(["bun", "--version"]) && `${out(["bun", "--version"])} (pin ${pin})`,
    true,
  ],
  ["rustc", out(["rustc", "--version"]), true],
  ["cargo", out(["cargo", "--version"]), true],
  ["uv", out(["uv", "--version"]), true],
  ["aphrody", out(["aphrody", "--version"]), false],
  ["yolo", out(["yolo", "--version"]), false],
  [
    "git push remote",
    out(["git", "remote", "get-url", "--push", "workspace"]) ??
      out(["git", "remote", "get-url", "--push", "origin"]),
    true,
  ],
];
for (const alias of ["vps", "dbfr", "wsl"]) {
  if (!new RegExp(`^Host ${alias}$`, "m").test(sshConfig)) {
    checks.push([
      `ssh ${alias}`,
      alias === "wsl" ? "not configured (optional)" : null,
      alias !== "wsl",
    ]);
    continue;
  }
  const ok =
    Bun.spawnSync(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", alias, "true"])
      .exitCode === 0;
  checks.push([`ssh ${alias}`, ok ? "reachable" : null, true]);
}
let failed = 0;
for (const [name, value, required] of checks) {
  const ok = value !== null && value !== "";
  if (!ok && required) failed++;
  console.log(`${ok ? "ok  " : required ? "FAIL" : "warn"} ${name}: ${value ?? "missing"}`);
}
process.exit(failed ? 1 : 0);
