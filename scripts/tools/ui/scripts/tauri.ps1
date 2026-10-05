# SPDX-License-Identifier: Apache-2.0
# Wrapper for the shared Aphrody Tauri controller.
[CmdletBinding()]
param(
  [ValidateSet('check', 'build', 'run', 'dev', 'bundle')] [string]$Action = 'build',
  [string]$Bundles = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$argsList = @('tauri', $Action, '--root', $repo)
if ($Bundles) { $argsList += @('--bundles', $Bundles) }
& yolo ops @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
