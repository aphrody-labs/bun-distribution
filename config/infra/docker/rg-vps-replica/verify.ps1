[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$tableFingerprintQuery = @'
SELECT format(
  'SELECT %L, count(*)::bigint, coalesce(bit_xor(hashtextextended(to_jsonb(t)::text, 0))::text, ''0'') FROM %I.%I t',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
ORDER BY schemaname, tablename
\gexec
'@

$allOk = $true
foreach ($db in @('achillea', 'aphrody', 'postgres', 'rg', 'stack')) {
    $source = @($tableFingerprintQuery | & ssh ovh-vps "sudo -u postgres psql -d $db -At -v ON_ERROR_STOP=1")
    if ($LASTEXITCODE -ne 0) { throw "Inventaire VPS de $db impossible." }
    $replica = @($tableFingerprintQuery | & docker exec -i vps-replica-postgres psql -U postgres -d $db -At -v ON_ERROR_STOP=1)
    if ($LASTEXITCODE -ne 0) { throw "Inventaire Docker de $db impossible." }

    $difference = @(Compare-Object -ReferenceObject $source -DifferenceObject $replica)
    $sourceRows = 0L
    foreach ($line in $source) {
        $parts = $line -split '\|', 3
        if ($parts.Count -eq 3) { $sourceRows += [long]$parts[1] }
    }
    $equal = $difference.Count -eq 0
    if (-not $equal) { $allOk = $false }
    [pscustomobject]@{database=$db; tables=$source.Count; rows=$sourceRows; fingerprintEqual=$equal; differingRecords=$difference.Count} | ConvertTo-Json -Compress

    $extensionQuery = 'select extname || '':'' || extversion from pg_extension order by extname;'
    $sourceExtensions = @($extensionQuery | & ssh ovh-vps "sudo -u postgres psql -d $db -At -v ON_ERROR_STOP=1")
    if ($LASTEXITCODE -ne 0) { throw "Extensions VPS de $db indisponibles." }
    $replicaExtensions = @($extensionQuery | & docker exec -i vps-replica-postgres psql -U postgres -d $db -At -v ON_ERROR_STOP=1)
    if ($LASTEXITCODE -ne 0) { throw "Extensions Docker de $db indisponibles." }
    $extensionsEqual = @(Compare-Object -ReferenceObject $sourceExtensions -DifferenceObject $replicaExtensions).Count -eq 0
    if (-not $extensionsEqual) { $allOk = $false }
    [pscustomobject]@{database=$db; extensions=$replicaExtensions.Count; versionsEqual=$extensionsEqual} | ConvertTo-Json -Compress
}

$roleSource = (& ssh ovh-vps 'sudo -u postgres psql -Atc "select count(*) from pg_roles"' | Out-String).Trim()
$roleReplica = (& docker exec vps-replica-postgres psql -U postgres -Atc 'select count(*) from pg_roles' | Out-String).Trim()
$rolesOk = [int]$roleReplica -eq [int]$roleSource
if (-not $rolesOk) { $allOk = $false }
[pscustomobject]@{sourceRoles=[int]$roleSource; replicaRoles=[int]$roleReplica; rolesOk=$rolesOk} | ConvertTo-Json -Compress

& docker exec vps-replica-achillea-storage sh -c 'case "$DATABASE_URL" in */rg) exit 0;; *) exit 1;; esac'
$achilleaUsesRg = $LASTEXITCODE -eq 0
if (-not $achilleaUsesRg) { $allOk = $false }
[pscustomobject]@{achilleaStorageDatabase='rg'; usesUnifiedDatabase=$achilleaUsesRg} | ConvertTo-Json -Compress

$redisInfo = (& docker exec vps-replica-redis redis-cli --raw INFO keyspace | Out-String)
$redisKeys = 0L
$redisDbs = @()
foreach ($line in ($redisInfo -split "`n")) {
    if ($line -match '^db(\d+):keys=(\d+)') {
        $redisDbs += [int]$matches[1]
        $redisKeys += [long]$matches[2]
    }
}
$redisOk = $redisKeys -gt 0 -and $redisKeys -le 1047995
if (-not $redisOk) { $allOk = $false }
[pscustomobject]@{redisDatabases=$redisDbs; redisKeys=$redisKeys; rdbKeys=1047995; expiredSinceRdb=(1047995 - $redisKeys); redisOk=$redisOk} | ConvertTo-Json -Compress

$siteHashSource = ((& ssh ovh-vps 'sha256sum /srv/aphrody/current/bin/aphrody-site' | Out-String).Trim() -split '\s+')[0]
$siteHashReplica = ((& docker run --rm --entrypoint sha256sum --mount 'type=volume,source=vps-replica-website-release,target=/release,readonly' vps-replica-postgres:local /release/bin/aphrody-site | Out-String).Trim() -split '\s+')[0]
$siteHashOk = $siteHashSource -eq $siteHashReplica
if (-not $siteHashOk) { $allOk = $false }
[pscustomobject]@{siteBinarySha256=$siteHashReplica; siteBinaryEqual=$siteHashOk} | ConvertTo-Json -Compress

foreach ($endpoint in @(
    @{port=8088; path='/healthz'; expected=200},
    @{port=8810; path='/health'; expected=200},
    @{port=8811; path='/health'; expected=200},
    @{port=8811; path='/rest/v1/'; expected=200},
    @{port=8812; path='/health'; expected=200},
    @{port=8821; path='/health'; expected=200},
    @{port=8822; path='/health'; expected=200},
    @{port=8823; path='/health'; expected=200},
    @{port=8823; path='/rest/v1/'; expected=200},
    @{port=8823; path='/rest/v1/user?select=id&limit=1'; expected=200},
    @{port=8811; path='/auth/v1/'; expected=410}
)) {
    $url = "http://127.0.0.1:$($endpoint.port)$($endpoint.path)"
    $code = 0
    for ($attempt = 0; $attempt -lt 3 -and $code -eq 0; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -SkipHttpErrorCheck -TimeoutSec 5
            $code = [int]$response.StatusCode
        }
        catch {
            if ($attempt -lt 2) { Start-Sleep -Seconds 1 }
        }
    }
    $ok = $code -eq $endpoint.expected
    if (-not $ok) { $allOk = $false }
    [pscustomobject]@{port=$endpoint.port; path=$endpoint.path; status=$code; expected=$endpoint.expected; ok=$ok} | ConvertTo-Json -Compress
}

if (-not $allOk) { exit 1 }
