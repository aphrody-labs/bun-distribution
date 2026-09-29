# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Executable,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgumentList
)

$nativeSudo = Join-Path $env:SystemRoot 'System32\sudo.exe'
if (-not (Test-Path -LiteralPath $nativeSudo -PathType Leaf)) {
    throw "Native Windows sudo is unavailable: $nativeSudo"
}

& $nativeSudo --inline --chdir (Get-Location).Path $Executable @ArgumentList
exit $LASTEXITCODE
