# SPDX-License-Identifier: Apache-2.0
# Native CLI adapter for CurrentUser DPAPI credentials; never writes plaintext.
[CmdletBinding()]
param(
    [ValidateSet('Status','Audit')][string]$Action='Audit',
    [string]$StateRoot,
    [string]$AphrodyExecutable
)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
if(-not $AphrodyExecutable){$AphrodyExecutable=(Get-Command aphrody -ErrorAction Stop).Source}
$credentialFile=Join-Path $StateRoot 'auth/ovh/service-account.dpapi'
Add-Type -AssemblyName System.Security
$decoded=$null
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
$old=@{}
foreach($name in @('OVH_CLIENT_ID','OVH_CLIENT_SECRET','OVH_ENDPOINT')){$old[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
    $decoded=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialFile),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $pair=[Text.Encoding]::UTF8.GetString($decoded)|ConvertFrom-Json
    if(-not $pair.client_id -or -not $pair.client_secret){throw 'Protected OVH account is incomplete'}
    $env:OVH_CLIENT_ID=$pair.client_id
    $env:OVH_CLIENT_SECRET=$pair.client_secret
    $env:OVH_ENDPOINT=$pair.endpoint
    $statusResult=Invoke-NativeOvh -NativeArguments @('ovh','status')
    $tokenOk=$statusResult.code -eq 0 -and ($statusResult.output -match 'AUTHENTIFI')
    $report=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');authMode='oauth2_client_credentials';authenticated=$tokenOk;domain='aphrody.com';registrarRead=$null;dnsZoneMetadata=$null;dnsRead=$null;mutation=$false}
    if($Action -eq 'Audit' -and $tokenOk){
        $registrarResult=Invoke-NativeOvh -NativeArguments @('ovh','domain','info','aphrody.com','--json')
        $registrarOutput=$registrarResult.output+$registrarResult.error
        $registrarExit=$registrarResult.code
        $registrarJson=$null
        try{$registrarJson=($registrarOutput -join "`n")|ConvertFrom-Json -ErrorAction Stop}catch{}
        $report.registrarRead=[ordered]@{exit=$registrarExit;verifiedDomain=($registrarJson.domain -eq 'aphrody.com');http404=(($registrarOutput -join ' ') -match 'HTTP 404');http403=(($registrarOutput -join ' ') -match 'HTTP 403')}
        $dnsResult=Invoke-NativeOvh -NativeArguments @('ovh','dns','info','aphrody.com','--profile','aphrody.com')
        $dnsOutput=$dnsResult.output+$dnsResult.error
        $report.dnsZoneMetadata=[ordered]@{exit=$dnsResult.code;http404=($dnsOutput -match 'HTTP 404');http403=($dnsOutput -match 'HTTP 403');schemaMismatch=($dnsOutput -match 'missing field')}
        $recordsResult=Invoke-NativeOvh -NativeArguments @('ovh','dns','records','aphrody.com','--profile','aphrody.com')
        $lines=@($recordsResult.output -split '\r?\n' | Where-Object {$_ -match '\S'})
        $recordsVerified=$recordsResult.code -eq 0 -and $lines.Count -ge 2 -and $lines[0] -match '^ID\s+TYPE\s+SOUS-DOMAINE\s+TTL\s+CIBLE\s*$' -and $lines[1] -match '^-+\s+-+\s+-+\s+-+\s+-+\s*$'
        for($i=2;$i -lt $lines.Count;$i++){if($lines[$i] -notmatch '^\d+\s+[A-Z][A-Z0-9]*\s+\S+\s+\d+\s+.+$'){$recordsVerified=$false}}
        $recordsError=$recordsResult.output+$recordsResult.error
        $report.dnsRead=[ordered]@{exit=$recordsResult.code;verifiedRecords=$recordsVerified;recordCount=if($recordsVerified){$lines.Count-2}else{$null};http404=($recordsError -match 'HTTP 404');http403=($recordsError -match 'HTTP 403')}
    }
    $json=$report|ConvertTo-Json -Depth 5
    if($Action -eq 'Audit'){
        $output=Join-Path $StateRoot 'auth/ovh/audit-status.json'
        [IO.File]::WriteAllText($output,$json)
        $acl=New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true,$false)
        $currentUser=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($currentUser,'FullControl','Allow')))
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','Allow')))
        [IO.File]::SetAccessControl($output,$acl)
    }
    Write-Output $json
    if(-not $tokenOk){exit 1}
    if($Action -eq 'Audit' -and ($report.registrarRead.exit -ne 0 -or -not $report.registrarRead.verifiedDomain -or $report.dnsRead.exit -ne 0 -or -not $report.dnsRead.verifiedRecords)){exit 2}
    exit 0
}finally{
    foreach($name in $old.Keys){[Environment]::SetEnvironmentVariable($name,$old[$name],'Process')}
    if($decoded){[Array]::Clear($decoded,0,$decoded.Length)}
    $pair=$null
}
