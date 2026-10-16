#Requires -Version 7.2
# SPDX-License-Identifier: Apache-2.0
# Activate a previously qualified isolated native site build through Infra.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$SourceManifestSha256,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$BinarySha256,
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../../docs/aphrody')).Path,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$unitPath = Join-Path $WorkspaceRoot 'infra/config/host/systemd/aphrody/aphrody-site.service'
if (!(Test-Path -LiteralPath $unitPath)) { throw 'Missing declared native site unit' }
$releaseId = 'native-site-' + $SourceManifestSha256.Substring(0,16)
$unitSha256 = (Get-FileHash -LiteralPath $unitPath -Algorithm SHA256).Hash.ToLowerInvariant()
$uiRoot = Join-Path $WorkspaceRoot 'crates/ui/app/ui-dist'
if (!(Test-Path -LiteralPath $uiRoot -PathType Container)) { throw 'Missing canonical app-ui artifact' }
$uiEntries = @(Get-ChildItem -LiteralPath $uiRoot -Recurse -Force)
if ((Get-Item -LiteralPath $uiRoot).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    @($uiEntries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
    throw 'Canonical app-ui artifact cannot contain links or junctions'
}
foreach ($required in @('index.html','app.js','app.css')) {
    if (!(Test-Path -LiteralPath (Join-Path $uiRoot $required) -PathType Leaf)) { throw "Missing canonical app-ui file: $required" }
}
$uiFiles = @($uiEntries | Where-Object { !$_.PSIsContainer } | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($uiRoot, $_.FullName).Replace('\','/')
    if ($relative -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or ($relative.Split('/') -contains '..')) { throw "Unsafe app-ui artifact path: $relative" }
    [pscustomobject]@{ Path = $relative; Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
} | Sort-Object Path -Culture '')
$uiManifest = ($uiFiles | ForEach-Object { $_.Hash + '  ' + $_.Path }) -join "`n"
$uiManifest += "`n"
$uiSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($uiManifest))).ToLowerInvariant()
$releaseId += '-' + $BinarySha256.Substring(0,12) + '-' + $uiSha256.Substring(0,12) + '-' + $unitSha256.Substring(0,8)
if (!$Apply) {
    Write-Output "Plan: qualified native build and $($uiFiles.Count) hash-verified app-ui files -> /home/ubuntu/apps/aphrody/releases/$releaseId; dedicated aphrody-site identity; port80; backing up current link, unit and active state; native Infra apply required"
    return
}
$catalog = Get-Content (Join-Path $WorkspaceRoot 'infra/config/service-catalog.json') -Raw | ConvertFrom-Json
$service = @($catalog.services | Where-Object id -EQ 'aphrody-site')
if ($service.Count -ne 1 -or $service[0].runtime -ne 'rust' -or $service[0].port -ne 80 -or $service[0].host -ne 'vps' -or $service[0].status -eq 'retired') {
    throw 'Catalog does not authorize the native VPS site on port80'
}
$script = @'
#!/usr/bin/env bash
set -Eeuo pipefail
factory=/home/ubuntu/native-site-factory
release=/home/ubuntu/apps/aphrody/releases/__RELEASE__
exec 9>"$factory/deploy.lock"
flock -n 9 || { echo 'Another native site deployment is active' >&2; exit 2; }
ui_archive="$factory/__UI_UPLOAD__.tar"
ui_manifest="$factory/__UI_UPLOAD__.SHA256SUMS"
unit_source="$factory/__UI_UPLOAD__.service"
test "$(cat "$factory/logs/COMPLETE-EXACT")" = native-build-qualified
printf '%s  %s\n' '__MANIFEST_SHA__' "$factory/source/source-manifest.json" | sha256sum -c -
printf '%s  %s\n' '__BINARY_SHA__' "$factory/target/release/aphrody-site" | sha256sum -c -
printf '%s  %s\n' '__UNIT_SHA__' "$unit_source" | sha256sum -c -
printf '%s  %s\n' '__UI_SHA__' "$ui_manifest" | sha256sum -c -
printf '%s  %s\n' '__UI_ARCHIVE_SHA__' "$ui_archive" | sha256sum -c -
grep -v '  Cargo.lock$' "$factory/source/SOURCE-SHA256SUMS" | (cd "$factory/source"; sha256sum -c -) >/dev/null
previous_active=0
if systemctl is-active --quiet aphrody-site.service; then previous_active=1; fi
previous_enabled=$(systemctl is-enabled aphrody-site.service 2>/dev/null || true)
previous_pid=$(systemctl show aphrody-site.service -p MainPID --value 2>/dev/null || true)
listeners=$(sudo ss -H -ltnp '( sport = :80 )')
if test -n "$listeners"; then
  test "$previous_active" = 1 && [[ "$previous_pid" =~ ^[1-9][0-9]*$ ]] || { echo 'Port 80 belongs to another workload' >&2; exit 2; }
  listener_pids=$(printf '%s\n' "$listeners" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
  test "$listener_pids" = "$previous_pid" || { echo 'Port 80 listener ownership is not the previous site service' >&2; exit 2; }
  if printf '%s\n' "$listeners" | grep -v 'pid=' >/dev/null; then echo 'Port 80 has an unverified listener' >&2; exit 2; fi
fi
ui_stage=$(mktemp -d "$factory/ui-stage.XXXXXXXX")
trap 'rm -rf -- "$ui_stage"' EXIT
tar --no-same-owner --no-same-permissions -xf "$ui_archive" -C "$ui_stage"
test -z "$(find "$ui_stage" -type l -print -quit)"
(cd "$ui_stage"; sha256sum -c "$ui_manifest") >/dev/null
test "$(find "$ui_stage" -type f | wc -l)" = "$(wc -l < "$ui_manifest")"
verify_shared_assets() {
  asset_sums=$(grep -E '  (m3/packages/(assets/|m3-fonts/)|crates/ui/(identity/assets/(brand|logo|aphrody)/|render/src/[^/]+\.wgsl$))' "$factory/source/SOURCE-SHA256SUMS" || true)
  if test -n "$asset_sums"; then printf '%s\n' "$asset_sums" | (cd "$1"; sha256sum -c -) >/dev/null; fi
}
reuse=0
if test -e "$release" || test -L "$release"; then
  test -d "$release" && ! test -L "$release"
  printf '%s  %s\n' '__BINARY_SHA__' "$release/bin/aphrody-site" | sha256sum -c -
  printf '%s  %s\n' '__MANIFEST_SHA__' "$release/source-manifest.json" | sha256sum -c -
  printf '%s  %s\n' '__UNIT_SHA__' "$release/aphrody-site.service" | sha256sum -c -
  printf '%s  %s\n' '__UI_SHA__' "$release/UI-SHA256SUMS" | sha256sum -c -
  (cd "$release/crates/ui/app/ui-dist"; sha256sum -c "$release/UI-SHA256SUMS") >/dev/null
  grep '  m3/templates/' "$factory/source/SOURCE-SHA256SUMS" | (cd "$release"; sha256sum -c -) >/dev/null
  verify_shared_assets "$release"
  reuse=1
fi
if test -e /home/ubuntu/apps/aphrody/current && ! test -L /home/ubuntu/apps/aphrody/current; then echo 'current is not a symlink' >&2; exit 1; fi
previous=$(readlink /home/ubuntu/apps/aphrody/current || true)
backup=/home/ubuntu/apps/aphrody/shared/native-site-backups/$(date -u +%Y%m%dT%H%M%SZ)-__UI_UPLOAD__
sudo install -d -m 0700 "$backup"
printf '%s\n' "$previous" | sudo tee "$backup/previous-current" >/dev/null
if test -f /etc/systemd/system/aphrody-site.service; then
  sudo cp -a /etc/systemd/system/aphrody-site.service "$backup/aphrody-site.service"
  sudo sha256sum "$backup/aphrody-site.service" | sudo tee "$backup/SHA256SUMS" >/dev/null
  sudo sha256sum -c "$backup/SHA256SUMS"
fi
installed=0
switched=0
stopped=0
rollback() {
  failure=${1:-$?}
  trap - ERR TERM INT HUP
  set +e
  if test "$installed" = 1; then sudo systemctl stop aphrody-site.service || true; fi
  if test "$switched" = 1; then
    if test -n "$previous"; then
      sudo ln -s "$previous" /home/ubuntu/apps/aphrody/current.native-rollback-__UI_UPLOAD__
      sudo mv -Tf /home/ubuntu/apps/aphrody/current.native-rollback-__UI_UPLOAD__ /home/ubuntu/apps/aphrody/current
    elif test "$(readlink /home/ubuntu/apps/aphrody/current || true)" = "$release"; then
      sudo unlink /home/ubuntu/apps/aphrody/current
    fi
  fi
  if test "$installed" = 1; then
    sudo systemctl disable aphrody-site.service || true
    if sudo test -f "$backup/aphrody-site.service"; then
      sudo cp -a "$backup/aphrody-site.service" /etc/systemd/system/aphrody-site.service
    else
      sudo systemctl disable aphrody-site.service || true
      sudo rm -f -- /etc/systemd/system/aphrody-site.service
    fi
    sudo systemctl daemon-reload
    case "$previous_enabled" in
      enabled) sudo systemctl enable aphrody-site.service ;;
      enabled-runtime) sudo systemctl enable --runtime aphrody-site.service ;;
    esac
  fi
  if test "$previous_active" = 1 && test "$stopped" = 1; then sudo systemctl start aphrody-site.service; fi
  exit "$failure"
}
trap rollback ERR
trap 'rollback 143' TERM INT HUP
if ! getent group aphrody-site >/dev/null; then sudo groupadd --system aphrody-site; fi
if ! getent passwd aphrody-site >/dev/null; then sudo useradd --system --gid aphrody-site --no-create-home --shell /usr/sbin/nologin aphrody-site; fi
test "$(id -u aphrody-site)" -ne 0
test "$(id -gn aphrody-site)" = aphrody-site
if test "$reuse" = 0; then
stage="$release.staging-__UI_UPLOAD__"
test ! -e "$stage" && ! test -L "$stage"
sudo install -d -m 0755 "$stage/bin" "$stage/m3" "$stage/crates/ui/app/ui-dist"
sudo install -m 0755 "$factory/target/release/aphrody-site" "$stage/bin/aphrody-site"
sudo cp -a "$factory/source/m3/templates" "$stage/m3/templates"
for relative in m3/packages/assets m3/packages/m3-fonts crates/ui/identity/assets/brand crates/ui/identity/assets/logo crates/ui/identity/assets/aphrody; do
  if test -d "$factory/source/$relative"; then
    sudo install -d -m 0755 "$stage/$(dirname "$relative")"
    sudo cp -a "$factory/source/$relative" "$stage/$relative"
  fi
