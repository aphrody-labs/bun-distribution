# SPDX-License-Identifier: Apache-2.0
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EnvironmentValue {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][ValidateSet('Process', 'User', 'Machine')][string]$Target)

    if ($Target -eq 'Process') {
        $values = [Environment]::GetEnvironmentVariables('Process')
        $exists = $values.Contains($Name)
        return [pscustomobject]@{ Exists = $exists; Value = if ($exists) { [string]$values[$Name] } else { $null } }
    }

    $key = if ($Target -eq 'User') { [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment') }
        else { [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment') }
    if ($null -eq $key) { return [pscustomobject]@{ Exists = $false; Value = $null } }
    try {
        $exists = @($key.GetValueNames()) -contains $Name
        $value = if ($exists) { [string]$key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
        return [pscustomobject]@{ Exists = $exists; Value = $value }
    } finally { $key.Dispose() }
}

function Test-RoutableWrapperValue {
    param([AllowNull()][string]$Value, [Parameter(Mandatory)][bool]$Exists, [Parameter(Mandatory)][string]$RouterPath, [AllowNull()][string]$SccachePath)

    if (-not $Exists) { return $true }
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $candidate = $Value.Trim().Trim('"').Trim("'")
    if ($candidate -ieq 'sccache' -or $candidate -ieq 'sccache.exe') { return $true }
    try {
        if ([IO.Path]::GetFullPath($candidate).TrimEnd('\') -ieq [IO.Path]::GetFullPath($RouterPath).TrimEnd('\')) {
            return $true
        }
        if ([IO.Path]::GetFileName($candidate) -ieq 'sccache.exe') {
            $fullCandidate = [IO.Path]::GetFullPath($candidate)
            if ($SccachePath -and $fullCandidate -ieq [IO.Path]::GetFullPath($SccachePath)) { return $true }
            $sibling = Join-Path (Split-Path -Parent $RouterPath) 'sccache.exe'
            if ([IO.File]::Exists($fullCandidate) -and $fullCandidate -ieq [IO.Path]::GetFullPath($sibling)) { return $true }
        }
    } catch {
        return $false
    }
    return $false
}

function ConvertFrom-TomlStringValue {
    param([Parameter(Mandatory)][string]$Value)

    $trimmed = $Value.Trim()
    if ($trimmed.StartsWith('"')) {
        $end = $trimmed.IndexOf('"', 1)
        while ($end -ge 0 -and $trimmed[$end - 1] -eq '\') {
            $end = $trimmed.IndexOf('"', $end + 1)
        }
        if ($end -lt 0 -or ($trimmed.Substring($end + 1).Trim() -and -not $trimmed.Substring($end + 1).Trim().StartsWith('#'))) {
            throw 'Cargo build.rustc-wrapper is not a supported TOML string value.'
        }
        try { return (ConvertFrom-Json -InputObject $trimmed.Substring(0, $end + 1) -ErrorAction Stop) }
        catch { throw 'Cargo build.rustc-wrapper has an invalid TOML basic string.' }
    }
    if ($trimmed.StartsWith("'")) {
        $end = $trimmed.IndexOf("'", 1)
        if ($end -lt 0 -or ($trimmed.Substring($end + 1).Trim() -and -not $trimmed.Substring($end + 1).Trim().StartsWith('#'))) {
            throw 'Cargo build.rustc-wrapper is not a supported TOML string value.'
        }
        return $trimmed.Substring(1, $end - 1)
    }
    throw 'Cargo build.rustc-wrapper is not a string; refusing to rewrite Cargo configuration.'
}

function Get-CargoWrapperConfig {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Path = $Path; Exists = $false; Text = ''; Encoding = [Text.UTF8Encoding]::new($false); Wrapper = $null; HasBuild = $false }
    }

    $bytes = [IO.File]::ReadAllBytes($Path)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $encoding = [Text.UTF8Encoding]::new($hasBom, $true)
    $offset = if ($hasBom) { 3 } else { 0 }
    $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
    $lines = [regex]::Split($text, "(?<=`n)")
    $inBuild = $false
    $buildCount = 0
    $wrapperValues = [Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        $section = [regex]::Match($line, '^\s*\[([^\]]+)\]\s*(?:#.*)?(?:\r?\n)?$')
        if ($section.Success) {
            $inBuild = $section.Groups[1].Value.Trim() -eq 'build'
            if ($inBuild) { $buildCount++ }
            continue
        }
        if ($inBuild) {
            $key = [regex]::Match($line, '^\s*rustc-wrapper\s*=\s*(.*?)\s*(?:#.*)?(?:\r?\n)?$')
            if ($key.Success) { $wrapperValues.Add((ConvertFrom-TomlStringValue -Value $key.Groups[1].Value)) }
        } elseif ($line -match '^\s*build\.rustc-wrapper\s*=') {
            throw "Unsupported dotted build.rustc-wrapper key in Cargo config: $Path"
        }
    }
    if ($buildCount -gt 1 -or $wrapperValues.Count -gt 1) { throw "Duplicate [build] or rustc-wrapper key in Cargo config: $Path" }
    $wrapper = if ($wrapperValues.Count -eq 1) { $wrapperValues[0] } else { $null }
    return [pscustomobject]@{ Path = $Path; Exists = $true; Text = $text; Encoding = $encoding; Wrapper = $wrapper; HasBuild = ($buildCount -eq 1) }
}

function Set-CargoWrapperText {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$RouterPath)

    $escaped = ConvertTo-Json -InputObject $RouterPath -Compress
    $text = [string]$Config.Text
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [Collections.Generic.List[string]]::new()
    foreach ($line in [regex]::Split($text, "(?<=`n)")) { $lines.Add($line) }
    $inBuild = $false
    $buildStart = -1
    $buildEnd = $lines.Count
    $wrapperIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $section = [regex]::Match($lines[$i], '^\s*\[([^\]]+)\]\s*(?:#.*)?(?:\r?\n)?$')
        if ($section.Success) {
            if ($inBuild) { $buildEnd = $i; break }
            $inBuild = $section.Groups[1].Value.Trim() -eq 'build'
            if ($inBuild) { $buildStart = $i }
            continue
        }
        if ($inBuild -and $lines[$i] -match '^\s*rustc-wrapper\s*=') { $wrapperIndex = $i }
    }
    if ($wrapperIndex -ge 0) {
        $oldLine = $lines[$wrapperIndex]
        $ending = if ($oldLine.EndsWith("`r`n")) { "`r`n" } elseif ($oldLine.EndsWith("`n")) { "`n" } else { '' }
        $comment = [regex]::Match($oldLine, '\s+#.*?(?=\r?$)').Value
        $lines[$wrapperIndex] = "rustc-wrapper = $escaped$comment$ending"
    } elseif ($buildStart -ge 0) {
        $insertion = $buildEnd
        if ($insertion -gt $buildStart + 1 -and -not $lines[$insertion - 1].EndsWith("`n")) {
            $lines[$insertion - 1] = $lines[$insertion - 1] + $newline
        }
        $lines.Insert($insertion, "rustc-wrapper = $escaped$newline")
    } else {
        if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += $newline }
        if ($text.Length -gt 0 -and -not $text.EndsWith("$newline$newline")) { $text += $newline }
        $text += "[build]$newline" + "rustc-wrapper = $escaped$newline"
        return $text
    }
    return [string]::Concat($lines)
}

