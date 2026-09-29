[CmdletBinding()]
param(
	[string]$Root = "data/sj-ocr",
	[int]$IntervalSeconds = 30,
	[switch]$Once
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path $Root).Path
$logPath = Join-Path $rootPath "ocr-monitor.log"
$statePath = Join-Path $rootPath "ocr-status.json"

function Get-Int([string]$Text, [int]$Default = 0) {
	$m = [regex]::Match($Text, "(?<!\d)(\d+)(?!\d)")
	if ($m.Success) { return [int]$m.Groups[1].Value }
	return $Default
}

function Build-State {
	$lots = @(Get-ChildItem -LiteralPath $rootPath -Directory | Where-Object Name -match '^lot-[0-9]+$' | Sort-Object Name)
	$expected = 0
	$images = 0
	$results = 0
	$text = 0
	$invalid = 0
	$pendingLots = 0
	foreach ($lot in $lots) {
		$manifestPath = Join-Path $lot.FullName "manifeste.ocr.json"
		$lotImages = 0
		if (Test-Path $manifestPath) {
			$m = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
			$expected += [int]$m.counts.expected
			$lotImages = [int]$m.counts.imagesOnDisk
			$images += $lotImages
		}
		$resultPath = Join-Path $lot.FullName "resultats.jsonl"
		$lotResults = 0
		if (Test-Path $resultPath) {
			$seenImages = @{}
			foreach ($line in Get-Content -LiteralPath $resultPath) {
				if (-not $line.Trim()) { continue }
				try {
					$r = $line | ConvertFrom-Json
					$imageKey = [IO.Path]::GetFileName([string]$r.image).ToLowerInvariant()
					if (-not $imageKey -or $seenImages.ContainsKey($imageKey)) { continue }
					$seenImages[$imageKey] = $true
					$lotResults++
					$results++
					$md = [string]$r.text.markdown
					if ($md.Trim()) { $text++ }
				} catch { $invalid++ }
			}
		}
		if ($lotImages -gt $lotResults) { $pendingLots++ }
	}
	$log = if (Test-Path $logPath) { @(Get-Content -LiteralPath $logPath) } else { @() }
	$started = $null
	$startMatch = $log | Where-Object { $_ -match 'Démarrage OCR databooks' } | Select-Object -Last 1
	if ($startMatch -and $startMatch -match '^\[(?<d>[^\]]+)\]') { $started = [datetime]::Parse($Matches.d) }
	$startIndex = if ($startMatch) { [array]::IndexOf($log, $startMatch) } else { 0 }
	$currentLog = if ($startIndex -ge 0) { @($log | Select-Object -Skip $startIndex) } else { $log }
	$last = $log | Select-Object -Last 1
	$activeLot = $null
	$runLine = $log | Where-Object { $_ -match 'RUN (lot-\d+)' } | Select-Object -Last 1
	if ($runLine -match 'RUN (lot-\d+)') { $activeLot = $Matches[1] }
	$readPages = 0
	$readSeconds = 0.0
	foreach ($line in $currentLog) {
		if ($line -match '(\d+)/(\d+) read') { $readPages = [math]::Max($readPages, [int]$Matches[1]) }
		if ($line -match '(\d+)/(\d+) page\(s\) read in ([0-9.]+)s') { $readSeconds += [double]$Matches[3] }
	}
	$elapsed = if ($started) { ((Get-Date) - $started).TotalSeconds } else { 0 }
	$rate = if ($readSeconds -gt 0) { $readPages / $readSeconds } elseif ($elapsed -gt 0 -and $readPages -gt 0) { $readPages / $elapsed } else { 0 }
	$remaining = [math]::Max(0, $expected - $results)
	$runnerProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
		Where-Object { $_.CommandLine -match 'run-databooks-ocr\.ps1' } |
		Select-Object -ExpandProperty ProcessId)
	if ($runnerProcesses.Count -eq 0) { $activeLot = $null }
	$gpu = $null
	try {
		$gpuLine = & nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>$null | Select-Object -First 1
		if ($gpuLine) { $p = $gpuLine -split ',\s*'; $gpu = [ordered]@{ name=$p[0]; memoryUsed=$p[1]; memoryTotal=$p[2]; utilization=$p[3] } }
	} catch {}
	$system = $null
	try {
		$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
		$cpu = (Get-CimInstance Win32_Processor -ErrorAction Stop | Measure-Object -Property LoadPercentage -Average).Average
		$system = [ordered]@{
			cpuPercent = [math]::Round([double]$cpu, 1)
			freeRamGB = [math]::Round([double]$os.FreePhysicalMemory / 1MB, 2)
			totalRamGB = [math]::Round([double]$os.TotalVisibleMemorySize / 1MB, 2)
			ramPressure = if (($os.FreePhysicalMemory / $os.TotalVisibleMemorySize) -lt 0.15) { "high" } elseif (($os.FreePhysicalMemory / $os.TotalVisibleMemorySize) -lt 0.25) { "elevated" } else { "normal" }
		}
	} catch {}
	[ordered]@{
		schemaVersion = 1
		generatedAt = (Get-Date).ToUniversalTime().ToString("o")
		root = $rootPath
		runner = [ordered]@{ process = $runnerProcesses; activeLot=$activeLot }
		progress = [ordered]@{ expected=$expected; images=$images; results=$results; text=$text; invalid=$invalid; remaining=$remaining; lotsPending=$pendingLots; percent=if($expected){[math]::Round($results*100/$expected,2)}else{0} }
		performance = [ordered]@{ ratePagesPerSecond=[math]::Round($rate,5); ratePagesPerHour=[math]::Round($rate*3600,2); elapsedSeconds=[math]::Round($elapsed,1); etaSeconds=if($rate -gt 0){[math]::Round($remaining/$rate,1)}else{$null} }
		gpu = $gpu
		system = $system
		shenron = [ordered]@{ deposited="not_measured"; audited="not_measured"; dashboard="database_progress_only" }
	}
}

do {
	$state = Build-State
	# API .NET explicite : UTF-8 sans BOM, identique sous Windows PowerShell 5.1
	# et PowerShell 7 (les noms d'encodage des cmdlets diffèrent entre les deux).
	$json = ($state | ConvertTo-Json -Depth 8) + [Environment]::NewLine
	[IO.File]::WriteAllText($statePath, $json, [Text.UTF8Encoding]::new($false))
	$eta = if ($null -eq $state.performance.etaSeconds) { "—" } else { "{0}s" -f $state.performance.etaSeconds }
	Write-Output ("{0} {1}/{2} ({3}%) · {4} p/h · ETA {5} · lot {6}" -f $state.generatedAt,$state.progress.results,$state.progress.expected,$state.progress.percent,$state.performance.ratePagesPerHour,$eta,$state.runner.activeLot)
	if (-not $Once) { Start-Sleep -Seconds $IntervalSeconds }
} while (-not $Once)
