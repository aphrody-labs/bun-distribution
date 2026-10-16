# SPDX-License-Identifier: Apache-2.0
# Resume the already-authorized transition through guarded provider adapters.
[CmdletBinding()]
param([switch]$Apply,[switch]$Once,[ValidateRange(60,3600)][int]$IntervalSeconds=300,
    [ValidateRange(1,288)][int]$MaxAttempts=288,[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$directory=Join-Path $StateRoot 'tasks/domain-cutover-loop'
New-Item -ItemType Directory -Path $directory -Force|Out-Null
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
}
Set-Acl -LiteralPath $directory -AclObject $acl
# An exclusive handle excludes another loop using the same protected state.
$lock=[IO.File]::Open((Join-Path $directory 'loop.lock'),'OpenOrCreate','ReadWrite','None')
$statePath=Join-Path $directory 'state.json'
$state=@{phase='starting';nsRequested=$false;webApplied=$false;r2Applied=$false;complete=$false}
if(Test-Path -LiteralPath $statePath){
    $previous=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
    foreach($key in @('nsRequested','webApplied','r2Applied','complete')){
        if($previous.$key -isnot [bool]){throw 'Invalid protected loop state'}
        $state[$key]=$previous.$key
    }
}
function Save-State {
    $state.observedAt=[DateTime]::UtcNow.ToString('o')
    $state.pid=$PID
    $state.apply=[bool]$Apply
    $json=$state|ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText(($statePath+'.next'),$json)
    Move-Item -LiteralPath ($statePath+'.next') -Destination $statePath -Force
    Write-Output $json
}
function Adapter([string]$Name,[string]$Action){
    $script=Join-Path $PSScriptRoot ($Name+'.ps1')
    $output=& $script -Action $Action -StateRoot $StateRoot
    return ($output -join "`n"|ConvertFrom-Json)
}
try{
    for($attempt=1;$attempt -le $MaxAttempts;$attempt++){
        $state.attempt=$attempt
        $state.phase='observing-web'
        $web=Adapter 'cloudflare-web-activate' 'Plan'
        $state.zone=$web.zoneStatus
        if($web.zoneStatus -eq 'pending'){
            if(-not $state.nsRequested){
                $state.phase='observing-dnssec'
                $dns=Adapter 'domain-cutover' 'Plan'
                $state.dnssec=$dns.dnssec
                $ready=$dns.dnssec -eq 'disabled' -and $dns.nonDelegationDiffCount -eq 0 -and $dns.httpsVerified -and $dns.parentDsProof.Count -eq 2 -and @($dns.parentDsProof|Where-Object {-not $_.absenceProven}).Count -eq 0
                if($Apply -and $ready){
                    # Persist before POST: an interrupted request must never be resubmitted automatically.
                    $state.phase='requesting-nameservers';$state.nsRequested=$true;Save-State
                    $requested=Adapter 'domain-cutover' 'SwitchNameServers'
                    $state.taskId=$requested.taskId
                }
            }
            $state.phase=if($state.nsRequested){'waiting-delegation'}else{'waiting-dnssec'}
        }elseif($web.zoneStatus -eq 'active'){
            if($Apply -and -not $state.webApplied){
                $state.phase='applying-web';Save-State
                $applied=Adapter 'cloudflare-web-activate' 'Apply'
                if(-not $applied.applied){throw 'Web apply not confirmed'}
                $state.webApplied=$true
            }
            $state.phase='observing-r2'
            $r2=Adapter 'cloudflare-r2-domains' 'Plan'
            if($Apply -and -not $state.r2Applied){
                $state.phase='applying-r2';Save-State
                $applied=Adapter 'cloudflare-r2-domains' 'Apply'
                if(-not $applied.applied){throw 'R2 apply not confirmed'}
                $state.r2Applied=$true
                $r2=Adapter 'cloudflare-r2-domains' 'Plan'
            }
            $ready=@($r2.after).Count -eq 2 -and @($r2.after|Where-Object {@($_.settings).Count -ne 1 -or -not $_.settings[0].enabled -or $_.settings[0].status.ownership -ne 'active' -or $_.settings[0].status.ssl -ne 'active'}).Count -eq 0
            if($Apply -and $state.webApplied -and $state.r2Applied -and $ready){
                $state.phase='verifying-web';Save-State
                $verified=Adapter 'cloudflare-web-activate' 'Verify'
                if(-not $verified.productionVerified){throw 'Public web verification not confirmed'}
                $state.phase='verifying-r2';Save-State
                $verified=Adapter 'cloudflare-r2-domains' 'Verify'
                if(-not $verified.productionVerified){throw 'Production verification not confirmed'}
                $state.complete=$true;$state.phase='infra-verified'
            }else{$state.phase='waiting-r2-tls'}
        }else{throw 'Zone has an unexpected lifecycle state'}
        Save-State
        if($Once -or $state.complete){break}
        if($attempt -lt $MaxAttempts){Start-Sleep -Seconds $IntervalSeconds}
    }
    if(-not $Once -and -not $state.complete){$state.phase='attempt-limit';Save-State;exit 2}
}catch{
    $state.failedPhase=$state.phase;$state.phase='adapter-error';Save-State
    throw 'Guarded transition stopped; inspect protected adapter snapshots before resuming.'
}finally{$lock.Dispose()}