function Write-AtomicFile {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][byte[]]$Bytes, [Parameter(Mandatory)][string]$BackupPath)

    $directory = Split-Path -Parent $Path
    $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllBytes($temporary, $Bytes)
        if ([IO.File]::Exists($Path)) {
            [IO.File]::Replace($temporary, $Path, $BackupPath, $true)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Test-DirectoryWritable {
    param([Parameter(Mandatory)][string]$Directory)

    $probe = Join-Path $Directory ('.aphrody-router-preflight-' + [guid]::NewGuid().ToString('N'))
    try {
        $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Dispose()
    } finally {
        if ([IO.File]::Exists($probe)) { [IO.File]::Delete($probe) }
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($algorithm.ComputeHash($Bytes)) }
    finally { $algorithm.Dispose() }
}

function Get-PathSha256 {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Read-InstallReceipt {
    param([Parameter(Mandatory)][string]$Path)
    if (-not [IO.File]::Exists($Path)) { return $null }
    try {
        $receipt = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)) -ErrorAction Stop
        if ($receipt -isnot [System.Management.Automation.PSCustomObject]) { return $null }
        $required = @('Schema', 'BuildFingerprint', 'SourceSha256', 'RustcPath', 'RustcSha256', 'RustcVersion', 'LinkerPath', 'LinkerSha256', 'BuildOptions', 'RouterSha256')
        foreach ($name in $required) {
            if ($null -eq $receipt.PSObject.Properties[$name]) { return $null }
        }
        if ($receipt.Schema -isnot [int] -and $receipt.Schema -isnot [long]) { return $null }
        if ($receipt.Schema -ne 1) { return $null }
        foreach ($name in @('BuildFingerprint', 'SourceSha256', 'RustcSha256', 'RouterSha256')) {
            if ($receipt.$name -isnot [string] -or $receipt.$name -notmatch '^[A-Fa-f0-9]{64}$') { return $null }
        }
        if ($receipt.RustcPath -isnot [string] -or $receipt.RustcVersion -isnot [string]) { return $null }
        if ($receipt.BuildOptions -isnot [array] -or @($receipt.BuildOptions | Where-Object { $_ -isnot [string] }).Count -gt 0) { return $null }
        if ($null -ne $receipt.LinkerPath -and $receipt.LinkerPath -isnot [string]) { return $null }
        if ($null -ne $receipt.LinkerSha256 -and ($receipt.LinkerSha256 -isnot [string] -or $receipt.LinkerSha256 -notmatch '^[A-Fa-f0-9]{64}$')) { return $null }
        return $receipt
    }
    catch { return $null }
}

