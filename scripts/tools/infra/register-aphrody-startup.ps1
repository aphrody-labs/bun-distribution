#Requires -Version 7.2
# SPDX-License-Identifier: Apache-2.0
<# Infra adapter: plans/registers only the declared Aphrody native startup tasks.
DryRun performs validation and read-only observations; it never registers, starts,
stops, downloads, installs, writes configuration or changes PATH/firewall/listeners.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$Config,
    [switch]$DryRun,
    [switch]$HealthCheck,
    [string]$RunService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This Infra startup adapter requires native Windows.' }
$configurationPath = (Resolve-Path -LiteralPath $Config).Path
$schemaPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tools/config/host/windows/aphrody-startup.schema.json'))
$configurationText = Get-Content -LiteralPath $configurationPath -Raw
if (-not (Test-Json -Json $configurationText -SchemaFile $schemaPath -ErrorAction Stop)) {
    throw 'Invalid Aphrody startup configuration.'
}
$settings = $configurationText | ConvertFrom-Json
foreach ($directory in @($settings.home, $settings.root)) {
    if (-not [IO.Path]::IsPathFullyQualified($directory) -or -not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw 'Configured home and repository root must be existing absolute directories.'
    }
}
$taskPath = '\Aphrody\Native\'
$ownerDescription = 'Aphrody Infra native startup v1'
$ids = @{}
$endpoints = @{}
$plan = @()
foreach ($service in $settings.services) {
    $servicePrincipal = if ($service.PSObject.Properties.Name -contains 'principal') { $service.principal } else { $settings.principal }
    $serviceTrigger = if ($service.PSObject.Properties.Name -contains 'trigger') { $service.trigger } else { $settings.trigger }
    if ($serviceTrigger.kind -eq 'boot' -and $servicePrincipal.logonType -eq 'Interactive') { throw 'Interactive principals require a logon trigger.' }
    if ($servicePrincipal.logonType -eq 'ServiceAccount' -and $servicePrincipal.userId -notin @('SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE')) { throw 'Invalid service-account identity.' }
    if ($servicePrincipal.logonType -eq 'ServiceAccount' -and -not ($service.PSObject.Properties.Name -contains 'home')) { throw 'ServiceAccount requires an explicit dedicated service home, not the provider user home.' }
    $serviceHome = if ($service.PSObject.Properties.Name -contains 'home') { $service.home } else { $settings.home }
    if (-not [IO.Path]::IsPathFullyQualified($serviceHome) -or -not (Test-Path -LiteralPath $serviceHome -PathType Container)) { throw 'Service home must be an existing absolute directory.' }
    if ($service.kind -ne 'site' -and ($servicePrincipal.logonType -ne 'Interactive' -or $serviceTrigger.kind -ne 'logon')) { throw 'Provider MCP/A2A services require their explicit user Interactive/logon profile.' }
    if ($ids.ContainsKey($service.id)) { throw 'Duplicate startup service id.' }
    $ids[$service.id] = $true
    if (-not [IO.Path]::IsPathFullyQualified($service.executable) -or $service.executable.Contains('"')) {
        throw 'Executable must be an absolute path without quote characters.'
    }
    $bindAddress = $null
    if (-not [Net.IPAddress]::TryParse($service.bind, [ref]$bindAddress)) { throw 'Bind must be a literal IP address.' }
    if ($service.kind -ne 'site' -and -not [Net.IPAddress]::IsLoopback($bindAddress)) {
        throw 'MCP and A2A must bind to loopback; only the product site may be public.'
    }
    # Wildcard listeners conflict with each other and narrower binds on the same port.
    if ($service.port -ne 0) {
        if ($endpoints.ContainsKey([string]$service.port)) { throw 'Each fixed service port must be distinct.' }
        $endpoints[[string]$service.port] = $true
    }
    foreach ($argument in $service.arguments) {
        if ($argument -match '^--(bind|listen|host|hostname|port|app)(=|$)' -or $argument.Contains([char]0)) {
            throw 'Listener flags belong to the bind/port declaration, not additional arguments.'
        }
    }
    $exists = Test-Path -LiteralPath $service.executable -PathType Leaf
    $listeners = @(if ($service.port -ne 0) { Get-NetTCPConnection -State Listen -LocalPort $service.port -ErrorAction SilentlyContinue })
    $existingTaskConfig = if ($service.PSObject.Properties.Name -contains 'existingTask') { $service.existingTask } else { $null }
    if ($existingTaskConfig -and -not (Get-ScheduledTask -TaskPath $existingTaskConfig.path -TaskName $existingTaskConfig.name -ErrorAction SilentlyContinue)) { throw 'Declared existing task does not exist.' }
    $reason = if (-not $service.enabled) { 'declared-disabled' } elseif (-not $exists) { 'missing-executable' } elseif ($listeners.Count -gt 0) { 'occupied-port' } else { 'ready' }
    $plan += [pscustomobject]@{
        id = $service.id; kind = $service.kind; taskPath = $taskPath
        enabled = $reason -eq 'ready'; reason = $reason; bind = $service.bind; port = $service.port
        listenerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        principal = $servicePrincipal; trigger = $serviceTrigger; existingTask = $existingTaskConfig
        home = $serviceHome
        desiredPort = if ($service.PSObject.Properties.Name -contains 'desiredPort') { $service.desiredPort } else { $service.port }
        desiredPortBlocked = if (($service.PSObject.Properties.Name -contains 'desiredPort') -and $service.desiredPort -ne $service.port) { @(Get-NetTCPConnection -State Listen -LocalPort $service.desiredPort -ErrorAction SilentlyContinue).Count -gt 0 } else { $listeners.Count -gt 0 }
    }
}

