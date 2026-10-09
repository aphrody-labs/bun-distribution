# SPDX-License-Identifier: Apache-2.0
# Offline orchestration tests: adapters are replaced only in an isolated copy.
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('aphrody-cutover-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot|Out-Null
try{
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'domain-cutover-loop.ps1') -Destination $testRoot
    $mock=@'
param($Action,$StateRoot)
$fixture=Get-Content (Join-Path $StateRoot 'fixture.json') -Raw|ConvertFrom-Json
$name=[IO.Path]::GetFileNameWithoutExtension($MyInvocation.MyCommand.Path)
Add-Content -LiteralPath (Join-Path $StateRoot 'calls.txt') -Value ($name+':'+$Action)
if($fixture.fail -eq ($name+':'+$Action)){throw 'Injected adapter failure'}
if($Action -eq 'Plan'){$fixture.$name|ConvertTo-Json -Depth 10}
else{@{applied=$true;taskId=42;productionVerified=$true}|ConvertTo-Json}
'@
    foreach($name in @('domain-cutover','cloudflare-web-activate','cloudflare-r2-domains')){
        [IO.File]::WriteAllText((Join-Path $testRoot ($name+'.ps1')),$mock)
    }
    function Scenario([string]$Name,[string]$Zone,[string]$Dnssec,[bool]$Tls,[string]$Fail=''){
        $directory=Join-Path $testRoot $Name
        New-Item -ItemType Directory -Path $directory|Out-Null
        $fixture=@{
            'cloudflare-web-activate'=@{zoneStatus=$Zone}
            'domain-cutover'=@{dnssec=$Dnssec;nonDelegationDiffCount=0;httpsVerified=$true;parentDsProof=@(@{absenceProven=$true},@{absenceProven=$true})}
            'cloudflare-r2-domains'=@{after=@(foreach($domain in @('assets.aphrody.com','dist.aphrody.com')){@{domain=$domain;settings=@(@{enabled=$true;status=@{ownership='active';ssl=if($Tls){'active'}else{'pending'}}})}})}
            fail=$Fail
        }
        [IO.File]::WriteAllText((Join-Path $directory 'fixture.json'),($fixture|ConvertTo-Json -Depth 12))
        return $directory
    }
    function Run([string]$Directory){& (Join-Path $testRoot 'domain-cutover-loop.ps1') -Once -Apply -StateRoot $Directory|Out-Null}
    function State([string]$Directory){Get-Content (Join-Path $Directory 'tasks/domain-cutover-loop/state.json') -Raw|ConvertFrom-Json}
    function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
    $pending=Scenario 'pending' 'pending' 'disableInProgress' $false
    Run $pending
    Assert ((State $pending).phase -eq 'waiting-dnssec') 'Pending DNSSEC must wait'
    Assert (-not ((Get-Content (Join-Path $pending 'calls.txt')) -match ':Apply|:SwitchNameServers|:Verify')) 'Pending DNSSEC must not mutate'
    $delegating=Scenario 'delegating' 'pending' 'disabled' $false
    Run $delegating;Run $delegating
    Assert (@(Get-Content (Join-Path $delegating 'calls.txt')|Where-Object {$_ -eq 'domain-cutover:SwitchNameServers'}).Count -eq 1) 'NS request must occur once across resumptions'
    $tls=Scenario 'tls' 'active' 'disabled' $false
    Run $tls
    Assert ((State $tls).phase -eq 'waiting-r2-tls' -and -not (State $tls).complete) 'Incomplete R2 TLS must wait'
    $verified=Scenario 'verified' 'active' 'disabled' $true
    Run $verified
    Assert ((State $verified).phase -eq 'infra-verified' -and (State $verified).complete) 'Ready infra must verify'
    $failure=Scenario 'failure' 'active' 'disabled' $true 'cloudflare-web-activate:Apply'
    $threw=$false
    try{Run $failure}catch{$threw=$true}
    Assert ($threw -and (State $failure).phase -eq 'adapter-error' -and -not (State $failure).complete) 'Adapter failure must stop without completion'
    Assert (-not ((Get-Content (Join-Path $failure 'calls.txt')) -match 'cloudflare-r2-domains')) 'Web failure must prevent R2 apply'
    $edgeFailure=Scenario 'edge-failure' 'active' 'disabled' $true 'cloudflare-web-activate:Verify'
    $threw=$false
    try{Run $edgeFailure}catch{$threw=$true}
    Assert ($threw -and (State $edgeFailure).failedPhase -eq 'verifying-web' -and -not (State $edgeFailure).complete) 'Public web failure must prevent completion'
    Assert (-not ((Get-Content (Join-Path $edgeFailure 'calls.txt')) -match 'cloudflare-r2-domains:Verify')) 'Public web failure must prevent final R2 verification'
    Write-Output 'PASS: DNSSEC guard, single NS request, R2 TLS wait, public verification, fail-stop'
}finally{
    # Only the exact newly-created native temporary directory is removed.
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