function Send-EnvironmentChanged {
    if (-not ('Aphrody.RustcRouterInstaller.NativeMethods' -as [type])) {
        Add-Type -Namespace Aphrody.RustcRouterInstaller -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
    }
    $result = [UIntPtr]::Zero
    [void][Aphrody.RustcRouterInstaller.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]$result)
}

$scriptPath = $PSScriptRoot
$sourcePath = Join-Path $scriptPath 'sccache-rustc-router.rs'
$cargoDirectory = Join-Path $env:USERPROFILE '.cargo'
$destination = Join-Path $cargoDirectory 'bin\aphrody-rustc-router.exe'
$receiptPath = $destination + '.install.json'
$rustcCommand = Get-Command rustc.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$rustcPath = $rustcCommand.Source
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Router source not found: $sourcePath" }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $destination) -PathType Container)) { throw "Cargo bin directory not found: $(Split-Path -Parent $destination)" }
if (-not (Test-Path -LiteralPath $rustcPath -PathType Leaf)) { throw "rustc executable not found: $rustcPath" }

$sccacheCommand = Get-Command sccache.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$sccachePath = if ($sccacheCommand) { $sccacheCommand.Source } else { $null }
$userWrapper = Get-EnvironmentValue -Name 'RUSTC_WRAPPER' -Target User
$machineWrapper = Get-EnvironmentValue -Name 'RUSTC_WRAPPER' -Target Machine
$processWrapper = Get-EnvironmentValue -Name 'RUSTC_WRAPPER' -Target Process
$cargoBuildProcess = Get-EnvironmentValue -Name 'CARGO_BUILD_RUSTC_WRAPPER' -Target Process
$cargoBuildUser = Get-EnvironmentValue -Name 'CARGO_BUILD_RUSTC_WRAPPER' -Target User
$cargoBuildMachine = Get-EnvironmentValue -Name 'CARGO_BUILD_RUSTC_WRAPPER' -Target Machine
$globalToml = Join-Path $cargoDirectory 'config.toml'
$globalLegacy = Join-Path $cargoDirectory 'config'
$configs = @(
    (Get-CargoWrapperConfig -Path $globalLegacy),
    (Get-CargoWrapperConfig -Path $globalToml)
)
$existingConfigs = @($configs | Where-Object Exists)
$customConfig = @($existingConfigs | Where-Object { $null -ne $_.Wrapper -and -not (Test-RoutableWrapperValue -Value $_.Wrapper -Exists $true -RouterPath $destination -SccachePath $sccachePath) })
$cargoBuildSettings = @($cargoBuildProcess, $cargoBuildUser, $cargoBuildMachine)
$cargoBuildCustom = @($cargoBuildSettings | Where-Object { $_.Exists -and -not (Test-RoutableWrapperValue -Value $_.Value -Exists $true -RouterPath $destination -SccachePath $sccachePath) })
$processCustom = $processWrapper.Exists -and -not (Test-RoutableWrapperValue -Value $processWrapper.Value -Exists $true -RouterPath $destination -SccachePath $sccachePath)
$machineCustom = $machineWrapper.Exists -and -not (Test-RoutableWrapperValue -Value $machineWrapper.Value -Exists $true -RouterPath $destination -SccachePath $sccachePath)
$userCustom = $userWrapper.Exists -and -not (Test-RoutableWrapperValue -Value $userWrapper.Value -Exists $true -RouterPath $destination -SccachePath $sccachePath)

