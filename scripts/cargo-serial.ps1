#Requires -Version 5.1
<#
.SYNOPSIS
Admits one Aphrody Bun native build on Windows.
.DESCRIPTION
The Windows mutex owns admission. Bun's shared process owner handles native
arguments, streams, deadlines and process tree teardown.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$WorkingDirectory,

    [ValidateRange(1, 43200)]
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'
$AphrodyMutex = $null
$AphrodyHasMutex = $false
$AphrodyExitCode = 1

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This admission wrapper requires native Windows.'
    }
    $AphrodyDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).ProviderPath
    if (-not (Test-Path -LiteralPath $AphrodyDirectory -PathType Container)) {
        throw 'Native working directory is not a directory.'
    }
    if (-not $env:APHRODY_NATIVE_BUN -or -not $env:APHRODY_NATIVE_WORKER) {
        throw 'The Bun owner must supply its verified runtime and native worker.'
    }
    $AphrodyBun = (Resolve-Path -LiteralPath $env:APHRODY_NATIVE_BUN).ProviderPath
    $AphrodyWorker = (Resolve-Path -LiteralPath $env:APHRODY_NATIVE_WORKER).ProviderPath
    $AphrodyMutex = [System.Threading.Mutex]::new($false, 'Global\Aphrody.Bun.Native')
    try { $AphrodyHasMutex = $AphrodyMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $AphrodyHasMutex = $true }
    if (-not $AphrodyHasMutex) { throw 'Another Aphrody Bun build owns this Windows host.' }
    $env:APHRODY_NATIVE_CWD = $AphrodyDirectory
    $env:APHRODY_NATIVE_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)
    & $AphrodyBun --no-env-file $AphrodyWorker
    $AphrodyExitCode = $LASTEXITCODE
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
finally {
    if ($AphrodyHasMutex) { $AphrodyMutex.ReleaseMutex() }
    if ($AphrodyMutex) { $AphrodyMutex.Dispose() }
}
exit $AphrodyExitCode
