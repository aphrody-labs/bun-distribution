#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build a local microsoft/terminal checkout (reference only, never linked) with the newest Visual
 * Studio MSBuild toolset (v145) and Windows SDK 10.0.26100.0 instead of the upstream v143 /
 * 10.0.22621.0 pins. The developer environment comes from vswhere + VsDevCmd captured without a
 * console (no PowerShell module import); a current nuget.exe restores `OpenConsole.slnx`.
 *
 * Usage: bun scripts/build/shell/terminal-build.ts [--project <msbuild target>]
 *          [--terminal-root <checkout>] [--configuration Debug|Release|AuditMode|Fuzzing]
 *          [--platform x64|x86|ARM64]
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Env = Record<string, string | undefined>;

export const TOOLSET = "v145";
export const SDK = "10.0.26100.0";
const CONFIGURATIONS = ["Debug", "Release", "AuditMode", "Fuzzing"];
const PLATFORMS = ["x64", "x86", "ARM64"];
const NUGET_URL = "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe";
const repoRoot = resolve(import.meta.dir, "../../../../docs/aphrody");

export interface BuildOptions {
  project?: string;
  terminalRoot: string;
  configuration: string;
  platform: string;
}

export function parseArgs(argv: string[]): BuildOptions & { help: boolean } {
  const options = {
    terminalRoot: join(repoRoot, "vendor", "terminal"),
    configuration: "Release",
    platform: "x64",
    project: undefined as string | undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} expects a value`);
      return next;
    };
    if (arg === "--project") options.project = value();
    else if (arg === "--terminal-root") options.terminalRoot = resolve(value());
    else if (arg === "--configuration") options.configuration = value();
    else if (arg === "--platform") options.platform = value();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!CONFIGURATIONS.includes(options.configuration))
    throw new Error(`--configuration must be one of ${CONFIGURATIONS.join(", ")}`);
  if (!PLATFORMS.includes(options.platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(", ")}`);
  return options;
}

/** MSBuild arguments with the toolset and SDK overrides. */
export function msbuildArgs(options: BuildOptions): string[] {
  const args = [
    join(options.terminalRoot, "OpenConsole.slnx"),
    `/p:Configuration=${options.configuration}`,
    `/p:Platform=${options.platform}`,
    `/p:PlatformToolset=${TOOLSET}`,
    `/p:WindowsTargetPlatformVersion=${SDK}`,
    // Overrides the UAP target of the .wapproj packages.
    `/p:TargetPlatformVersion=${SDK}`,
    "/p:AppxSymbolPackageEnabled=false",
    "/m",
    "/nologo",
    "/v:minimal",
  ];
  if (options.project) args.push(`/t:${options.project}`);
  return args;
}

/** `name=value` lines of `set` into an environment. */
export function parseSetOutput(text: string): Env {
  const env: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const equals = line.indexOf("=", 1);
    if (equals > 0) env[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return env;
}

/** Environment of the newest (prerelease included) Visual Studio carrying MSBuild, for amd64. */
export function developerEnvironment(env: Env): Env {
  const programFiles = env["ProgramFiles(x86)"] ?? env.ProgramFiles ?? "C:\\Program Files (x86)";
  const vswhere = join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) throw new Error("vswhere.exe not found: install Visual Studio (Build Tools) 2026.");
  const install = Bun.spawnSync(
    [
      vswhere,
      "-latest",
      "-prerelease",
      "-products",
      "*",
      "-requires",
      "Microsoft.Component.MSBuild",
      "-property",
      "installationPath",
    ],
    { stdout: "pipe", stderr: "pipe", windowsHide: true },
  )
    .stdout.toString()
    .trim();
  if (!install) throw new Error("No Visual Studio installation with MSBuild was found.");
  const devCmd = join(install, "Common7", "Tools", "VsDevCmd.bat");
  if (!existsSync(devCmd)) throw new Error(`VsDevCmd.bat missing: ${devCmd}`);
  const dir = mkdtempSync(join(tmpdir(), "aphrody-vsdev-"));
  try {
    const script = join(dir, "vsdev-env.cmd");
    writeFileSync(
      script,
      `@echo off\r\nchcp 65001 >nul\r\ncall "${devCmd}" -arch=amd64 -host_arch=amd64 -no_logo >nul 2>&1\r\nif errorlevel 1 exit /b 1\r\nset\r\n`,
    );
    const result = Bun.spawnSync([env.ComSpec ?? "cmd.exe", "/d", "/c", script], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    if (result.exitCode !== 0) throw new Error(`VsDevCmd.bat failed (${result.exitCode})`);
    const captured = parseSetOutput(result.stdout.toString());
    if (!captured.VSINSTALLDIR) throw new Error("VsDevCmd.bat did not provide VSINSTALLDIR");
    return captured;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function step(name: string, argv: string[], env: Env, cwd: string): Promise<void> {
  console.log(`==> ${name}`);
  const child = Bun.spawn(argv, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${name} failed (${code})`);
}

export async function build(options: BuildOptions): Promise<void> {
  if (process.platform !== "win32") throw new Error("microsoft/terminal builds on Windows only.");
  const solution = join(options.terminalRoot, "OpenConsole.slnx");
  if (!existsSync(solution))
    throw new Error(
      `microsoft/terminal checkout not found at '${options.terminalRoot}'. Clone it and apply docs/reference/shell/terminal/PATCHES.diff (see docs/products/shell/terminal/README.md), or pass --terminal-root.`,
    );
  const env: Env = {
    ...developerEnvironment(process.env),
    PlatformToolset: TOOLSET,
    WindowsTargetPlatformVersion: SDK,
  };
  const msbuildBin = join(env.VSINSTALLDIR as string, "MSBuild", "Current", "Bin");
  // The bundled NuGet cannot parse .slnx (NuGet/Home#14034); a current nuget.exe delegates to MSBuild.
  const nuget = join(options.terminalRoot, "dep", "nuget", "nuget-latest.exe");
  if (!existsSync(nuget)) {
    console.log("==> Downloading latest nuget.exe");
    const response = await fetch(NUGET_URL);
    if (!response.ok) throw new Error(`nuget.exe download failed: HTTP ${response.status}`);
    await Bun.write(nuget, response);
  }
  await step(
    "nuget restore OpenConsole.slnx",
    [nuget, "restore", solution, "-MSBuildPath", msbuildBin],
    env,
    options.terminalRoot,
  );
  await step(
    "nuget restore dep\\nuget\\packages.config",
    [
      nuget,
      "restore",
      join(options.terminalRoot, "dep", "nuget", "packages.config"),
      "-SolutionDirectory",
      options.terminalRoot,
    ],
    env,
    options.terminalRoot,
  );
  const msbuild = join(msbuildBin, "MSBuild.exe");
  await step(
    `msbuild ${msbuildArgs(options).join(" ")}`,
    [existsSync(msbuild) ? msbuild : "msbuild.exe", ...msbuildArgs(options)],
    env,
    options.terminalRoot,
  );
  console.log("==> Build OK");
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help)
      console.log(
        "Usage: bun scripts/build/shell/terminal-build.ts [--project <target>] [--terminal-root <checkout>] [--configuration Debug|Release|AuditMode|Fuzzing] [--platform x64|x86|ARM64]",
      );
    else await build(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
