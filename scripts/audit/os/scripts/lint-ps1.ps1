# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
  Compatibility entry point for the shared PowerShell syntax gate.
.EXAMPLE
  pwsh -NoProfile -File scripts/lint-ps1.ps1 -Root C:/src/aphrody
#>
param([Parameter(Mandatory)][string]$Root)

& yolo ops powershell-syntax --root $Root
exit $LASTEXITCODE
