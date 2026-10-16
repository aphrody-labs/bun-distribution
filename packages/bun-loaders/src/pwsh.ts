// SPDX-License-Identifier: MIT
/** PowerShell loader backend: AST metadata through the PowerShell parser, execution through pwsh. */
import { resolve } from "node:path";

export interface PowerShellParameter {
  name: string;
  type: string;
  mandatory: boolean;
  default: string | null;
  position: number | null;
}
export interface PowerShellScript {
  path: string;
  synopsis: string | null;
  parameters: PowerShellParameter[];
  functions: { name: string; parameters: string[] }[];
  requires: string[];
  errors: { line: number; message: string }[];
}

const DESCRIBE = `$ErrorActionPreference = 'Stop'
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:BUN_LOADERS_SCRIPT, [ref]$tokens, [ref]$errs)
function Get-Params($block) {
  if (-not $block) { return @() }
  @($block.Parameters | ForEach-Object {
    $attr = $_.Attributes | Where-Object { $_.TypeName.Name -eq 'Parameter' } | Select-Object -First 1
    $named = if ($attr) { $attr.NamedArguments } else { @() }
    $mandatory = $named | Where-Object { $_.ArgumentName -eq 'Mandatory' }
    $position = $named | Where-Object { $_.ArgumentName -eq 'Position' }
    [pscustomobject]@{
      name = $_.Name.VariablePath.UserPath
      type = $_.StaticType.Name
      mandatory = [bool]($mandatory -and ($mandatory.ExpressionOmitted -or $mandatory.Argument.SafeGetValue()))
      default = if ($_.DefaultValue) { $_.DefaultValue.Extent.Text } else { $null }
      position = if ($position) { [int]$position.Argument.SafeGetValue() } else { $null }
    }
  })
}
$help = $ast.GetHelpContent()
[pscustomobject]@{
  synopsis = if ($help) { $help.Synopsis.Trim() } else { $null }
  parameters = Get-Params $ast.ParamBlock
  functions = @($ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object {
    $ps = if ($_.Body.ParamBlock) { $_.Body.ParamBlock.Parameters } else { $_.Parameters }
    [pscustomobject]@{ name = $_.Name; parameters = @($ps | ForEach-Object { $_.Name.VariablePath.UserPath }) }
  })
  requires = @(if ($ast.ScriptRequirements) { $ast.ScriptRequirements.RequiredModules | ForEach-Object { $_.Name } })
  errors = @($errs | ForEach-Object { [pscustomobject]@{ line = $_.Extent.StartLineNumber; message = $_.Message } })
} | ConvertTo-Json -Depth 6 -Compress`;

const RUN = `$ErrorActionPreference = 'Stop'
$p = if ($env:BUN_LOADERS_ARGS) { $env:BUN_LOADERS_ARGS | ConvertFrom-Json -AsHashtable } else { @{} }
$r = @(& $env:BUN_LOADERS_SCRIPT @p)
ConvertTo-Json -InputObject $r -Depth 8 -Compress`;

function pwsh(): string {
  const found = Bun.env.BUN_LOADERS_PWSH ?? Bun.which("pwsh");
  if (!found)
    throw new Error("PowerShell 7 (pwsh) is required to load .ps1 files");
  return found;
}

async function exec(
  command: string,
  env: Record<string, string>,
  timeout: number,
): Promise<string> {
  const proc = Bun.spawn(
    [pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      windowsHide: true,
      env: { ...Bun.env, ...env },
    },
  );
  const [out, err, code] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`pwsh exited ${code}: ${(err || out).trim()}`);
  return out.trim();
}

export async function describePowerShell(
  script: string,
): Promise<PowerShellScript> {
  const path = resolve(script);
  const info = JSON.parse(
    await exec(DESCRIBE, { BUN_LOADERS_SCRIPT: path }, 60_000),
  ) as Omit<PowerShellScript, "path">;
  return { path, ...info };
}

/** Run the script with named parameters (splatted); pipeline output is returned as JSON values. */
export async function runPowerShell(
  script: string,
  params: Record<string, unknown> = {},
  timeout = 600_000,
): Promise<unknown> {
  const out = await exec(
    RUN,
    {
      BUN_LOADERS_SCRIPT: resolve(script),
      BUN_LOADERS_ARGS: JSON.stringify(params),
    },
    timeout,
  );
  if (!out) return undefined;
  const values = JSON.parse(out) as unknown[];
  return values.length === 1 ? values[0] : values;
}

export async function powershellExports(
  script: string,
): Promise<Record<string, unknown>> {
  const metadata = await describePowerShell(script);
  const run = Object.assign(
    (params?: Record<string, unknown>) => runPowerShell(metadata.path, params),
    { metadata, parameters: metadata.parameters },
  );
  return { default: run, run, metadata, parameters: metadata.parameters };
}
