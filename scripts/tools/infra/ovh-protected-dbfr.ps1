# SPDX-License-Identifier: Apache-2.0
# Read-only OVH audit for the Dragon Ball FR profile. Credentials stay in the
# owner-only ~/.config/ovh/dbfr.conf file and are never copied to task arguments.
[CmdletBinding()]
param(
    [ValidateSet('Audit')][string]$Action='Audit',
    [string]$StateRoot
)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$profile='dragonballfr.com'
$expectedAccount='gl839461-ovh'
$domain='dragonballfr.com'
$AphrodyExecutable=(Get-Command aphrody -ErrorAction Stop).Source
function Invoke-NativeOvh([string[]]$NativeArguments){
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$AphrodyExecutable
    $start.Arguments=$NativeArguments -join ' '
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$start
    try{
        if(-not $process.Start()){throw 'Native OVH command did not start'}
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(45000)){$process.Kill();return @{code=124;output='';error='native command timed out'}}
        return @{code=$process.ExitCode;output=$stdout.GetAwaiter().GetResult();error=$stderr.GetAwaiter().GetResult()}
    }finally{$process.Dispose()}
}
function Save-ProtectedReport([string]$Path,[string]$Json){
    $directory=Split-Path -Parent $Path
    if(-not (Test-Path -LiteralPath $directory -PathType Container)){throw 'Protected OVH report directory is missing'}
    $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
    $rules=@((Get-Acl -LiteralPath $directory).Access)
    if($rules.Count -ne 2 -or @($rules|Where-Object {$_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed}).Count -gt 0){throw 'Protected OVH report directory ACL is not owner-only'}
    $temporary=$Path+'.tmp'
    [IO.File]::WriteAllText($temporary,$Json,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
$report=[ordered]@{
    observedAt=[DateTime]::UtcNow.ToString('o')
    profile=$profile
    expectedAccount=$expectedAccount
    authMode=$null
    authenticated=$false
    domain=$domain
    registrarRead=$null
    dnsRead=$null
    servicesWatch=$null
    vpsRead=$null
    mutation=$false
}
$authResult=Invoke-NativeOvh -NativeArguments @('ovh','auth','status','--profile',$profile,'--json')
$authJson=$null
try{$authJson=($authResult.output -join "`n")|ConvertFrom-Json -ErrorAction Stop}catch{}
$report.authMode=$authJson.authMode
$report.authenticated=$authResult.code -eq 0 -and $authJson.account -eq $expectedAccount
if($authResult.code -eq 0){$report.account=$authJson.account}
if($Action -eq 'Audit' -and $report.authenticated){
    $registrarResult=Invoke-NativeOvh -NativeArguments @('ovh','domain','info',$domain,'--profile',$profile,'--json')
    $registrarJson=$null
    try{$registrarJson=($registrarResult.output -join "`n")|ConvertFrom-Json -ErrorAction Stop}catch{}
    $report.registrarRead=[ordered]@{
        exit=$registrarResult.code
        verifiedDomain=$registrarJson.domain -eq $domain
        state=$registrarJson.state
        renewalState=$registrarJson.renewal_state
        dnssecState=$registrarJson.dnssec_state
        transferLock=$registrarJson.transfer_lock
    }
    $dnsResult=Invoke-NativeOvh -NativeArguments @('ovh','dns','records',$domain,'--profile',$profile)
    $lines=@($dnsResult.output -split '\r?\n'|Where-Object {$_ -match '\S'})
    $recordsVerified=$dnsResult.code -eq 0 -and $lines.Count -ge 2 -and $lines[0] -match '^ID\s+TYPE\s+SOUS-DOMAINE\s+TTL\s+CIBLE\s*$' -and $lines[1] -match '^-+\s+-+\s+-+\s+-+\s+-+\s*$'
    for($i=2;$i -lt $lines.Count;$i++){if($lines[$i] -notmatch '^\d+\s+[A-Z][A-Z0-9]*\s+\S+\s+\d+\s+.+$'){$recordsVerified=$false}}
    $report.dnsRead=[ordered]@{exit=$dnsResult.code;verifiedRecords=$recordsVerified;recordCount=if($recordsVerified){$lines.Count-2}else{$null}}
    $watchResult=Invoke-NativeOvh -NativeArguments @('ovh','services','watch','--profile',$profile,'--alerts-only')
    $watchLines=@($watchResult.output -split '\r?\n'|Where-Object {$_ -match '\S'})
    $report.servicesWatch=[ordered]@{exit=$watchResult.code;alertCount=$watchLines.Count}
    $vpsResult=Invoke-NativeOvh -NativeArguments @('ovh','vps','list','--profile',$profile)
    $vpsText=$vpsResult.output -join "`n"
    $vpsCount=$null
    if($vpsText -match 'Services VPS\s*\((\d+)\)'){$vpsCount=[int]$Matches[1]}
    $report.vpsRead=[ordered]@{exit=$vpsResult.code;count=$vpsCount}
}
$json=$report|ConvertTo-Json -Depth 6
$output=Join-Path $StateRoot 'auth/ovh/audit-status-dragonballfr.com.json'
Save-ProtectedReport -Path $output -Json $json
Write-Output $json
if(-not $report.authenticated){exit 1}
if($Action -eq 'Audit' -and ($report.registrarRead.exit -ne 0 -or -not $report.registrarRead.verifiedDomain -or $report.dnsRead.exit -ne 0 -or -not $report.dnsRead.verifiedRecords -or $report.vpsRead.exit -ne 0)){exit 2}
if($report.servicesWatch.exit -ne 0){exit $report.servicesWatch.exit}
