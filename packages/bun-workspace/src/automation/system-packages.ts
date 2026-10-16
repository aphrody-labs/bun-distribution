// SPDX-License-Identifier: Apache-2.0
/** Host prerequisites from infra/config/system-packages.json: one plan/apply for apt (Linux, WSL) and winget (Windows). */
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

export const run: Runner = async argv => {
  try {
    const child = Bun.spawn(argv, {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { exitCode, stdout };
  } catch {
    return { exitCode: 127, stdout: "" };
  }
};

const PWSH_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * PowerShell 7 (pwsh.exe), preferred, else Windows PowerShell. From WSL the Windows directories are
 * often not on PATH, so the MSIX alias and the MSI location are resolved through wslpath.
 */
export async function powershell(runner: Runner = run): Promise<string[] | null> {
  if (process.platform === "win32") return ["pwsh.exe", ...PWSH_ARGS];
  if (process.platform !== "linux") return null;
  const onPath = async (name: string) => (await runner(["sh", "-c", `command -v ${name}`])).exitCode === 0;
  if (await onPath("pwsh.exe")) return ["pwsh.exe", ...PWSH_ARGS];
  const windowsPath = async (path: string) => {
    const out = await runner(["wslpath", "-u", path]);
    return out.exitCode === 0 ? out.stdout.trim() : null;
  };
  const user = await runner(["sh", "-c", "ls /mnt/*/Users 2>/dev/null"]);
  const profiles = user.stdout
    .split("\n")
    .filter(name => name && !/^(Public|Default|All Users|desktop\.ini)/i.test(name));
  for (const candidate of [
    String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
    ...profiles.map(name => `C:\\Users\\${name}\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe`),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel : l'ordre de priorité des binaires désigne le premier trouvé
    const linux = await windowsPath(candidate);
    // oxlint-disable-next-line no-await-in-loop -- même sondage : l'arrêt à la première trouvaille est voulu
    if (linux && (await runner(["test", "-e", linux])).exitCode === 0) return [linux, ...PWSH_ARGS];
  }
  if (await onPath("powershell.exe")) return ["powershell.exe", ...PWSH_ARGS];
  const system32 = await windowsPath(String.raw`C:\Windows\System32`);
  return system32 ? [join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"), ...PWSH_ARGS] : null;
}

export async function loadPackageConfig(root: string) {
  return (await Bun.file(join(root, "infra/config/system-packages.json")).json()) as {
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
    const ids = [...new Set([...(config.common ?? []), ...named])];
    const statuses = await Promise.all(ids.map(id => runner(["dpkg-query", "-W", "-f=${Status}", id])));
    for (const [index, id] of ids.entries()) {
      const status = statuses[index]!;
      entries.push({
        manager: "apt",
        id,
        state: status.exitCode === 0 && status.stdout.includes("install ok installed") ? "installed" : "missing",
      });
    }
  } else {
    const shell = await powershell(runner);
    if (!shell) throw new Error("Windows is not reachable from this host (no pwsh.exe or powershell.exe)");
    // One PowerShell process answers the whole plan, through the official winget module.
    const installers = config.windows?.installers ?? [];
    // The winget module needs a COM session that processes started from WSL do not get (it fails after
    // ~30 s); from WSL read the same state with `winget export`. Native Windows uses the module.
    const viaModule = process.platform === "win32";
    const listing = viaModule
      ? "Import-Module Microsoft.WinGet.Client; $have = @(Get-WinGetPackage | ForEach-Object { $_.Id })"
      : "$f = Join-Path $env:TEMP 'aphrody-winget-export.json'; winget export -o $f --accept-source-agreements --disable-interactivity | Out-Null; $have = @((Get-Content $f -Raw | ConvertFrom-Json).Sources.Packages.PackageIdentifier)";
    const probe = [
      listing,
      "$tools = @{}",
      ...installers.map(
        item =>
          `$tools['${item.name}'] = [bool](Get-Command ${item.check} -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $env:USERPROFILE '.cargo\\bin\\${item.check}.exe')) -or (Test-Path (Join-Path $env:USERPROFILE '.bun\\bin\\${item.check}.exe'))`,
      ),
      "[pscustomobject]@{ winget = $have; tools = $tools } | ConvertTo-Json -Compress -Depth 3",
    ].join("; ");
    const probed = await runner([...shell, probe]);
    if (probed.exitCode !== 0) throw new Error(`Windows probe failed: ${probed.stdout.trim()}`);
    const state = JSON.parse(probed.stdout.trim().split("\n").at(-1) ?? "{}") as {
      winget?: string[] | string;
      tools?: Record<string, boolean>;
    };
    const have = new Set(
      (Array.isArray(state.winget) ? state.winget : [state.winget ?? ""]).map(id => id.toLowerCase()),
    );
    for (const { id } of config.windows?.winget ?? [])
      entries.push({
        manager: "winget",
        id,
        state: have.has(id.toLowerCase()) ? "installed" : "missing",
      });
    for (const item of installers)
      entries.push({
        manager: "installer",
        id: item.name,
        state: state.tools?.[item.name] ? "installed" : "missing",
      });
  }
  return {
    schemaVersion: 1,
    host,
    profile,
    entries,
    missing: entries.filter(entry => entry.state === "missing").length,
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
  const missing = plan.entries.filter(entry => entry.state === "missing");
  if (plan.host === "linux") {
    const ids = missing.map(entry => entry.id);
    if (ids.length) await exec(["sudo", "-n", "apt-get", "install", "-y", ...ids]);
    return results;
  }
  const shell = await powershell(runner);
  if (!shell) throw new Error("Windows is not reachable from this host (no pwsh.exe or powershell.exe)");
  const viaModule = process.platform === "win32";
  const steps = [...(viaModule ? ["Import-Module Microsoft.WinGet.Client"] : []), "$ErrorActionPreference = 'Stop'"];
  for (const entry of missing) {
    if (entry.manager === "winget") {
      const spec = config.windows?.winget?.find(item => item.id === entry.id);
      steps.push(
        viaModule
          ? `Install-WinGetPackage -Id ${quote(entry.id)} -Mode Silent${spec?.override ? ` -Override ${quote(spec.override)}` : ""} | Out-Null`
          : `winget install --id ${quote(entry.id)} -e --silent --accept-package-agreements --accept-source-agreements${spec?.override ? ` --override ${quote(spec.override)}` : ""}; if ($LASTEXITCODE -and $LASTEXITCODE -ne -1978335189) { exit $LASTEXITCODE }`,
      );
    } else {
      const installer = config.windows?.installers?.find(item => item.name === entry.id);
      if (!installer) continue;
      steps.push(
        installer.url.endsWith(".ps1")
          ? `& ([scriptblock]::Create((Invoke-RestMethod ${quote(installer.url)}))) ${installer.args.map(a => (/^-[A-Za-z]+$/.test(a) ? a : quote(a))).join(" ")}`
          : `$f = Join-Path $env:TEMP ${quote(`${installer.name}-init.exe`)}; Invoke-WebRequest ${quote(installer.url)} -OutFile $f; & $f ${installer.args.map(quote).join(" ")}; if ($LASTEXITCODE) { exit $LASTEXITCODE }`,
      );
    }
  }
  if (steps.length > (viaModule ? 2 : 1)) await exec([...shell, steps.join("; ")]);
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
      "Usage: yolo ops system-packages <plan|apply> [--host linux|windows] [--profile <name>] [--root <repo>]",
    );
    return action === "--help" || action === "-h" ? 0 : 64;
  }
  if (host !== "linux" && host !== "windows") throw new Error("--host must be linux or windows");
  const plan = await planPackages(root, host, profile);
  const applied = action === "apply" ? await applyPackages(root, plan) : [];
  console.log(JSON.stringify({ ...plan, applied }, null, 2));
  return applied.some(item => item.exitCode !== 0) ? 1 : 0;
}
