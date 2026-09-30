[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Start-Containers {
    param([Parameter(Mandatory)][string[]]$Names)
    & docker start @Names | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Démarrage Docker impossible : $($Names -join ', ')." }
}

# Les conteneurs créés par replicate.ps1 gardent leurs variables d'environnement.
# Aucun accès au VPS ni fichier de secret n'est nécessaire aux redémarrages.
Start-Containers @('vps-replica-postgres', 'vps-replica-redis', 'vps-replica-aphrody-site')

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec vps-replica-postgres pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'PostgreSQL Docker ne répond pas après 30 secondes.' }

Start-Containers @(
    'vps-replica-postgrest',
    'vps-replica-storage',
    'vps-replica-achillea-storage',
    'vps-replica-realtime'
)

& docker restart vps-replica-nginx | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Le proxy Nginx Docker ne redémarre pas.' }

Write-Output 'Réplique Docker démarrée ; vérification : .\infra\docker\vps-replica\verify.ps1'
