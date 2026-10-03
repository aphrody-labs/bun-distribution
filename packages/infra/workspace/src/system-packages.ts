// SPDX-License-Identifier: Apache-2.0
/** Host prerequisites from config/system-packages.json: one plan/apply for apt (Linux, WSL) and winget (Windows). */
import { join, resolve } from "node:path";
import { infraRoot } from "./runtime.ts";

export type PackageHost = "linux" | "windows";
export interface WingetPackage {
  id: string;
  override?: string;
}
export interface Installer {
  name: string;
  check: string;
  url: string;
  args: string[];
}
export interface PackageEntry {
  manager: "apt" | "winget" | "installer";
  id: string;
  state: "installed" | "missing";
}
export interface PackagePlan {
  schemaVersion: 1;
  host: PackageHost;
  profile: string | null;
  entries: PackageEntry[];
  missing: number;
}
/** Runs a command and returns its exit code and stdout; replaced by a fake in tests. */
export type Runner = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>;

export const run: Runner = async (argv) => {
  try {
    const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { exitCode, stdout };
  } catch {
    return { exitCode: 127, stdout: "" };
  }
};

/** powershell.exe on Windows, or through WSL interop even when Windows is not on PATH. */
export async function powershell(runner: Runner = run): Promise<string[] | null> {
  if (process.platform === "win32") return ["powershell.exe", "-NoProfile", "-Command"];
  if (process.platform !== "linux") return null;
  const onPath = await runner(["sh", "-c", "command -v powershell.exe"]);
  if (onPath.exitCode === 0) return ["powershell.exe", "-NoProfile", "-Command"];
  const system32 = await runner(["wslpath", "-u", String.raw`C:\Windows\System32`]);
  if (system32.exitCode !== 0) return null;
  return [
    join(system32.stdout.trim(), "WindowsPowerShell", "v1.0", "powershell.exe"),
    "-NoProfile",
    "-Command",
  ];
}

export async function loadPackageConfig(root: string) {
  return (await Bun.file(join(root, "config/system-packages.json")).json()) as {
    common?: string[];
    windows?: { winget?: WingetPackage[]; installers?: Installer[] };
    [profile: string]: unknown;
  };
}

export async function planPackages(
  root: string,
  host: PackageHost,
  profile: string | null,
  runner: Runner = run,
): Promise<PackagePlan> {
  const config = await loadPackageConfig(root);
  const entries: PackageEntry[] = [];
  if (host === "linux") {
    const named = profile ? ((config[profile] as string[] | undefined) ?? []) : [];
    for (const id of new Set([...(config.common ?? []), ...named])) {
      const status = await runner(["dpkg-query", "-W", "-f=${Status}", id]);
      entries.push({
        manager: "apt",
        id,
        state:
          status.exitCode === 0 && status.stdout.includes("install ok installed")
            ? "installed"
            : "missing",
      });
    }
  } else {
    const shell = await powershell(runner);
    if (!shell) throw new Error("Windows is not reachable from this host (no powershell.exe)");
    for (const { id } of config.windows?.winget ?? []) {
      const listed = await runner([
        ...shell,
        `winget list --id ${id} -e --accept-source-agreements | Out-String`,
      ]);
      entries.push({
        manager: "winget",
        id,
        state:
          listed.exitCode === 0 && listed.stdout.toLowerCase().includes(id.toLowerCase())
            ? "installed"
            : "missing",
      });
    }
    for (const installer of config.windows?.installers ?? []) {
      const found = await runner([
        ...shell,
        `if (Get-Command ${installer.check} -ErrorAction SilentlyContinue) { 'yes' }`,
      ]);
      entries.push({
        manager: "installer",
        id: installer.name,
        state:
          found.stdout.includes("yes") ||
          (
            await runner([
              ...shell,
              `Test-Path "$env:USERPROFILE\\.cargo\\bin\\${installer.check}.exe"`,
            ])
          ).stdout.includes("True")
            ? "installed"
            : "missing",
      });
    }
  }
  return {
    schemaVersion: 1,
    host,
    profile,
    entries,
    missing: entries.filter((entry) => entry.state === "missing").length,
  };
}

/** Install what the plan lists as missing; returns the commands it ran. */
export async function applyPackages(
  root: string,
  plan: PackagePlan,
  runner: Runner = run,
): Promise<{ command: string; exitCode: number }[]> {
  const config = await loadPackageConfig(root);
  const results: { command: string; exitCode: number }[] = [];
  const exec = async (argv: string[]) => {
    const { exitCode } = await runner(argv);
    results.push({ command: argv.join(" "), exitCode });
  };
  const missing = plan.entries.filter((entry) => entry.state === "missing");
  if (plan.host === "linux") {
    const ids = missing.map((entry) => entry.id);
    if (ids.length) await exec(["sudo", "-n", "apt-get", "install", "-y", ...ids]);
    return results;
  }
  const shell = await powershell(runner);
  if (!shell) throw new Error("Windows is not reachable from this host (no powershell.exe)");
  for (const entry of missing) {
    if (entry.manager === "winget") {
      const spec = config.windows?.winget?.find((item) => item.id === entry.id);
      const override = spec?.override ? ` --override '${spec.override}'` : "";
      await exec([
        ...shell,
        `winget install --id ${entry.id} -e --silent --accept-package-agreements --accept-source-agreements${override}`,
      ]);
    } else {
      const installer = config.windows?.installers?.find((item) => item.name === entry.id);
      if (!installer) continue;
      await exec([
        ...shell,
        `$f="$env:TEMP\\${installer.name}-init.exe"; Invoke-WebRequest ${installer.url} -OutFile $f; & $f ${installer.args.join(" ")}`,
      ]);
    }
  }
  return results;
}

export async function runSystemPackages(args: string[]): Promise<number> {
  const [action = "plan", ...rest] = args;
  let host: PackageHost = process.platform === "win32" ? "windows" : "linux";
  let profile: string | null = null;
  let root = infraRoot();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--host") host = (rest[++i] ?? "") as PackageHost;
    else if (flag === "--profile") profile = rest[++i] ?? null;
    else if (flag === "--root") root = resolve(rest[++i] ?? "");
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (action === "--help" || action === "-h" || !["plan", "apply"].includes(action)) {
    console.log(
      "Usage: aphrody-ops system-packages <plan|apply> [--host linux|windows] [--profile <name>] [--root <repo>]",
    );
    return action === "--help" || action === "-h" ? 0 : 64;
  }
  if (host !== "linux" && host !== "windows") throw new Error("--host must be linux or windows");
  const plan = await planPackages(root, host, profile);
  const applied = action === "apply" ? await applyPackages(root, plan) : [];
  console.log(JSON.stringify({ ...plan, applied }, null, 2));
  return applied.some((item) => item.exitCode !== 0) ? 1 : 0;
}
