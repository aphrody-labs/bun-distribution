# SPDX-License-Identifier: Apache-2.0
# Scoped provider adapter where the installed Infra CLI has no Cloudflare command.
[CmdletBinding()]
param([ValidateSet('Plan','Apply')][string]$Action='Plan',[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$zoneId='963461271f885bc3f3c2bfd586f2b7ba'
$accountId='ca22c1a51a145f919b54afa18d936516'
Add-Type -AssemblyName System.Security
$bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot 'auth/cloudflare/native-token.dpapi')),$null,'CurrentUser')
try{
    $headers=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($bytes)}
    function Cf([string]$Path,[string]$Method='GET',$Body=$null){
        $options=@{Uri='https://api.cloudflare.com/client/v4'+$Path;Method=$Method;Headers=$headers;TimeoutSec=30}
        if($null -ne $Body){$options.Body=$Body|ConvertTo-Json -Depth 12 -Compress;$options.ContentType='application/json'}
        try{$response=Invoke-RestMethod @options}catch{throw ('Cloudflare request failed '+$Path+' HTTP '+[int]$_.Exception.Response.StatusCode)}
        if(-not $response.success){throw ('Cloudflare rejected '+$Path)}
        return $response.result
    }
    $base='/zones/'+$zoneId
    $zone=Cf $base
    if($zone.name -ne 'aphrody.com' -or $zone.account.id -ne $accountId){throw 'Owner zone identity mismatch'}
    $records=@(Cf ($base+'/dns_records?per_page=500'))
    if($records.Count -ge 500){throw 'Record page limit reached; complete snapshot required'}
    $ssl=Cf ($base+'/settings/ssl')
    $security=Cf ($base+'/settings/security_header')
    $apex=@($records|Where-Object {$_.name -eq 'aphrody.com' -and $_.type -eq 'A'})
    $www=@($records|Where-Object {$_.name -eq 'www.aphrody.com' -and $_.type -eq 'CNAME'})
    if($apex.Count -ne 1 -or $apex[0].content -ne '51.77.147.152' -or $www.Count -ne 1 -or $www[0].content.TrimEnd('.') -ne 'aphrody.com'){throw 'Qualified apex/www origin records changed'}
    if(@($records|Where-Object {$_.name -in @('aphrody.com','www.aphrody.com') -and $_.type -eq 'AAAA'}).Count){throw 'Unqualified IPv6 origin; refusing activation'}
    $originProof=@()
    foreach($name in @('aphrody.com','www.aphrody.com')){
        $result=& curl.exe --silent --show-error --noproxy '*' --max-time 20 --resolve ($name+':443:'+ $apex[0].content) --output NUL --write-out '%{ssl_verify_result} %{http_code}' ('https://'+$name+'/') 2>$null
        $valid=$LASTEXITCODE -eq 0 -and (($name -eq 'aphrody.com' -and $result -eq '0 200') -or ($name -eq 'www.aphrody.com' -and $result -eq '0 301'))
        $originProof+=@{name=$name;valid=$valid;result=[string]$result}
    }
    $domains=@()
    foreach($bucket in @('aphrody-assets','aphrody-dist')){
        $custom=Cf ('/accounts/'+$accountId+'/r2/buckets/'+$bucket+'/domains/custom')
        $domains+=@{bucket=$bucket;domains=$custom.domains}
    }
    # Include-subdomains/preload stay disabled while other service origins need TLS repair.
    $hsts=@{strict_transport_security=@{enabled=$true;max_age=2592000;include_subdomains=$false;preload=$false;nosniff=$true}}
    $report=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');action=$Action;zoneStatus=$zone.status;originProof=$originProof;currentSsl=$ssl.value;desiredSsl='strict';currentSecurityHeader=$security.value;desiredSecurityHeader=$hsts;proxyNames=@('aphrody.com','www.aphrody.com');r2Domains=$domains;applied=$false}
    $backup=Join-Path $StateRoot ('backup/dns/web-activation-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    New-Item -ItemType Directory -Path $backup|Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    [IO.Directory]::SetAccessControl($backup,$acl)
    $snapshot=Join-Path $backup 'before.json'
    [IO.File]::WriteAllText($snapshot,(@{zone=$zone;records=$records;ssl=$ssl;security=$security;domains=$domains}|ConvertTo-Json -Depth 20))
    $hash=(Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $snapshot -Destination ($snapshot+'.verified')
    if((Get-FileHash -LiteralPath ($snapshot+'.verified') -Algorithm SHA256).Hash -ne $hash){throw 'Snapshot verification failed'}
    [IO.File]::WriteAllText(($snapshot+'.sha256'),$hash)
    $report.backup=$backup
    [IO.File]::WriteAllText((Join-Path $backup 'plan.json'),($report|ConvertTo-Json -Depth 12))
    if($Action -eq 'Apply'){
        if($zone.status -ne 'active' -or @($originProof|Where-Object {-not $_.valid}).Count){throw 'Zone inactive or origin TLS unqualified; no mutation applied'}
        if(-not $ssl.editable -or -not $security.editable){throw 'Required zone settings not editable; no mutation applied'}
        if($ssl.value -ne 'strict'){Cf ($base+'/settings/ssl') 'PATCH' @{value='strict'}|Out-Null}
        foreach($record in @($apex[0],$www[0])){
            if(-not $record.proxied){Cf ($base+'/dns_records/'+$record.id) 'PATCH' @{proxied=$true}|Out-Null}
        }
        Cf ($base+'/settings/security_header') 'PATCH' @{value=$hsts}|Out-Null
        $afterRecords=@(Cf ($base+'/dns_records?per_page=500'))
        # Read back only the exact changed settings/records. Other records must stay byte-equivalent.
        $beforeOthers=@($records|Where-Object {$_.id -notin @($apex[0].id,$www[0].id)}|Sort-Object id)|ConvertTo-Json -Depth 20
        $afterOthers=@($afterRecords|Where-Object {$_.id -notin @($apex[0].id,$www[0].id)}|Sort-Object id)|ConvertTo-Json -Depth 20
        if($beforeOthers -ne $afterOthers){throw 'Concurrent change in unrelated records; inspect protected snapshot'}
        $afterSsl=Cf ($base+'/settings/ssl')
        $afterSecurity=Cf ($base+'/settings/security_header')
        $changed=@($afterRecords|Where-Object {$_.id -in @($apex[0].id,$www[0].id)})
        $sts=$afterSecurity.value.strict_transport_security
        if($afterSsl.value -ne 'strict' -or $changed.Count -ne 2 -or @($changed|Where-Object {-not $_.proxied}).Count -or -not $sts.enabled -or $sts.max_age -ne 2592000 -or $sts.include_subdomains -or $sts.preload -or -not $sts.nosniff){throw 'Provider activation readback incomplete'}
        $report.applied=$true
    }
    $json=$report|ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText((Join-Path $backup 'result.json'),$json)
    Write-Output $json
}finally{[Array]::Clear($bytes,0,$bytes.Length);$headers=$null}
