#Requires -Version 5.1
<#
.SYNOPSIS
Runs one Aphrody Bun native build with a bounded deadline.
.DESCRIPTION
The Bun CLI supplies APHRODY_NATIVE_ARGUMENTS as a JSON string array and
APHRODY_NATIVE_EXECUTABLE as the native owner. Arguments never pass through a shell.
The mutex is shared by Aphrody Bun native builds.
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
$AphrodyProcess = $null
$AphrodyExitCode = 1

function ConvertTo-AphrodyNativeArgument {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    # Windows CreateProcess argv rules, used only on PowerShell 5.1/.NET Framework.
    if ($Value -ne '' -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [System.Text.RegularExpressions.Regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [System.Text.RegularExpressions.Regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This wrapper requires native Windows.'
    }
    $AphrodyDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).ProviderPath
    if (-not (Test-Path -LiteralPath $AphrodyDirectory -PathType Container)) {
        throw 'Native working directory is not a directory.'
    }
    if (-not $env:APHRODY_NATIVE_ARGUMENTS -or -not $env:APHRODY_NATIVE_EXECUTABLE) {
        throw 'The Bun CLI must supply APHRODY_NATIVE_ARGUMENTS and APHRODY_NATIVE_EXECUTABLE.'
    }
    $AphrodyArguments = @(ConvertFrom-Json -InputObject $env:APHRODY_NATIVE_ARGUMENTS)
    if ($AphrodyArguments.Count -lt 1) { throw 'Native arguments are empty.' }
    foreach ($AphrodyArgument in $AphrodyArguments) {
        if ($AphrodyArgument -isnot [string] -or $AphrodyArgument.IndexOf([char]0) -ge 0) {
            throw 'Native arguments must be strings without NUL.'
        }
    }
    $AphrodyCargo = (Resolve-Path -LiteralPath $env:APHRODY_NATIVE_EXECUTABLE).ProviderPath
    $AphrodyMutex = [System.Threading.Mutex]::new($false, 'Global\Aphrody.Bun.Native')
    try { $AphrodyHasMutex = $AphrodyMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $AphrodyHasMutex = $true }
    if (-not $AphrodyHasMutex) { throw 'Another Aphrody Bun build owns this Windows host.' }

    $AphrodyStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $AphrodyStartInfo.FileName = $AphrodyCargo
    $AphrodyStartInfo.WorkingDirectory = $AphrodyDirectory
    $AphrodyStartInfo.UseShellExecute = $false
    $AphrodyStartInfo.CreateNoWindow = $true
    $AphrodyStartInfo.RedirectStandardOutput = $true
    $AphrodyStartInfo.RedirectStandardError = $true
    $AphrodyStartInfo.EnvironmentVariables['CARGO_BUILD_JOBS'] = '1'
    $AphrodyStartInfo.EnvironmentVariables.Remove('APHRODY_NATIVE_ARGUMENTS')
    $AphrodyStartInfo.EnvironmentVariables.Remove('APHRODY_NATIVE_EXECUTABLE')
    if ($AphrodyStartInfo.PSObject.Properties.Name -contains 'ArgumentList') {
        foreach ($AphrodyArgument in $AphrodyArguments) { $AphrodyStartInfo.ArgumentList.Add($AphrodyArgument) }
    }
    else {
        $AphrodyStartInfo.Arguments = ($AphrodyArguments | ForEach-Object { ConvertTo-AphrodyNativeArgument -Value $_ }) -join ' '
    }

    $AphrodyProcess = [System.Diagnostics.Process]::new()
    $AphrodyProcess.StartInfo = $AphrodyStartInfo
    if (-not $AphrodyProcess.Start()) { throw 'Native owner failed to start.' }
    $AphrodyStandardOutput = $AphrodyProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $AphrodyStandardError = $AphrodyProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    if (-not $AphrodyProcess.WaitForExit($TimeoutSeconds * 1000)) {
        $AphrodyTaskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        & $AphrodyTaskkill /PID ([string]$AphrodyProcess.Id) /T /F | Out-Null
        throw "Native owner exceeded the deadline of $TimeoutSeconds seconds."
    }
    $AphrodyCopies = [System.Threading.Tasks.Task[]]@($AphrodyStandardOutput, $AphrodyStandardError)
    if (-not [System.Threading.Tasks.Task]::WaitAll($AphrodyCopies, 5000)) {
        throw 'Native output streams did not finish within five seconds.'
    }
    $AphrodyExitCode = $AphrodyProcess.ExitCode
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
finally {
    if ($AphrodyProcess) { $AphrodyProcess.Dispose() }
    if ($AphrodyHasMutex) { $AphrodyMutex.ReleaseMutex() }
    if ($AphrodyMutex) { $AphrodyMutex.Dispose() }
}
exit $AphrodyExitCode
