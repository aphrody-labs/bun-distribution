#Requires -Version 7.2
# SPDX-License-Identifier: Apache-2.0
# Uses the installed Rust capability-owner CLI; no copied provider credentials.
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('EnsureA', 'PresentDns01', 'CleanupDns01')][string]$Action = 'EnsureA',
    [string]$Zone = 'aphrody.com',
    [string]$HostName = 'vps.aphrody.com',
    [string]$IPv4,
    [Parameter(Mandatory)][string]$BackupDirectory,
    [string]$StateFile,
    [string]$Dns01Value,
    [string]$Profile,
    [ValidateRange(60, 86400)][int]$Ttl = 300,
    [switch]$Apply,
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Apply -and $DryRun) { throw 'Choose Apply or DryRun.' }
if ($Zone -ne 'aphrody.com' -or $HostName -ne 'vps.aphrody.com') {
    throw 'This owned rollout is scoped to vps.aphrody.com; apex and existing domain routes are preserved.'
}
if (-not [IO.Path]::IsPathFullyQualified($BackupDirectory)) { throw 'BackupDirectory must be absolute.' }
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../docs/aphrody'))
if ($backupRoot.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $backupRoot -eq $sourceRoot) {
    throw 'Zone backups must stay outside the repository in the configured protected store.'
}
if ($StateFile) {
    if (-not [IO.Path]::IsPathFullyQualified($StateFile)) { throw 'StateFile must be absolute.' }
    $StateFile = [IO.Path]::GetFullPath($StateFile)
    if (-not $StateFile.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'StateFile must be inside the configured protected backup directory.'
    }
}
if ($Action -eq 'EnsureA') {
    $parsedAddress = $null
    if (-not [Net.IPAddress]::TryParse($IPv4, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
        throw 'EnsureA requires an explicit IPv4 address.'
    }
} elseif (-not $StateFile) { throw 'DNS01 lifecycle requires a caller-specific StateFile.' }
if ($Action -eq 'PresentDns01' -and $Dns01Value -notmatch '^[A-Za-z0-9_-]{20,256}$') {
    throw 'DNS01 value must be the ACME base64url challenge digest, not an account/private key.'
}

function Invoke-OvhOwner {
    param([string[]]$Arguments)
    $nativeArgs = @('ovh', 'dns') + $Arguments
    if ($Profile) { $nativeArgs += @('--profile', $Profile) }
    $result = @(& aphrody @nativeArgs)
    if ($LASTEXITCODE -ne 0) { throw "Native OVH command failed: $($Arguments[0])." }
    return $result
}

function Get-ZoneRecords {
    $lines = @(Invoke-OvhOwner -Arguments @('records', $Zone))
    foreach ($line in $lines) {
        if ($line -match '^\s*(?<id>\d+)\s+(?<type>[A-Z0-9]+)\s+(?<name>\S+)\s+(?<ttl>\d+)\s+(?<target>.+?)\s*$') {
            [pscustomobject]@{ id = $Matches.id; type = $Matches.type; name = $Matches.name; ttl = [int]$Matches.ttl; target = $Matches.target.Trim('"') }
        } elseif ($line -match '^\s*\d+\s+') { throw 'Unrecognized native DNS record output; no mutation is permitted.' }
    }
}

function Backup-Zone {
    $null = New-Item -ItemType Directory -Path $backupRoot -Force
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $zonePath = Join-Path $backupRoot ($Zone + '.' + $stamp + '.zone')
    $null = Invoke-OvhOwner -Arguments @('export', $Zone, '--output', $zonePath)
    if (-not (Test-Path -LiteralPath $zonePath -PathType Leaf) -or (Get-Item -LiteralPath $zonePath).Length -eq 0) { throw 'Zone export did not produce a nonempty backup.' }
    $hash = (Get-FileHash -LiteralPath $zonePath -Algorithm SHA256).Hash
    # Separate verified copy before any DNS mutation, not an export-path claim.
    $verifiedPath = $zonePath + '.verified'
    Copy-Item -LiteralPath $zonePath -Destination $verifiedPath
    if ((Get-FileHash -LiteralPath $verifiedPath -Algorithm SHA256).Hash -ne $hash) { throw 'Zone backup checksum verification failed.' }
    [IO.File]::WriteAllText($zonePath + '.sha256', $hash + "`n", [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ path = $zonePath; sha256 = $hash }
}

function Write-RecordState {
    param([object]$Record, [object]$Backup)
    if (-not $StateFile) { return }
    $value = @{ schema = 'aphrody.native-dns.v1'; zone = $Zone; hostname = $HostName; id = $Record.id; type = $Record.type; name = $Record.name; target = $Record.target; owned = $true; backup = $Backup.path; backupSha256 = $Backup.sha256; createdUtc = [DateTime]::UtcNow.ToString('o') }
    $temporary = $StateFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $StateFile -Force
}

$records = @(Get-ZoneRecords)
$recordName = if ($Action -eq 'EnsureA') { 'vps' } else { '_acme-challenge.vps' }
$type = if ($Action -eq 'EnsureA') { 'A' } else { 'TXT' }
$target = if ($Action -eq 'EnsureA') { $IPv4 } else { $Dns01Value }
$existing = @($records | Where-Object { $_.name -eq $recordName })
$matchesTarget = @($existing | Where-Object { $_.type -eq $type -and $_.target -eq $target })
if ($Action -eq 'EnsureA' -and $existing.Count -gt 0) {
    if ($matchesTarget.Count -eq 1 -and $existing.Count -eq 1) {
        [pscustomobject]@{ mode = 'unchanged'; hostname = $HostName; id = $matchesTarget[0].id; target = $IPv4; preservedExistingRecords = $true }; return
    }
    throw 'The hostname already has a conflicting record; never replace or delete it implicitly.'
}
if ($Action -eq 'PresentDns01' -and $matchesTarget.Count -gt 0) {
    [pscustomobject]@{ mode = 'unchanged'; hostname = $HostName; existingChallenge = $true; cleanupRequiresOwnedState = $true }; return
}
if ($Action -eq 'PresentDns01' -and @($existing | Where-Object type -ne 'TXT').Count -gt 0) { throw 'Challenge name has a conflicting non-TXT record.' }
if ($Action -eq 'CleanupDns01') {
    if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) { throw 'No owned challenge state; cleanup is refused.' }
    $owned = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    if ($owned.schema -ne 'aphrody.native-dns.v1' -or $owned.owned -ne $true -or $owned.zone -ne $Zone -or $owned.hostname -ne $HostName -or $owned.type -ne 'TXT' -or $owned.name -ne '_acme-challenge.vps') { throw 'Challenge state does not establish scoped ownership.' }
    $current = @($records | Where-Object { $_.id -eq $owned.id -and $_.name -eq $owned.name -and $_.type -eq 'TXT' -and $_.target -eq $owned.target })
    if ($current.Count -ne 1) { throw 'Owned TXT record no longer matches; no DNS record will be deleted.' }
    $target = $owned.target
}
[pscustomobject]@{ mode = if ($Apply) { 'apply' } else { 'plan' }; action = $Action; hostname = $HostName; recordName = $recordName; recordType = $type; createsOnlyNewRecord = $Action -ne 'CleanupDns01'; protectsApexAndOtherNames = $true; backupRequired = $true }
if (-not $Apply -or $DryRun -or $WhatIfPreference) { return }
if (-not $PSCmdlet.ShouldProcess($HostName, "$Action through native OVH owner after verified protected backup")) { return }
$backup = Backup-Zone
if ($Action -eq 'CleanupDns01') {
    $null = Invoke-OvhOwner -Arguments @('delete', $Zone, [string]$owned.id, '--apply')
} else {
    if ($StateFile -and (Test-Path -LiteralPath $StateFile)) { throw 'StateFile already exists; use a separate owned operation state.' }
    $null = Invoke-OvhOwner -Arguments @('add', $Zone, $type, $recordName, $target, '--ttl', [string]$Ttl, '--apply')
    $created = @(Get-ZoneRecords | Where-Object { $_.name -eq $recordName -and $_.type -eq $type -and $_.target -eq $target })
    if ($created.Count -ne 1) { throw 'Cannot establish exact newly created record ownership; inspect the protected backup before recovery.' }
    Write-RecordState -Record $created[0] -Backup $backup
}
$null = Invoke-OvhOwner -Arguments @('refresh', $Zone, '--apply')
if ($Action -eq 'CleanupDns01') { Remove-Item -LiteralPath $StateFile }
[pscustomobject]@{ mode = 'applied'; action = $Action; hostname = $HostName; backup = $backup.path; backupSha256 = $backup.sha256; propagationVerified = $false }
