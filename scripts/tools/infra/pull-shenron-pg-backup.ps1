param(
    [string]$Destination = $env:SHENRON_OFFSITE_DIR
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $env:USERPROFILE 'vps-offload\db-backups\shenron\dbfr'
}
if ([string]::IsNullOrWhiteSpace($env:SHENRON_REMOTE_HOME)) {
    throw 'Set SHENRON_REMOTE_HOME to the absolute home directory of the remote account.'
}
$remoteHome = $env:SHENRON_REMOTE_HOME.TrimEnd('/')
$datasets = @(
    [pscustomobject]@{
        Name = 'postgresql'
        RemoteDir = "$remoteHome/shenron/data/backups/shenron-pg"
        ManifestPattern = 'shenron_site-*.sql.gz.sha256'
        ArtifactPattern = '^shenron_site-[0-9]{8}-[0-9]{6}\.sql\.gz$'
        Destination = $Destination
    },
    [pscustomobject]@{
        Name = 'sqlite-replica'
        RemoteDir = "$remoteHome/shenron/data/backups/shenron-sqlite"
        ManifestPattern = 'bot-*.db.gz.sha256'
        ArtifactPattern = '^bot-[0-9]{8}-[0-9]{6}\.db\.gz$'
        Destination = (Join-Path $Destination 'sqlite')
    }
)
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
$runLog = Join-Path $Destination 'pull-status.log'
function Write-BackupLog([string]$Message) {
    Add-Content -LiteralPath $runLog -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}
foreach ($dataset in $datasets) {
    [System.IO.Directory]::CreateDirectory($dataset.Destination) | Out-Null
}
Write-BackupLog 'start'

$verified = 0
foreach ($dataset in $datasets) {
    $manifests = & $ssh @sshOptions dbfr "find '$($dataset.RemoteDir)' -maxdepth 1 -type f -name '$($dataset.ManifestPattern)' -exec cat {} +"
    if ($LASTEXITCODE -ne 0) { throw "Could not list $($dataset.Name) backup manifests on DBFR." }
    if (-not $manifests) { throw "No verified $($dataset.Name) backups are available on DBFR." }
    Write-BackupLog "dataset=$($dataset.Name) manifests=$($manifests.Count)"

    foreach ($line in $manifests) {
        $match = [regex]::Match([string]$line, '^([0-9a-f]{64})\s+(.+)$')
        if (-not $match.Success) { throw "A $($dataset.Name) checksum manifest is malformed." }
        $expectedHash = $match.Groups[1].Value
        $name = [System.IO.Path]::GetFileName($match.Groups[2].Value)
        if ($name -notmatch $dataset.ArtifactPattern) {
            throw "DBFR returned an unexpected $($dataset.Name) filename."
        }

        $finalPath = Join-Path $dataset.Destination $name
        if ([System.IO.File]::Exists($finalPath)) {
            $existingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalPath).Hash.ToLowerInvariant()
            if ($existingHash -eq $expectedHash) {
                & $ssh @sshOptions dbfr "touch '$($dataset.RemoteDir)/$name.offsite-verified'"
                if ($LASTEXITCODE -ne 0) { throw "Could not acknowledge off-host copy for $name." }
                Write-BackupLog "verified-existing=$($dataset.Name)/$name"
                $verified++
                continue
            }
        }

        $base64Path = Join-Path $dataset.Destination "$name.b64.partial"
        $partialPath = Join-Path $dataset.Destination "$name.partial"
        try {
            & $ssh @sshOptions dbfr "base64 -w0 '$($dataset.RemoteDir)/$name'" | Set-Content -LiteralPath $base64Path -NoNewline -Encoding ascii
            if ($LASTEXITCODE -ne 0) { throw "SSH transfer failed for $name." }
            $encoded = [System.IO.File]::ReadAllText($base64Path)
            $bytes = [Convert]::FromBase64String($encoded)
            [System.IO.File]::WriteAllBytes($partialPath, $bytes)
            $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $partialPath).Hash.ToLowerInvariant()
            if ($actualHash -ne $expectedHash) { throw "Off-host SHA-256 mismatch for $name." }
            if ([System.IO.File]::Exists($finalPath)) {
                [System.IO.File]::Replace($partialPath, $finalPath, $null)
            } else {
                [System.IO.File]::Move($partialPath, $finalPath)
            }
            [System.IO.File]::WriteAllText("$finalPath.sha256", "$actualHash  $name`n", [Text.Encoding]::ASCII)
            & $ssh @sshOptions dbfr "touch '$($dataset.RemoteDir)/$name.offsite-verified'"
            if ($LASTEXITCODE -ne 0) { throw "Could not acknowledge off-host copy for $name." }
            Write-BackupLog "transferred=$($dataset.Name)/$name"
            Write-Output "Off-host backup verified: $($dataset.Name)/$name ($($bytes.Length) bytes)."
            $bytes = $null
            $verified++
        } finally {
            if ([System.IO.File]::Exists($base64Path)) { [System.IO.File]::Delete($base64Path) }
            if ([System.IO.File]::Exists($partialPath)) { [System.IO.File]::Delete($partialPath) }
        }
    }
}

$cutoff = [DateTime]::UtcNow.AddDays(-14)
foreach ($dataset in $datasets) {
    Get-ChildItem -LiteralPath $dataset.Destination -File |
        Where-Object { $_.Name -match '\.(sql\.gz|db\.gz)$' -and $_.LastWriteTimeUtc -lt $cutoff } |
        ForEach-Object {
            [System.IO.File]::Delete($_.FullName)
            $sidecar = "$($_.FullName).sha256"
            if ([System.IO.File]::Exists($sidecar)) { [System.IO.File]::Delete($sidecar) }
        }
}

Write-Output "Off-host Shenron backup set verified: $verified file(s)."
Write-BackupLog "complete=$verified"