done
for shader in "$factory/source/crates/ui/render/src/"*.wgsl; do
  if test -f "$shader"; then
    sudo install -d -m 0755 "$stage/crates/ui/render/src"
    sudo install -m 0444 "$shader" "$stage/crates/ui/render/src/$(basename "$shader")"
  fi
done
sudo cp -a "$ui_stage/." "$stage/crates/ui/app/ui-dist/"
sudo install -m 0444 "$factory/source/source-manifest.json" "$stage/source-manifest.json"
sudo install -m 0444 "$factory/logs/binary.sha256" "$stage/binary.sha256"
sudo install -m 0444 "$factory/source/Cargo.lock" "$stage/Cargo.build.lock"
sudo install -m 0444 "$factory/source/Cargo.source.lock" "$stage/Cargo.source.lock"
sudo install -m 0444 "$unit_source" "$stage/aphrody-site.service"
sudo install -m 0444 "$ui_manifest" "$stage/UI-SHA256SUMS"
printf '%s  %s\n' '__BINARY_SHA__' "$stage/bin/aphrody-site" | sha256sum -c -
printf '%s  %s\n' '__MANIFEST_SHA__' "$stage/source-manifest.json" | sha256sum -c -
printf '%s  %s\n' '__UNIT_SHA__' "$stage/aphrody-site.service" | sha256sum -c -
grep '  m3/templates/' "$factory/source/SOURCE-SHA256SUMS" | (cd "$stage"; sha256sum -c -) >/dev/null
verify_shared_assets "$stage"
(cd "$stage/crates/ui/app/ui-dist"; sha256sum -c "$stage/UI-SHA256SUMS") >/dev/null
sudo chown -R root:root "$stage"
sudo find "$stage" -type d -exec chmod 0755 {} +
sudo chmod -R a-w "$stage"
sudo mv -T "$stage" "$release"
fi
sudo systemd-analyze verify "$release/aphrody-site.service"
if test "$previous_active" = 1; then
  stopped=1
  sudo systemctl stop aphrody-site.service