if ($RunService) {
    if ($DryRun -or $WhatIfPreference -or $HealthCheck) { throw 'RunService cannot be combined with planning or health observation.' }
    $selected = @($settings.services | Where-Object id -EQ $RunService)
    if ($selected.Count -ne 1 -or -not $selected[0].enabled) { throw 'Requested service is absent or disabled.' }
    $service = $selected[0]
    $row = @($plan | Where-Object id -EQ $RunService)[0]
    if (-not $row.enabled) { throw "Service unavailable: $($row.reason)." }
    # No credentials are imported or copied. Host profile/authentication stays in
    # its existing protected stores under this explicitly chosen task principal.
    $env:APHRODY_HOME = $row.home
    $env:APHRODY_WORKSPACE_ROOT = $settings.root
    $endpoint = if ($service.bind.Contains(':')) { "[$($service.bind)]:$($service.port)" } else { "$($service.bind):$($service.port)" }
    $serviceArguments = switch ($service.kind) {
        'site' { @('--root', $settings.root, '--bind', $endpoint) }
        'mcp' { @('http', '--bind', $endpoint) }
        'a2a' { @('a2a', 'serve', '--bind', $endpoint) }
    }
    $serviceArguments += @($service.arguments | ForEach-Object { $_.Replace('{{home}}', $row.home).Replace('{{root}}', $settings.root) })
    Set-Location -LiteralPath $settings.root
    # Start-Process joins ArgumentList; quote each argument using Windows argv rules.
    function ConvertTo-NativeArgument([string]$Value) {
        if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
        return '"' + ([regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
    }
    $child = Start-Process -FilePath $service.executable -ArgumentList (($serviceArguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ') -WorkingDirectory $settings.root -WindowStyle Hidden -PassThru
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $ownedListeners = @()
        do {
            $child.Refresh()
            if ($child.HasExited) { throw 'Native service exited before opening its declared listener.' }
            $ownedListeners = @(Get-NetTCPConnection -State Listen -OwningProcess $child.Id -ErrorAction SilentlyContinue | Where-Object { ($service.port -eq 0 -or $_.LocalPort -eq $service.port) -and $_.LocalAddress -eq $service.bind })
            if ($ownedListeners.Count -eq 0) { Start-Sleep -Milliseconds 200 }
        } while ($ownedListeners.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
        if ($ownedListeners.Count -ne 1) { throw 'Cannot identify exactly one child-owned service listener.' }
        $actualPort = $ownedListeners[0].LocalPort
        $probeAddress = if ($service.bind -eq '0.0.0.0') { '127.0.0.1' } elseif ($service.bind -eq '::') { '[::1]' } elseif ($service.bind.Contains(':')) { "[$($service.bind)]" } else { $service.bind }
        $healthStatus = $null
        try { $healthStatus = [int](Invoke-WebRequest -Uri "http://${probeAddress}:${actualPort}$($service.healthPath)" -TimeoutSec 5 -MaximumRedirection 0 -SkipHttpErrorCheck).StatusCode } catch { $healthStatus = $null }
        $registryDirectory = Join-Path $row.home 'run/native-services'
        [IO.Directory]::CreateDirectory($registryDirectory) | Out-Null
        $registryPath = Join-Path $registryDirectory "$($service.id).json"
        $temporaryPath = Join-Path $registryDirectory "$($service.id).$([guid]::NewGuid().ToString('N')).tmp"
        $registry = [ordered]@{ id = $service.id; kind = $service.kind; pid = $child.Id; processStartedAt = $child.StartTime.ToUniversalTime().ToString('o'); address = $service.bind; port = $actualPort; url = "http://${probeAddress}:${actualPort}"; healthStatus = $healthStatus; healthy = ($null -ne $healthStatus -and $healthStatus -ge 200 -and $healthStatus -lt 300); observedAt = [DateTime]::UtcNow.ToString('o') }
        [IO.File]::WriteAllText($temporaryPath, ($registry | ConvertTo-Json -Compress))
        [IO.File]::Move($temporaryPath, $registryPath, $true)
        $child.WaitForExit()
        exit $child.ExitCode
    } catch {
        # Only the child this wrapper owns is stopped on failed activation.
        if (-not $child.HasExited) { $child.Kill($true); $child.WaitForExit() }
        throw
    } finally { $child.Dispose() }
}

if ($HealthCheck) {
    foreach ($service in $settings.services) {
        $probeAddress = if ($service.bind -eq '0.0.0.0') { '127.0.0.1' } elseif ($service.bind -eq '::') { '[::1]' } elseif ($service.bind.Contains(':')) { "[$($service.bind)]" } else { $service.bind }
        $observedPort = $service.port
        if ($observedPort -eq 0) {
            $serviceHome = @($plan | Where-Object id -EQ $service.id)[0].home
            $registryPath = Join-Path $serviceHome "run/native-services/$($service.id).json"
            if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { [pscustomobject]@{ id = $service.id; status = $null; healthy = $false }; continue }
            $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
            $observedPort = [int]$registry.port
            $observedProcess = Get-Process -Id $registry.pid -ErrorAction SilentlyContinue
            if (-not $observedProcess -or $observedProcess.StartTime.ToUniversalTime() -ne ([datetime]$registry.processStartedAt).ToUniversalTime()) { [pscustomobject]@{ id = $service.id; status = $null; healthy = $false }; continue }
            $owned = @(Get-NetTCPConnection -State Listen -OwningProcess $registry.pid -LocalPort $observedPort -ErrorAction SilentlyContinue)
            if ($owned.Count -eq 0) { [pscustomobject]@{ id = $service.id; status = $null; healthy = $false }; continue }
        }
        $url = "http://${probeAddress}:${observedPort}$($service.healthPath)"
        try {
            $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 5 -MaximumRedirection 0 -SkipHttpErrorCheck
            [pscustomobject]@{ id = $service.id; status = [int]$response.StatusCode; healthy = ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) }
        } catch {
            [pscustomobject]@{ id = $service.id; status = $null; healthy = $false }
        }
    }
    return
}

$plan | ConvertTo-Json -Depth 5
if ($DryRun -or $WhatIfPreference) { return }

$powerShellPath = (Get-Process -Id $PID).Path
foreach ($row in $plan) {
    if ($row.existingTask) { continue }
    $existing = Get-ScheduledTask -TaskName $row.id -TaskPath $taskPath -ErrorAction SilentlyContinue
    if ($existing -and $existing.Description -ne $ownerDescription) {
        throw "Task ownership conflict: $taskPath$($row.id). No foreign task is replaced."
    }
}
foreach ($row in $plan) {
    if ($row.existingTask) { [pscustomobject]@{ id = $row.id; reused = $true; started = $false }; continue }
    if (-not $PSCmdlet.ShouldProcess("$taskPath$($row.id)", 'Register declared native startup task')) { continue }
    if ($configurationPath.Contains('"') -or $PSCommandPath.Contains('"')) { throw 'Task script/config path contains a quote.' }
    $taskArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Config "{1}" -RunService "{2}"' -f $PSCommandPath, $configurationPath, $row.id
    $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArguments -WorkingDirectory $settings.root
    $trigger = if ($row.trigger.kind -eq 'boot') {
        New-ScheduledTaskTrigger -AtStartup
    } else {
        New-ScheduledTaskTrigger -AtLogOn -User $row.principal.userId
    }
    $principal = New-ScheduledTaskPrincipal -UserId $row.principal.userId -LogonType $row.principal.logonType -RunLevel $row.principal.runLevel
    $taskSettingsArguments = @{
        StartWhenAvailable = $true; MultipleInstances = 'IgnoreNew'; Hidden = $true
        ExecutionTimeLimit = [TimeSpan]::Zero; RestartCount = 3; RestartInterval = [TimeSpan]::FromMinutes(1)
        Disable = -not $row.enabled
    }
    $taskSettings = New-ScheduledTaskSettingsSet @taskSettingsArguments
    Register-ScheduledTask -TaskName $row.id -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description $ownerDescription -Force | Out-Null
    [pscustomobject]@{ id = $row.id; registered = $true; enabled = $row.enabled; started = $false }
}
