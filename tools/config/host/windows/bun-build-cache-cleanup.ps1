# SPDX-License-Identifier: Apache-2.0
# Owner-requested cleanup of three audited, ignored, inactive Ninja output trees.
[CmdletBinding()]
param([ValidateSet('plan','apply')][string]$Mode='plan')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$cacheRoot='C:\bun\build'
$cacheNames=@('debug-fresh','debug-gate-2026-10-12','debug-msvc')
$protectedDirectory='^(\.git|\.local|store|stores|secret|secrets|cookie|cookies|model|models|weights|dataset|datasets|database|databases|provider|providers|conversation|conversations|session|sessions)$'
$removed=@()
function Assert-Inactive {
    if (@(Get-Process | Where-Object ProcessName -Match '^(cargo|rustc|ninja|clang|clang-cl|clang\+\+|link|lld|lld-link|cmake|msbuild)$').Count) { throw 'NATIVE_COMPILER_ACTIVE' }
    foreach($process in @(Get-Process | Where-Object ProcessName -Match '^(bun|aphrody|aphrody-infra|sccache)$')) {
        foreach($module in @($process.Modules)) {
            foreach($name in $cacheNames) {
                if($module.FileName.StartsWith((Join-Path $cacheRoot $name)+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'CACHE_MODULE_ACTIVE'}
            }
        }
    }
}
function Assert-Path([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if([IO.Path]::GetDirectoryName($full) -ne $cacheRoot -or [IO.Path]::GetFileName($full) -notin $cacheNames){throw 'CACHE_PATH_NOT_AUTHORIZED'}
    foreach($ancestor in @('C:\bun',$cacheRoot,$full)) {
        if((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CACHE_REPARSE_POINT'}
    }
    if(!(Test-Path -LiteralPath (Join-Path $full 'build.ninja') -PathType Leaf)){throw 'NINJA_OUTPUT_IDENTITY_MISSING'}
    $tracked=@(& git -C C:\bun ls-files -- ('build/'+[IO.Path]::GetFileName($full)))
    if($LASTEXITCODE -ne 0 -or $tracked.Count){throw 'CACHE_CONTAINS_TRACKED_FILES'}
    & git -C C:\bun check-ignore -q -- ('build/'+[IO.Path]::GetFileName($full))
    if($LASTEXITCODE -ne 0){throw 'CACHE_NOT_IGNORED'}
    $pending=[Collections.Generic.Stack[string]]::new()
    $pending.Push($full)
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    while($pending.Count){
        if([DateTime]::UtcNow -gt $deadline){throw 'CACHE_VALIDATION_TIMEOUT'}
        foreach($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())){
            $attributes=[IO.File]::GetAttributes($entry)
            if($attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CACHE_REPARSE_POINT'}
            $leaf=[IO.Path]::GetFileName($entry)
            if($attributes -band [IO.FileAttributes]::Directory){
                if($leaf -match $protectedDirectory){throw 'CACHE_PROTECTED_DIRECTORY'}
                $pending.Push($entry)
            }elseif($leaf -match '^(\.env(?:\..*)?|cookie(?:s)?\.json|credentials(?:\..*)?|secrets(?:\..*)?)$' -or $leaf -match '\.(sqlite|sqlite3)$'){
                throw 'CACHE_PROTECTED_FILE'
            }
        }
    }
}
try {
    if(![Environment]::Is64BitProcess){throw 'NATIVE_64BIT_REQUIRED'}
    if(!(Test-Path -LiteralPath C:\bun\.git)){throw 'CANONICAL_BUN_CHECKOUT_MISSING'}
    if($Mode -eq 'apply'){
        $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'NATIVE_ADMIN_REQUIRED'}
    }
    Assert-Inactive
    foreach($name in $cacheNames){Assert-Path (Join-Path $cacheRoot $name)}
    $before=(Get-Volume -DriveLetter C).SizeRemaining
    if($Mode -eq 'apply'){
        foreach($name in $cacheNames){
            Assert-Inactive
            $path=Join-Path $cacheRoot $name
            Assert-Path $path
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
            if(Test-Path -LiteralPath $path){throw 'CACHE_REMOVAL_INCOMPLETE'}
            $removed+=$name
        }
    }
    $after=(Get-Volume -DriveLetter C).SizeRemaining
    @{action=$Mode;complete=$true;removed=$removed;freeBeforeBytes=$before;freeAfterBytes=$after;netFreeIncreaseBytes=($after-$before);sourcePreserved=(Test-Path -LiteralPath C:\bun\.git);releasePreserved=(Test-Path -LiteralPath C:\bun\build\release\bun.exe)} | ConvertTo-Json -Compress
}catch{@{action=$Mode;complete=$false;removed=$removed;error=$_.Exception.Message} | ConvertTo-Json -Compress;exit 1}