fi
installed=1
sudo install -m 0644 "$release/aphrody-site.service" /etc/systemd/system/aphrody-site.service
sudo ln -s "$release" /home/ubuntu/apps/aphrody/current.native-next-__UI_UPLOAD__
sudo mv -Tf /home/ubuntu/apps/aphrody/current.native-next-__UI_UPLOAD__ /home/ubuntu/apps/aphrody/current
switched=1
sudo systemd-analyze verify /etc/systemd/system/aphrody-site.service
sudo systemctl daemon-reload
sudo systemctl enable --now aphrody-site.service
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1/health >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1/health >/dev/null
curl --fail --silent http://127.0.0.1/api/docs | python3 -c 'import json,sys; assert len(json.load(sys.stdin))==5'
curl --fail --silent http://127.0.0.1/api/templates | python3 -c 'import json,sys; assert len(json.load(sys.stdin))==6'
for route in / /docs /templates /material-3 /assets/site.css; do curl --fail --silent "http://127.0.0.1$route" >/dev/null; done
if test -d "$release/m3/packages/assets"; then
  curl --fail --silent --max-time 60 http://127.0.0.1/assets/manifest > "$ui_stage/shared-assets.json"
  python3 - "$release" "$ui_stage/shared-assets.json" <<'PY'
import hashlib, json, sys, urllib.parse, urllib.request
from pathlib import Path
release = Path(sys.argv[1]).resolve()
roots = {name: f'm3/packages/assets/{name}' for name in ('icons','images','svgs','sounds','videos','lottie','models','wasm')}
roots.update(brand='crates/ui/identity/assets/brand', logo='crates/ui/identity/assets/logo', pet='crates/ui/identity/assets/aphrody', fonts='m3/packages/m3-fonts/fonts', shaders='crates/ui/render/src')
entries = json.loads(Path(sys.argv[2]).read_text())
seen = set()
for entry in entries:
    namespace = entry['namespace']
    root = (release / roots[namespace]).resolve()
    source = (root / entry['path']).resolve()
    assert source.is_relative_to(root) and source.is_file(), 'Asset manifest escaped its declared owner'
    content = source.read_bytes()
    assert len(content) == entry['bytes'] and hashlib.sha256(content).hexdigest() == entry['sha256'], 'Shared asset manifest differs from immutable release'
    if namespace not in seen:
        url = 'http://127.0.0.1' + urllib.parse.quote(entry['url'], safe='/')
        with urllib.request.urlopen(url, timeout=5) as response:
            assert hashlib.sha256(response.read()).hexdigest() == entry['sha256'], 'Served shared asset differs'
        seen.add(namespace)