if (@($customConfig).Count -gt 0) { Write-Verbose 'A custom Cargo build.rustc-wrapper is present; Cargo config will be preserved.' }
if (@($cargoBuildCustom).Count -gt 0) { Write-Verbose 'A custom CARGO_BUILD_RUSTC_WRAPPER is present; that environment setting will be preserved.' }
if ($processCustom -or $machineCustom -or $userCustom) { Write-Verbose 'A custom RUSTC_WRAPPER is present in an environment scope; that setting will be preserved.' }

$configTarget = $null
$configText = $null
if (@($customConfig).Count -eq 0 -and @($cargoBuildCustom).Count -eq 0) {
    $configTarget = if (Test-Path -LiteralPath $globalLegacy -PathType Leaf) { $configs[0] } elseif (Test-Path -LiteralPath $globalToml -PathType Leaf) { $configs[1] } else { $configs[1] }
    $configText = Set-CargoWrapperText -Config $configTarget -RouterPath $destination
}
$setUserWrapper = (-not $processCustom -and -not $machineCustom -and -not $userCustom -and @($cargoBuildCustom).Count -eq 0 -and @($customConfig).Count -eq 0)

$buildOptions = @('--edition=2024', '--crate-name', 'aphrody_rustc_router', '-C', 'opt-level=2', '-C', 'debuginfo=0', '-C', 'link-arg=/Brepro')
$sourceHash = Get-PathSha256 -Path $sourcePath
$rustcHash = Get-PathSha256 -Path $rustcPath
$rustcVersion = (& $rustcPath --version --verbose | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $rustcVersion) { throw "Could not identify rustc (exit $LASTEXITCODE)." }
$linkerCommand = Get-Command link.exe,lld-link.exe,rust-lld.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$linkerPath = if ($linkerCommand) { [IO.Path]::GetFullPath($linkerCommand.Source) } else { $null }
$linkerHash = if ($linkerPath -and [IO.File]::Exists($linkerPath)) { Get-PathSha256 -Path $linkerPath } else { $null }
$buildIdentity = [ordered]@{
    SourceSha256 = $sourceHash
    RustcPath = [IO.Path]::GetFullPath($rustcPath)
    RustcSha256 = $rustcHash
    RustcVersion = $rustcVersion
    LinkerPath = $linkerPath
    LinkerSha256 = $linkerHash
    BuildOptions = $buildOptions
}
$buildIdentityJson = ConvertTo-Json -InputObject $buildIdentity -Compress -Depth 4
$buildFingerprint = Get-Sha256 -Bytes ([Text.UTF8Encoding]::new($false).GetBytes($buildIdentityJson))
$existingReceipt = Read-InstallReceipt -Path $receiptPath
$installed = [IO.File]::Exists($destination)
$installedHash = if ($installed) { Get-PathSha256 -Path $destination } else { $null }
$receiptCurrent = $null -ne $existingReceipt -and
    $existingReceipt.Schema -eq 1 -and
    $existingReceipt.BuildFingerprint -ceq $buildFingerprint -and
    $existingReceipt.RouterSha256 -ceq $installedHash

