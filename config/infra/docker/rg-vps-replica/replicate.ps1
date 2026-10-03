[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
$composeArgs = @('compose', '-f', $composeFile)
$volumeNames = @(
    'vps-replica-postgres-data',
    'vps-replica-postgres-extensions',
    'vps-replica-redis-data',
    'vps-replica-website-release',
    'vps-replica-www-data'
)

function Invoke-Native {
    param([Parameter(Mandatory)][string]$File, [Parameter(Mandatory)][string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File a échoué ($LASTEXITCODE)." }
}

function Ensure-EmptyVolume {
    param([Parameter(Mandatory)][string]$Name)
    $existing = & docker volume inspect $Name 2>$null
    if ($LASTEXITCODE -ne 0) { Invoke-Native docker @('volume', 'create', $Name) | Out-Null }
    $emptyCheck = @(
        'run', '--rm', '--entrypoint', 'bash', '--mount', "type=volume,source=$Name,target=/data",
        'pgvector/pgvector:pg18', '-lc', 'test -z "$(find /data -mindepth 1 -print -quit)"'
    )
    & docker @emptyCheck
    if ($LASTEXITCODE -ne 0) { throw "Le volume Docker $Name existe déjà et n’est pas vide; aucune donnée n’a été écrasée." }
}

function Copy-RemoteTarToVolume {
    param([Parameter(Mandatory)][string]$RemoteCommand, [Parameter(Mandatory)][string]$Volume)
    $import = @(
        'run', '--rm', '-i', '--entrypoint', 'bash', '--mount', "type=volume,source=$Volume,target=/data",
        'pgvector/pgvector:pg18', '-lc', 'tar -xf - -C /data'
    )
    & ssh ovh-vps $RemoteCommand | & docker @import
    if ($LASTEXITCODE -ne 0) { throw "Le flux SSH vers le volume $Volume a échoué ($LASTEXITCODE)." }
}

function Get-VolumeTreeHash {
    param([Parameter(Mandatory)][string]$Volume)
    $arguments = @(
        'run', '--rm', '--entrypoint', 'bash', '--mount', "type=volume,source=$Volume,target=/data,readonly",
        'pgvector/pgvector:pg18', '-lc', 'cd /data && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d " " -f1'
    )
    $hash = (& docker @arguments | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $hash -notmatch '^[0-9a-f]{64}$') { throw "Calcul de l’empreinte du volume $Volume en échec." }
    return $hash
}

Push-Location $repoRoot
try {
    foreach ($port in @(5432, 16380, 8088, 8809, 8810, 8811, 8812, 8821, 8822, 8823)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            throw "Le port local $port est déjà occupé; la réplication est arrêtée avant écriture."
        }
    }

    foreach ($name in $volumeNames) { Ensure-EmptyVolume $name }

    $jwtLine = (& ssh ovh-vps 'sudo sed -n "s/^SUPABASE_JWT_SECRET=//p" /etc/rg-storage.env' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($jwtLine)) {
        throw 'SUPABASE_JWT_SECRET absent de la configuration Storage du VPS.'
    }
    $jwtSecret = $jwtLine.Trim().Trim('"').Trim("'")
    if ($jwtSecret.Length -lt 32) { throw 'Le secret JWT source est invalide.' }

    Write-Output 'Transfert des extensions PostgreSQL.'
    $extensionFiles = 'sudo bash -c ''cd / && tar -chf - usr/share/postgresql/18/extension/pg_net.control usr/share/postgresql/18/extension/pg_net--*.sql usr/share/postgresql/18/extension/supabase_vault.control usr/share/postgresql/18/extension/supabase_vault--*.sql usr/share/postgresql/18/extension/pg_graphql.control usr/share/postgresql/18/extension/pg_graphql--*.sql usr/lib/postgresql/18/lib/pg_net.so usr/lib/postgresql/18/lib/supabase_vault.so usr/lib/postgresql/18/lib/pg_graphql.so'''
    Copy-RemoteTarToVolume $extensionFiles 'vps-replica-postgres-extensions'

    $redisStream = @(
        'run', '--rm', '-i', '--entrypoint', 'bash', '--mount',
        'type=volume,source=vps-replica-redis-data,target=/data',
        'pgvector/pgvector:pg18', '-lc', 'cat > /data/dump.rdb && chmod 0644 /data/dump.rdb'
    )
    Write-Output 'Transfert du RDB Redis.'
    & ssh ovh-vps 'sudo cat /var/lib/redis/dump.rdb' | & docker @redisStream
    if ($LASTEXITCODE -ne 0) { throw "Le transfert du RDB Redis a échoué ($LASTEXITCODE)." }

    Write-Output 'Transfert des fichiers /var/www.'
    Copy-RemoteTarToVolume 'sudo tar -C /var/www -chf - .' 'vps-replica-www-data'
    Copy-RemoteTarToVolume 'sudo tar -C /srv/aphrody/current -cf - .' 'vps-replica-website-release'

    $sourceRedisHash = (& ssh ovh-vps 'sudo sha256sum /var/lib/redis/dump.rdb | cut -d " " -f1' | Out-String).Trim()
    $replicaRedisHash = (& docker run --rm --entrypoint sha256sum --mount 'type=volume,source=vps-replica-redis-data,target=/data,readonly' pgvector/pgvector:pg18 /data/dump.rdb | ForEach-Object { ($_ -split '\s+')[0] } | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $sourceRedisHash -ne $replicaRedisHash) { throw "L’empreinte SHA-256 du RDB Redis ne correspond pas." }

    $sourceAssetsHash = (& ssh ovh-vps 'sudo bash -c ''cd /var/www && find -L . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d " " -f1''' | Out-String).Trim()
    $replicaAssetsHash = Get-VolumeTreeHash 'vps-replica-www-data'
    if ($LASTEXITCODE -ne 0 -or $sourceAssetsHash -ne $replicaAssetsHash) { throw "L’empreinte SHA-256 globale des fichiers /var/www ne correspond pas." }

    Write-Output 'Empreintes vérifiées; import des bases PostgreSQL et démarrage des services.'
    $env:SUPABASE_JWT_SECRET = $jwtSecret
    try {
        Invoke-Native docker ($composeArgs + @('up', '-d', '--build', 'postgres', 'redis'))
        Invoke-Native docker ($composeArgs + @('exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'postgres'))

        $dumpArguments = $composeArgs + @('exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres')
        & ssh ovh-vps 'sudo -u postgres pg_dumpall | sed -e "/^CREATE ROLE postgres;$/d" -e "/^ALTER ROLE postgres WITH /d"' | & docker @dumpArguments
        if ($LASTEXITCODE -ne 0) { throw "La réplication PostgreSQL en flux a échoué ($LASTEXITCODE)." }

        Invoke-Native docker ($composeArgs + @('up', '-d', '--build'))
        Invoke-Native docker @('restart', 'vps-replica-nginx')
        Invoke-Native docker ($composeArgs + @('ps'))
    }
    finally {
        Remove-Item Env:SUPABASE_JWT_SECRET -ErrorAction SilentlyContinue
        $jwtSecret = $null
        $jwtLine = $null
    }

    Write-Output "RDB Redis SHA-256: $replicaRedisHash"
    Write-Output "Arbores /var/www SHA-256 globales: $replicaAssetsHash"
    Write-Output 'PostgreSQL, Redis, Storage, Realtime, PostgREST, site et Nginx démarrés.'
}
finally {
    Pop-Location
}
