# YOLO installer for Windows (PowerShell):
#   irm https://github.com/aphrody-labs/yolo/releases/latest/download/install.ps1 | iex
# Environment: YOLO_VERSION, YOLO_HOME (default %USERPROFILE%\.yolo), YOLO_REPO, YOLO_RELEASE_DIR, GITHUB_TOKEN,
#              YOLO_NO_CRATES=1 (skip the Rust sources of the desktop scaffold), YOLO_NO_MODIFY_PATH=1,
#              YOLO_NO_ALIASES=1 (do not install the bun.exe and vu.exe aliases of the single yolo executable)
$ErrorActionPreference = "Stop"
# $ErrorActionPreference only stops on PowerShell errors: a nonzero exit from tar.exe or yolo.exe does not throw by
# itself, so every native call below is followed by an explicit $LASTEXITCODE check.
function Assert-Success([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}
$Repo = if ($env:YOLO_REPO) { $env:YOLO_REPO } else { "aphrody-labs/yolo" }
$HomeDir = if ($env:YOLO_HOME) { $env:YOLO_HOME } else { Join-Path $env:USERPROFILE ".yolo" }
$Version = if ($env:YOLO_VERSION) { $env:YOLO_VERSION } else { "latest" }
$Target = "x86_64-pc-windows-msvc"
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") { throw "unsupported architecture" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yolo-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($env:GH_TOKEN) { $env:GH_TOKEN } else { $null }
  function Get-Asset([string]$Name) {
    $Dest = Join-Path $Tmp $Name
    if ($env:YOLO_RELEASE_DIR) { Copy-Item (Join-Path $env:YOLO_RELEASE_DIR $Name) $Dest; return $Dest }
    $Base = if ($Version -eq "latest") { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$Version" }
    try { Invoke-WebRequest "$Base/$Name" -OutFile $Dest -UseBasicParsing; return $Dest } catch {
      if (-not $Token) { throw "cannot download $Name (private repository? set GITHUB_TOKEN)" }
    }
    $Api = if ($Version -eq "latest") { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$Version" }
    $H = @{ Authorization = "Bearer $Token"; Accept = "application/vnd.github+json" }
    $Release = Invoke-RestMethod $Api -Headers $H
    $Asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $Asset) { throw "release has no asset $Name" }
    Invoke-WebRequest $Asset.url -OutFile $Dest -Headers @{ Authorization = "Bearer $Token"; Accept = "application/octet-stream" } -UseBasicParsing
    return $Dest
  }
  Write-Host "Installing yolo ($Target, $Version) into $HomeDir"
  $Sums = Get-Asset "SHA256SUMS"
  $Line = Get-Content $Sums | Where-Object { $_ -match "yolo-.*-$Target\.tar\.gz$" } | Select-Object -First 1
  if (-not $Line) { throw "no build for $Target in this release" }
  $Name = ($Line -split "\s+")[1]; $Want = ($Line -split "\s+")[0]
  $Archive = Get-Asset $Name
  $Got = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLower()
  if ($Got -ne $Want) { throw "checksum mismatch for $Name" }
  $CratesName = $null
  if (-not $env:YOLO_NO_CRATES) {
    $CratesLine = Get-Content $Sums | Where-Object { $_ -match "yolo-.*-crates\.tar\.gz$" } | Select-Object -First 1
    if ($CratesLine) {
      $CratesName = ($CratesLine -split "\s+")[1]; $CratesWant = ($CratesLine -split "\s+")[0]
      $CratesArchive = Get-Asset $CratesName
      $CratesGot = (Get-FileHash $CratesArchive -Algorithm SHA256).Hash.ToLower()
      if ($CratesGot -ne $CratesWant) { throw "checksum mismatch for $CratesName" }
    }
  }
  $Extract = Join-Path $Tmp "main"; New-Item -ItemType Directory -Path $Extract | Out-Null
  tar -xzf $Archive -C $Extract; Assert-Success "extracting $Name"
  if ($CratesName) {
    $CratesExtract = Join-Path $Tmp "crates"; New-Item -ItemType Directory -Path $CratesExtract | Out-Null
    tar -xzf $CratesArchive -C $CratesExtract; Assert-Success "extracting $CratesName"
    if (-not (Test-Path (Join-Path $CratesExtract "crates") -PathType Container)) { throw "missing crates directory in $CratesName" }
  }
  $Candidate = Join-Path $Extract "bin\yolo.exe"
  if (-not (Test-Path $Candidate -PathType Leaf)) { throw "release is missing bin/yolo.exe" }
  # Validate with the release's standalone CLI in an isolated store before replacing any installed
  # files. The archive hash alone does not prove its native runtime is compatible or loadable.
  $SavedYoloHome = $env:YOLO_HOME; $SavedRuntimeHome = $env:YOLO_RUNTIME_HOME
  try {
    $env:YOLO_HOME = $Extract; $env:YOLO_RUNTIME_HOME = Join-Path $Tmp "runtime-probe"
    & $Candidate version; Assert-Success "candidate yolo version"
    & $Candidate runtime install (Join-Path $Extract "artifact"); Assert-Success "candidate yolo runtime install"
    & $Candidate runtime info --installed | Out-Null; Assert-Success "candidate yolo runtime info --installed"
  } finally {
    $env:YOLO_HOME = $SavedYoloHome; $env:YOLO_RUNTIME_HOME = $SavedRuntimeHome
  }
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  # Stage each code/data replacement as .new before removing the previous path (same as install.sh).
  # Runtime artifact history (current/previous) is kept by `yolo runtime install`.
  # Known limitation: `yolo upgrade` runs this script from the very yolo.exe it is about to replace, and Windows
  # locks an executable file while it runs, so `Rename-Item $New $Part` can still fail for "bin" in that path (the
  # plain `irm ... | iex` / manual install.ps1 flow is unaffected, since nothing there is already running).
  foreach ($Part in "bin", "packages", "assets", "templates", "m3", "VERSION", "LICENSE", "LICENSES", "vendor.lock") {
    $Src = Join-Path $Extract $Part; if (-not (Test-Path $Src)) { continue }
    $New = Join-Path $HomeDir "$Part.new"; if (Test-Path $New) { Remove-Item -Recurse -Force $New }
    Copy-Item -Recurse $Src $New
    $Dst = Join-Path $HomeDir $Part; if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
    Rename-Item $New $Part
  }
  foreach ($Old in "sdk", "stack") { $OldPath = Join-Path $HomeDir $Old; if (Test-Path $OldPath) { Remove-Item -Recurse -Force $OldPath } }
  if ($CratesName) {
    $CratesDst = Join-Path $HomeDir "crates"; New-Item -ItemType Directory -Force -Path $CratesDst | Out-Null
    Copy-Item -Recurse -Force (Join-Path $CratesExtract "crates\*") $CratesDst
  }
  # One executable, three names by argv0 (yolo, bun = the engine, vu = the vu runtime artifact). Windows has no
  # dependable unprivileged symlink, so the aliases are hard links to bin\yolo.exe on the same volume: no copy.
  foreach ($Alias in "bun.exe", "vu.exe") {
    $AliasPath = Join-Path $HomeDir "bin\$Alias"
    if (Test-Path $AliasPath) { Remove-Item -Force $AliasPath }
    if (-not $env:YOLO_NO_ALIASES) { New-Item -ItemType HardLink -Path $AliasPath -Target (Join-Path $HomeDir "bin\yolo.exe") | Out-Null }
  }
  $env:YOLO_HOME = $HomeDir
  & (Join-Path $HomeDir "bin\yolo.exe") runtime install (Join-Path $Extract "artifact"); Assert-Success "yolo runtime install"
  if (-not $env:YOLO_NO_MODIFY_PATH) {
    $Bin = Join-Path $HomeDir "bin"
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (($UserPath -split ";") -notcontains $Bin) { [Environment]::SetEnvironmentVariable("Path", "$Bin;$UserPath", "User"); Write-Host "Added $Bin to the user PATH" }
  }
  & (Join-Path $HomeDir "bin\yolo.exe") version; Assert-Success "yolo version"
  Write-Host "yolo is installed. Open a new terminal and run: yolo doctor"
} finally { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