if ($receiptCurrent) { Write-Verbose 'Verified install receipt and executable hash match; skipping router compilation.' }

if ($WhatIfPreference) {
    $targets = @($destination, $receiptPath)
    if ($null -ne $configTarget -and $configText -cne $configTarget.Text) { $targets += $configTarget.Path }
    if ($setUserWrapper -and $userWrapper.Value -cne $destination) { $targets += 'User RUSTC_WRAPPER' }
    $transactionTarget = $targets -join '; '
    [void]$PSCmdlet.ShouldProcess($transactionTarget, 'Install router and apply eligible global Cargo/User wrapper settings as one transaction')
    Write-Output ([pscustomobject]@{
        RouterPath = $destination
        Planned = $true
        CompilePlanned = -not $receiptCurrent
        RouterReplacementPlanned = -not $receiptCurrent
        CargoConfigPlanned = ($null -ne $configTarget -and $configText -cne $configTarget.Text)
        UserRustcWrapperPlanned = ($setUserWrapper -and $userWrapper.Value -cne $destination)
        ReceiptCurrent = [bool]$receiptCurrent
        CustomWrappersPreserved = [bool]($processCustom -or $machineCustom -or $userCustom -or @($cargoBuildCustom).Count -gt 0 -or @($customConfig).Count -gt 0)
    })
    return
}

Test-DirectoryWritable -Directory (Split-Path -Parent $destination)
if ($null -ne $configTarget) { Test-DirectoryWritable -Directory (Split-Path -Parent $configTarget.Path) }

$temporaryRouter = Join-Path (Split-Path -Parent $destination) ('.aphrody-rustc-router.' + [guid]::NewGuid().ToString('N') + '.exe')
$needCompile = -not $receiptCurrent
$routerChanged = $false
$stampChanged = $false
$configChanged = $false
$userChanged = $false
$routerBackup = $destination + '.aphrody-backup-' + [guid]::NewGuid().ToString('N')
$stampBackup = $receiptPath + '.aphrody-backup-' + [guid]::NewGuid().ToString('N')
$configBackup = if ($null -ne $configTarget) { $configTarget.Path + '.aphrody-backup-' + [guid]::NewGuid().ToString('N') } else { $null }
$oldUserWrapper = $userWrapper.Value
$oldConfigBytes = if ($null -ne $configTarget -and $configTarget.Exists) { [IO.File]::ReadAllBytes($configTarget.Path) } else { $null }
$oldStampExists = [IO.File]::Exists($receiptPath)
$oldStampBytes = if ($oldStampExists) { [IO.File]::ReadAllBytes($receiptPath) } else { $null }
$transactionTargets = @($destination, $receiptPath)
if ($null -ne $configTarget -and $configText -cne $configTarget.Text) { $transactionTargets += $configTarget.Path }
if ($setUserWrapper -and $userWrapper.Value -cne $destination) { $transactionTargets += 'User RUSTC_WRAPPER' }
$transactionTarget = $transactionTargets -join '; '

