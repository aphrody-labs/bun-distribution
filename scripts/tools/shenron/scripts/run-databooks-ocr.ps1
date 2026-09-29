[CmdletBinding()]
param(
	[string]$Root = "data/sj-ocr",
	[int]$MaxTokens = 2048,
	[int]$PollSeconds = 30,
	[string]$Aphrody
)

$ErrorActionPreference = "Stop"

# La feature `ocr` est optionnelle dans aphrody (`--features ocr`) et une mise a
# jour du binaire peut la faire disparaitre sans prevenir : `aphrody ocr` retombe
# alors sur `auto_command`, tente un appel A2A et echoue loin de sa cause. On
# resout donc un binaire qui expose REELLEMENT la commande, au lieu de faire
# confiance au PATH.
function Test-AphrodyOcr([string]$Chemin) {
	if (-not $Chemin -or -not (Test-Path -LiteralPath $Chemin)) { return $false }
	try { $aide = & $Chemin ocr --help 2>&1 | Out-String } catch { return $false }
	return $aide -match 'databooks'
}

if ($Aphrody) {
	if (-not (Test-AphrodyOcr $Aphrody)) { throw "$Aphrody n'expose pas 'ocr databooks'" }
	$aphrody = (Resolve-Path $Aphrody).Path
} else {
	$candidats = @()
	$surPath = Get-Command aphrody -ErrorAction SilentlyContinue
	if ($surPath) { $candidats += $surPath.Source }
	# Filtre sur *.exe : Windows refuse d'executer une sauvegarde nommee
	# `aphrody.exe.bak-<date>`, dont l'extension n'est pas executable. Une
	# sauvegarde qui porte la feature doit donc etre copiee en `.exe` d'abord.
	$candidats += @(Get-ChildItem -Path (Join-Path $HOME ".cargo/bin") -Filter "aphrody*.exe" -ErrorAction SilentlyContinue |
		Sort-Object Name -Descending | ForEach-Object { $_.FullName })
	$aphrody = $candidats | Where-Object { Test-AphrodyOcr $_ } | Select-Object -First 1
	if (-not $aphrody) {
		throw "Aucun binaire aphrody n'expose 'ocr databooks'. Reconstruire avec --features ocr, ou passer -Aphrody <chemin>."
	}
	if ($surPath -and $aphrody -ne $surPath.Source) {
		Write-Warning "aphrody du PATH sans feature ocr; repli sur $aphrody"
	}
}
$rootPath = (Resolve-Path $Root).Path
$logPath = Join-Path $rootPath "ocr-monitor.log"

function Write-Log([string]$Message) {
	$line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
	Add-Content -LiteralPath $logPath -Value $line
	Write-Output $line
}

function Normalize-Results([string]$Path) {
	if (-not (Test-Path -LiteralPath $Path)) { return 0 }
	$records = [ordered]@{}
	$invalid = 0
	foreach ($line in Get-Content -LiteralPath $Path) {
		if (-not $line.Trim()) { continue }
		try {
			$r = $line | ConvertFrom-Json
			$key = [IO.Path]::GetFileName([string]$r.image).ToLowerInvariant()
			if ($key) { $records[$key] = $r }
		} catch { $invalid++ }
	}
	if ($invalid -gt 0) { throw "$Path contient $invalid ligne(s) JSON invalides; arrêt sans réécriture" }
	$backup = "$Path.raw-$(Get-Date -Format 'yyyyMMdd-HHmmss').jsonl"
	Copy-Item -LiteralPath $Path -Destination $backup -ErrorAction Stop
	$tmp = "$Path.tmp"
	[IO.File]::WriteAllText($tmp, "", [Text.UTF8Encoding]::new($false))
	$records.Values | ForEach-Object {
		$_.image = [IO.Path]::GetFileName([string]$_.image)
		$record = ($_ | ConvertTo-Json -Depth 20 -Compress) + [Environment]::NewLine
		[IO.File]::AppendAllText($tmp, $record, [Text.UTF8Encoding]::new($false))
	}
	Move-Item -LiteralPath $tmp -Destination $Path -Force
	[void](Write-Log "NORMALIZE $([IO.Path]::GetFileName((Split-Path $Path -Parent))): $($records.Count) entrées uniques; brut=$([IO.Path]::GetFileName($backup))")
	return $records.Count
}

Write-Log "Démarrage OCR databooks root=$rootPath maxTokens=$MaxTokens"
$lots = Get-ChildItem -LiteralPath $rootPath -Directory | Where-Object Name -match '^lot-[0-9]+$' | Sort-Object Name
if ($lots.Count -eq 0) { throw "Aucun lot trouvé dans $rootPath" }

foreach ($lot in $lots) {
	$imagesPath = Join-Path $lot.FullName "images"
	$images = @(Get-ChildItem -LiteralPath $imagesPath -Recurse -File -ErrorAction SilentlyContinue | Where-Object Extension -in '.jpg','.jpeg','.png','.webp')
	if ($images.Count -eq 0) { Write-Log "SKIP $($lot.Name): aucune image dans images/"; continue }
	$out = Join-Path $lot.FullName "resultats.jsonl"
	Write-Log "RUN $($lot.Name): $($images.Count) images -> $out"
	$completed = Normalize-Results $out
	if ($completed -ge $images.Count) {
		Write-Log "SKIP $($lot.Name): $completed/$($images.Count) images déjà traitées"
		continue
	}
	# Aphrody écrit sa progression sur stderr (notamment « reading … with
	# dots-ocr »). Avec $ErrorActionPreference=Stop, l'appel direct peut
	# transformer cette sortie informative en NativeCommandError avant même que
	# --skip-done ne puisse reprendre les images absentes. Start-Process sépare
	# donc les deux flux et laisse le code de sortie décider du succès réel.
	$stdoutPath = [IO.Path]::GetTempFileName()
	$stderrPath = [IO.Path]::GetTempFileName()
	try {
		$ocrProcess = Start-Process -FilePath $aphrody -ArgumentList @(
			"ocr", "databooks", $imagesPath, "--out", $out, "--skip-done", "--max-tokens", $MaxTokens
		) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
		Get-Content -LiteralPath $stdoutPath, $stderrPath -ErrorAction SilentlyContinue | ForEach-Object {
			Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_)
		}
	} finally {
		Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
	}
	if ($ocrProcess.ExitCode -ne 0) { Write-Log "FAIL $($lot.Name): exit=$($ocrProcess.ExitCode)"; continue }
	$normalized = Normalize-Results $out
	Write-Log "DONE $($lot.Name): resultats=$normalized"
}
Write-Log "Fin OCR databooks"
