$ErrorActionPreference = 'Stop'
$config = Join-Path $PSScriptRoot 'aphrody/aphrody-apex.conf'
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$scratch = Join-Path $tempRoot ("aphrody-nginx-check-" + [guid]::NewGuid().ToString('N'))
try {
    $certDir = Join-Path $scratch 'live/aphrody.com'
    New-Item -ItemType Directory -Path $certDir -Force | Out-Null
    $drive = $scratch.Substring(0, 1).ToLowerInvariant()
    $tail = $scratch.Substring(2).Replace('\', '/')
    $linuxScratch = "/mnt/$drive$tail"
    wsl.exe -- openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=aphrody.com -keyout "$linuxScratch/live/aphrody.com/privkey.pem" -out "$linuxScratch/live/aphrody.com/fullchain.pem" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'dummy certificate generation failed' }
    wsl.exe -- openssl dhparam -dsaparam -out "$linuxScratch/ssl-dhparams.pem" 2048 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'dummy DH parameter generation failed' }
    Set-Content -LiteralPath (Join-Path $scratch 'options-ssl-nginx.conf') -Value '# syntax check only'
    docker run --rm --mount "type=bind,source=$config,target=/etc/nginx/conf.d/aphrody-apex.conf,readonly" --mount "type=bind,source=$scratch,target=/etc/letsencrypt,readonly" nginx:alpine nginx -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx -t failed' }
} finally {
    if (Test-Path -LiteralPath $scratch) {
        $resolved = [System.IO.Path]::GetFullPath($scratch)
        if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not ([System.IO.Path]::GetFileName($resolved) -match '^aphrody-nginx-check-[0-9a-f]{32}$')) {
            throw "unsafe scratch cleanup path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
