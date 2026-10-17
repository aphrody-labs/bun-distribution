#Requires -Version 5.1
<#
.SYNOPSIS
Admits an Aphrody Bun native build into one of the host's build slots on Windows.
.DESCRIPTION
Named Windows mutexes Global\Aphrody.Bun.Native.Slot<N> own admission: up to
APHRODY_NATIVE_SLOTS builds (default 1) run at once and later callers wait for a
free slot instead of failing. The admitted slot is exported as APHRODY_NATIVE_SLOT
so the worker gives each slot its own Cargo target directory and job share. Bun's
shared process owner handles native arguments, streams, deadlines and process tree
teardown.
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
    $AphrodySlots = 1
    if ($env:APHRODY_NATIVE_SLOTS) { $AphrodySlots = [Math]::Max(1, [Math]::Min(16, [int]$env:APHRODY_NATIVE_SLOTS)) }
    $AphrodyDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $AphrodyWaiting = $false
    while (-not $AphrodyHasMutex) {
        for ($slot = 0; $slot -lt $AphrodySlots -and -not $AphrodyHasMutex; $slot++) {
            $candidate = [System.Threading.Mutex]::new($false, "Global\Aphrody.Bun.Native.Slot$slot")
            try { $AphrodyHasMutex = $candidate.WaitOne(0) }
            catch [System.Threading.AbandonedMutexException] { $AphrodyHasMutex = $true }
            if ($AphrodyHasMutex) { $AphrodyMutex = $candidate; $env:APHRODY_NATIVE_SLOT = [string]$slot }
            else { $candidate.Dispose() }
        }
        if ($AphrodyHasMutex) { break }
        if ([DateTime]::UtcNow -ge $AphrodyDeadline) { throw "All $AphrodySlots Aphrody Bun build slots stayed busy until the deadline." }
        if (-not $AphrodyWaiting) { [Console]::Error.WriteLine("Waiting for one of $AphrodySlots Aphrody Bun build slots..."); $AphrodyWaiting = $true }
        Start-Sleep -Milliseconds 1500
    }
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