required = {'icons','images','svgs','sounds','videos','lottie','brand','logo','pet','fonts','shaders'}
assert required <= seen, f'Deployed asset namespaces missing: {required-seen}'
print(f'shared-assets-verified={len(entries)} namespaces={len(seen)}')
PY
fi
while read -r expected asset; do
  actual=$(curl --fail --silent --max-time 5 "http://127.0.0.1/$asset" | sha256sum | cut -d' ' -f1)
  test "$actual" = "$expected" || { echo "Served app-ui artifact differs: $asset" >&2; false; }
done < "$release/UI-SHA256SUMS"
sudo systemctl is-active aphrody-site.service
sudo systemctl is-enabled aphrody-site.service
pid=$(systemctl show aphrody-site.service -p MainPID --value)
sudo readlink "/proc/$pid/exe"
sudo systemctl show aphrody-site.service -p User -p AmbientCapabilities -p CapabilityBoundingSet -p ExecStart
ss -ltnp '( sport = :80 )'
trap - ERR TERM INT HUP
printf 'activated-release=%s\n' "$release"
'@
$uploadId = 'ui-' + [Guid]::NewGuid().ToString('N')
$localArchive = Join-Path ([IO.Path]::GetTempPath()) ($uploadId + '.tar')
$localManifest = Join-Path ([IO.Path]::GetTempPath()) ($uploadId + '.SHA256SUMS')
$localScript = Join-Path ([IO.Path]::GetTempPath()) ($uploadId + '.deploy.sh')
$sshTimeoutBeforeDeploy = $env:APHRODY_SSH_COMMAND_TIMEOUT_SECS
try {
    [IO.File]::WriteAllText($localManifest, $uiManifest, [Text.UTF8Encoding]::new($false))
    & tar -cf $localArchive -C $uiRoot .
    if ($LASTEXITCODE -ne 0) { throw 'Canonical app-ui archive creation failed' }
    $archiveSha256 = (Get-FileHash -LiteralPath $localArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $script = $script.Replace('__RELEASE__', $releaseId).Replace('__MANIFEST_SHA__', $SourceManifestSha256).Replace('__BINARY_SHA__', $BinarySha256).Replace('__UNIT_SHA__', $unitSha256).Replace('__UI_SHA__', $uiSha256).Replace('__UI_ARCHIVE_SHA__', $archiveSha256).Replace('__UI_UPLOAD__', $uploadId)
    [IO.File]::WriteAllText($localScript, $script.Replace("`r`n","`n")+"`n", [Text.UTF8Encoding]::new($false))
    # The health and complete UI hash checks need a finite deadline beyond the CLI's 30-second default.
    $env:APHRODY_SSH_COMMAND_TIMEOUT_SECS = '180'
    foreach ($transfer in @(@($unitPath,($uploadId + '.service')), @($localManifest,($uploadId + '.SHA256SUMS')), @($localArchive,($uploadId + '.tar')), @($localScript,($uploadId + '.deploy.sh')))) {
        & aphrody infra ssh sftp --host vps --path ('/home/ubuntu/native-site-factory/' + $transfer[1]) --put $transfer[0]
        if ($LASTEXITCODE -ne 0) { throw "Infra artifact upload failed: $($transfer[1])" }
    }
    & aphrody infra ssh exec --host vps --cmd ('bash -n /home/ubuntu/native-site-factory/' + $uploadId + '.deploy.sh')
    if ($LASTEXITCODE -ne 0) { throw 'Remote deployment syntax check failed' }
    & aphrody infra ssh exec --host vps --cmd ('bash /home/ubuntu/native-site-factory/' + $uploadId + '.deploy.sh')
    if ($LASTEXITCODE -ne 0) { throw 'Infra activation failed; inspect remote rollback/logs' }
} finally {
    $env:APHRODY_SSH_COMMAND_TIMEOUT_SECS = $sshTimeoutBeforeDeploy
    Remove-Item -LiteralPath $localArchive,$localManifest,$localScript -Force -ErrorAction SilentlyContinue
}
