// SPDX-License-Identifier: Apache-2.0
/** Parse tracked PowerShell sources without executing them. */
import { resolve } from "node:path";

type ParseError = { file: string; line: number; message: string };

const parser = [
  "$ErrorActionPreference = 'Stop'",
  "$files = git -C $env:APHRODY_POWERSHELL_ROOT -c core.quotepath=off ls-files -z -- '*.ps1' '*.psm1' '*.psd1'",
  '$errors = foreach ($file in ($files -split "`0" | Where-Object { $_ })) {',
  "  $path = Join-Path $env:APHRODY_POWERSHELL_ROOT $file",
  "  $tokens = $null; $parseErrors = $null",
  "  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)",
  "  foreach ($error in $parseErrors) { [pscustomobject]@{ file = $file; line = $error.Extent.StartLineNumber; message = $error.Message } }",
  "}",
  "ConvertTo-Json -InputObject @($errors) -Compress",
].join("\n");

function executable(explicit?: string): string {
  if (explicit) return explicit;
  const found = Bun.which("pwsh") ?? Bun.which("powershell") ?? Bun.which("powershell.exe");
  if (!found) throw new Error("PowerShell 7 (pwsh) or Windows PowerShell is required to parse PowerShell sources");
  return found;
}

export async function runPowerShellSyntax(args: string[]): Promise<number> {
  let root = process.cwd();
  let selectedRuntime: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--runtime") selectedRuntime = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops powershell-syntax [--root <repository>] [--runtime <pwsh-or-powershell>]");
      return 0;
    } else throw new Error("Unknown argument: " + arg);
  }
  if (!root) throw new Error("--root requires a repository path");
  root = resolve(root);
  const child = Bun.spawn(
    [executable(selectedRuntime), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", parser],
    {
      windowsHide: true,
      cwd: root,
      env: { ...Bun.env, APHRODY_POWERSHELL_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || "PowerShell parser exited with status " + exitCode);
  const report = (JSON.parse(stdout) as ParseError[] | null) ?? [];
  console.log(JSON.stringify(report));
  return report.length ? 1 : 0;
}

if (import.meta.main) process.exit(await runPowerShellSyntax(process.argv.slice(2)));
