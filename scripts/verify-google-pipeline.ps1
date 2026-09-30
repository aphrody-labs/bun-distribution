[CmdletBinding()]
param(
    # aphrody-ai: aphrody-google crate, @aphrody/google, the Python facade and doc-ai.
    [string]$AphrodyRoot = (Join-Path $PSScriptRoot '..\..\aphrody-ai'),
    # aphrody-web: the BXC Google/Gemini web implementation (adapters.bun.webImplementation).
    [Alias('OsRoot')]
    [string]$WebRoot = (Join-Path $PSScriptRoot '..\..\aphrody-web')
)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '..\config\google-gemini-pipeline.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

if ($config.repositories.nie.project -ne 'aphrody' -or $config.repositories.dbfr.project -ne 'aphrody') {
    throw 'DBFR/NIE doivent cibler aphrody.'
}
if ($config.repositories.rg.project -ne 'rgfr') {
    throw 'RG doit cibler rgfr.'
}
if ($config.binary -ne 'aphrody-google') { throw 'Le binaire canonique doit être aphrody-google.' }

$required = @(
    (Join-Path $AphrodyRoot 'crates\aphrody-google\src\lib.rs'),
    (Join-Path $AphrodyRoot 'packages\google\src\index.ts'),
    (Join-Path $AphrodyRoot 'packages\google\src\vertex.ts'),
    (Join-Path $AphrodyRoot 'py\aphrody\aphrody\google.py'),
    (Join-Path $AphrodyRoot 'packages\doc-ai\src\llm.ts'),
    # Web implementation declared by adapters.bun.webImplementation.
    (Join-Path $WebRoot 'apps\bxc\src\google\index.ts')
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Point d'entrée manquant: $path" }
}

$forbidden = @('GEMINI_API_KEY=', 'GOOGLE_API_KEY=')
$scanRoots = @(
    (Join-Path $AphrodyRoot 'packages\google'),
    (Join-Path $AphrodyRoot 'py\aphrody\aphrody'),
    (Join-Path $AphrodyRoot 'packages\doc-ai')
)
foreach ($root in $scanRoots) {
    foreach ($needle in $forbidden) {
        $hits = rg --fixed-strings --line-number --glob '*.ts' --glob '*.py' $needle $root 2>$null
        if ($LASTEXITCODE -eq 0 -and $hits) { throw "Référence API-key interdite dans $root" }
    }
}

Write-Output 'GOOGLE_PIPELINE: PASS'
Write-Output "projects: aphrody-ai=$($config.repositories.'aphrody-ai'.project), nie=$($config.repositories.nie.project), dbfr=$($config.repositories.dbfr.project), rg=$($config.repositories.rg.project)"
Write-Output 'facades: rust,bun,python,web=present'