try {
    if (-not $PSCmdlet.ShouldProcess($transactionTarget, 'Install router and apply eligible global Cargo/User wrapper settings as one transaction')) {
        return
    }
    if ($needCompile) {
        & $rustcPath @buildOptions $sourcePath -o $temporaryRouter
        if ($LASTEXITCODE -ne 0) { throw "rustc failed to compile the router (exit $LASTEXITCODE)." }
        if ((Get-PathSha256 -Path $sourcePath) -ne $sourceHash) { throw 'Router source changed while the installer was compiling it.' }
        if ((Get-PathSha256 -Path $rustcPath) -ne $rustcHash -or ((& $rustcPath --version --verbose | Out-String).Trim() -cne $rustcVersion)) { throw 'rustc changed while the installer was compiling the router.' }
        if ($linkerPath -and (Get-PathSha256 -Path $linkerPath) -ne $linkerHash) { throw 'The selected linker changed while compiling the router.' }
        $newHash = Get-PathSha256 -Path $temporaryRouter
    } else {
        $newHash = $installedHash
    }
    $sameBinary = $installed -and $installedHash -ceq $newHash
    $receipt = [ordered]@{
        Schema = 1
        BuildFingerprint = $buildFingerprint
        SourceSha256 = $sourceHash
        RustcPath = [IO.Path]::GetFullPath($rustcPath)
        RustcSha256 = $rustcHash
        RustcVersion = $rustcVersion
        LinkerPath = $linkerPath
        LinkerSha256 = $linkerHash
        BuildOptions = $buildOptions
        RouterSha256 = $newHash
    }
    $receiptText = (ConvertTo-Json -InputObject $receipt -Compress -Depth 5) + "`n"
    $receiptBytes = [Text.UTF8Encoding]::new($false).GetBytes($receiptText)
    $configBytes = if ($null -ne $configTarget) {
        $prefix = if ($configTarget.Exists -and $configTarget.Encoding.GetPreamble().Length -gt 0) { $configTarget.Encoding.GetPreamble() } else { [byte[]]@() }
        $body = $configTarget.Encoding.GetBytes($configText)
        [byte[]]($prefix + $body)
    } else { $null }

    if ($needCompile -and (Get-PathSha256 -Path $sourcePath) -ne $sourceHash) { throw 'Router source changed before installation; no config changes were applied.' }
    $nowInstalledHash = if ([IO.File]::Exists($destination)) { Get-PathSha256 -Path $destination } else { $null }
    if ($nowInstalledHash -cne $installedHash) { throw 'Installed router changed during preflight; no changes were applied.' }
    if ($null -ne $configTarget) {
        $nowExists = [IO.File]::Exists($configTarget.Path)
        if ($nowExists -ne $configTarget.Exists) { throw 'Cargo config presence changed during preflight; no changes were applied.' }
        if ($nowExists -and -not [Linq.Enumerable]::SequenceEqual([byte[]]$oldConfigBytes, [byte[]][IO.File]::ReadAllBytes($configTarget.Path))) { throw 'Cargo config changed during preflight; no changes were applied.' }
    }
    $nowStampExists = [IO.File]::Exists($receiptPath)
    if ($nowStampExists -ne $oldStampExists) { throw 'Install receipt presence changed during preflight; no changes were applied.' }
    if ($nowStampExists -and -not [Linq.Enumerable]::SequenceEqual([byte[]]$oldStampBytes, [byte[]][IO.File]::ReadAllBytes($receiptPath))) { throw 'Install receipt changed during preflight; no changes were applied.' }
    $currentUserWrapper = Get-EnvironmentValue -Name 'RUSTC_WRAPPER' -Target User
    if ($currentUserWrapper.Exists -ne $userWrapper.Exists -or $currentUserWrapper.Value -cne $userWrapper.Value) { throw 'User RUSTC_WRAPPER changed during preflight; no changes were applied.' }

    if ($sameBinary) {
        Write-Verbose 'Installed router has the same SHA-256; keeping the existing executable in place.'
    } else {
        if ($installed) {
            try { [IO.File]::Replace($temporaryRouter, $destination, $routerBackup, $true) }
            catch { throw "Cannot atomically replace the installed router (it may be running): $($_.Exception.Message)" }
        } else {
            [IO.File]::Move($temporaryRouter, $destination)
        }
        $routerChanged = $true
    }

    if (-not $oldStampExists -or -not [Linq.Enumerable]::SequenceEqual([byte[]]$oldStampBytes, [byte[]]$receiptBytes)) {
        if ([IO.File]::Exists($receiptPath) -and -not [Linq.Enumerable]::SequenceEqual([byte[]]$oldStampBytes, [byte[]][IO.File]::ReadAllBytes($receiptPath))) { throw 'Install receipt changed before update; rolling back the router install.' }
        Write-AtomicFile -Path $receiptPath -Bytes $receiptBytes -BackupPath $stampBackup
        $stampChanged = $true
    }

    if ($null -ne $configTarget -and $configText -cne $configTarget.Text) {
        if ($needCompile -and (Get-PathSha256 -Path $sourcePath) -ne $sourceHash) { throw 'Router source changed before Cargo config update; rolling back the install.' }
        if ([IO.File]::Exists($configTarget.Path) -and -not [Linq.Enumerable]::SequenceEqual([byte[]]$oldConfigBytes, [byte[]][IO.File]::ReadAllBytes($configTarget.Path))) { throw 'Cargo config changed before update; rolling back the router install.' }
        Write-AtomicFile -Path $configTarget.Path -Bytes $configBytes -BackupPath $configBackup
        $configChanged = $true
    }

    if ($setUserWrapper -and $userWrapper.Value -cne $destination) {
        $currentUserWrapper = Get-EnvironmentValue -Name 'RUSTC_WRAPPER' -Target User
        if ($currentUserWrapper.Exists -ne $userWrapper.Exists -or $currentUserWrapper.Value -cne $userWrapper.Value) { throw 'User RUSTC_WRAPPER changed before update; rolling back the install.' }
        [Environment]::SetEnvironmentVariable('RUSTC_WRAPPER', $destination, 'User')
        $userChanged = $true
        $observed = [Environment]::GetEnvironmentVariable('RUSTC_WRAPPER', 'User')
        if ($observed -cne $destination) { throw 'Windows did not persist the user RUSTC_WRAPPER value.' }
    }

    if (-not $WhatIfPreference -and ($routerChanged -or $configChanged -or $userChanged)) {
        try { Send-EnvironmentChanged }
        catch { Write-Warning "The install succeeded, but WM_SETTINGCHANGE could not be broadcast: $($_.Exception.Message)" }
    }
    Write-Output ([pscustomobject]@{
        RouterPath = $destination
        SourceSha256 = $sourceHash
        RustcVersion = $rustcVersion
        RouterSha256 = $newHash
        BuildFingerprint = $buildFingerprint
        CompileSkipped = -not $needCompile
        RouterChanged = $routerChanged
        ReceiptChanged = $stampChanged
        CargoConfigChanged = $configChanged
        UserRustcWrapperChanged = $userChanged
        CustomWrappersPreserved = [bool]($processCustom -or $machineCustom -or $userCustom -or @($cargoBuildCustom).Count -gt 0 -or @($customConfig).Count -gt 0)
    })
} catch {
    if ($userChanged) { [Environment]::SetEnvironmentVariable('RUSTC_WRAPPER', $oldUserWrapper, 'User') }
    if ($configChanged) {
        if ($null -ne $oldConfigBytes) { Write-AtomicFile -Path $configTarget.Path -Bytes $oldConfigBytes -BackupPath ($configTarget.Path + '.rollback-' + [guid]::NewGuid().ToString('N')) }
        elseif ([IO.File]::Exists($configTarget.Path)) { [IO.File]::Delete($configTarget.Path) }
    }
    if ($stampChanged) {
        if ($oldStampExists) { Write-AtomicFile -Path $receiptPath -Bytes $oldStampBytes -BackupPath ($receiptPath + '.rollback-' + [guid]::NewGuid().ToString('N')) }
        elseif ([IO.File]::Exists($receiptPath)) { [IO.File]::Delete($receiptPath) }
    }
    if ($routerChanged) {
        if ([IO.File]::Exists($routerBackup)) { [IO.File]::Replace($routerBackup, $destination, $null, $true) }
        elseif ([IO.File]::Exists($destination)) { [IO.File]::Delete($destination) }
    }
    throw
} finally {
    if ([IO.File]::Exists($temporaryRouter)) { [IO.File]::Delete($temporaryRouter) }
}
