# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source='C:\bun'
if(!(Test-Path -LiteralPath "$source\.git") -or !(Test-Path -LiteralPath "$source\build\release\bun.exe")){throw 'BUN_SOURCE_OR_RELEASE_MISSING'}
$mapping=@(& "$env:SystemRoot\System32\subst.exe")
$b=@($mapping|Where-Object {$_ -match '^B:\\:'})
if($b.Count -gt 1 -or ($b.Count -eq 1 -and $b[0] -notmatch '^B:\\:\s*=>\s*C:\\bun\s*$')){throw 'UNEXPECTED_B_MAPPING'}
if($b.Count -eq 0 -and (Test-Path -LiteralPath 'B:\')){throw 'B_IS_NOT_EXPECTED_ALIAS'}
if($Apply -and $b.Count -eq 1){
 $active=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like 'B:\*' -or $_.CommandLine -match '(?i)(?:^|[\s"''])(?:B:\\)'})
 if($active.Count){throw 'ACTIVE_B_PROCESS'}
 & "$env:SystemRoot\System32\subst.exe" B: /D
 if($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath 'B:\')){throw 'ALIAS_REMOVAL_FAILED'}
}
@{applied=[bool]$Apply;aliasPresent=(Test-Path -LiteralPath 'B:\');bunSourcePreserved=(Test-Path -LiteralPath "$source\.git");releasePreserved=(Test-Path -LiteralPath "$source\build\release\bun.exe")} | ConvertTo-Json -Compress
