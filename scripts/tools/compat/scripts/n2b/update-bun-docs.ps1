# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()] param([string]$Ref = "main")
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& aphrody-ops bun-upstream-docs --root $root --ref $Ref
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
