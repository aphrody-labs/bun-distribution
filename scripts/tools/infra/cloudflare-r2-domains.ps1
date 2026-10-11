# SPDX-License-Identifier: Apache-2.0
# Scoped adapter for the installed Infra CLI's Cloudflare capability gap.
[CmdletBinding()]
param([ValidateSet('Plan','Apply','Verify')][string]$Action='Plan',[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$zoneId='963461271f885bc3f3c2bfd586f2b7ba'
$accountId='ca22c1a51a145f919b54afa18d936516'
$desired=@(@{bucket='aphrody-assets';domain='assets.aphrody.com'},@{bucket='aphrody-dist';domain='dist.aphrody.com'})
Add-Type -AssemblyName System.Security
$bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot 'auth/cloudflare/native-token.dpapi')),$null,'CurrentUser')
try{
    $headers=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($bytes)}
    function Cf([string]$Path,[string]$Method='GET',$Body=$null){
        $options=@{Uri='https://api.cloudflare.com/client/v4'+$Path;Method=$Method;Headers=$headers;TimeoutSec=30;ErrorAction='Stop'}
        if($null -ne $Body){$options.Body=$Body|ConvertTo-Json -Depth 12 -Compress;$options.ContentType='application/json'}
        try{$response=Invoke-RestMethod @options}catch{
            $failure=$_
            $codes='unknown'
            try{
                $failureText=$failure.ErrorDetails.Message
                if(-not $failureText){$reader=New-Object IO.StreamReader($failure.Exception.Response.GetResponseStream());try{$failureText=$reader.ReadToEnd()}finally{$reader.Dispose()}}
                $errorBody=$failureText|ConvertFrom-Json
                $codes=($errorBody.errors|ForEach-Object {$_.code}) -join ','
                if(@($errorBody.errors|Where-Object {$_.code -eq 10051 -and $_.message -eq 'The specified zone id is not valid.'}).Count){$codes+=' (zone-not-valid)'}
                # Provider error messages are not printed; keep only numeric codes.
                if($codes -notmatch '^\d+(,\d+)*( \(zone-not-valid\))?$'){$codes='unknown'}
            }catch{}
            throw ('Cloudflare request failed '+$Path+' HTTP '+[int]$failure.Exception.Response.StatusCode+' codes '+$codes)
        }
        if(-not $response.success){throw ('Cloudflare rejected '+$Path)}
        return $response.result
    }
    $zone=Cf ('/zones/'+$zoneId)
    if($zone.name -ne 'aphrody.com' -or $zone.account.id -ne $accountId){throw 'Owner zone identity mismatch'}
    $records=@(Cf ('/zones/'+$zoneId+'/dns_records?per_page=500'))
    if($records.Count -ge 500){throw 'Complete DNS snapshot required'}
    $buckets=(Cf ('/accounts/'+$accountId+'/r2/buckets')).buckets
    $before=@()
    foreach($item in $desired){
        $bucket=@($buckets|Where-Object {$_.name -eq $item.bucket})
        if($bucket.Count -ne 1 -or ($bucket[0].jurisdiction -and $bucket[0].jurisdiction -ne 'default')){throw 'Bucket identity or jurisdiction mismatch'}
        $path='/accounts/'+$accountId+'/r2/buckets/'+$item.bucket+'/domains'
        $custom=@((Cf ($path+'/custom')).domains)
        $managed=Cf ($path+'/managed')
        $matching=@($custom|Where-Object {$_.domain -eq $item.domain})
        if($matching.Count -gt 1 -or ($matching.Count -and $matching[0].zoneId -ne $zoneId)){throw 'Custom domain identity mismatch'}
        $conflicts=@($records|Where-Object {$_.name -eq $item.domain})
        # R2 creates its own managed DNS. Never replace an unrelated existing record.
        if($conflicts.Count -and -not $matching.Count){throw ('DNS conflict for '+$item.domain+'; no records replaced')}
        $before+=@{bucket=$item.bucket;domain=$item.domain;custom=$custom;managed=$managed;operation=if($matching.Count){'update'}else{'create'}}
    }
    $backup=Join-Path $StateRoot ('protected-backups/dns/r2-domains-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    New-Item -ItemType Directory -Path $backup|Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $backup -AclObject $acl
    $snapshot=Join-Path $backup 'before.json'
    [IO.File]::WriteAllText($snapshot,(@{zone=$zone;records=$records;buckets=$before}|ConvertTo-Json -Depth 25))
    $hash=(Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $snapshot -Destination ($snapshot+'.verified')
    if((Get-FileHash -LiteralPath ($snapshot+'.verified') -Algorithm SHA256).Hash -ne $hash){throw 'Protected snapshot verification failed'}
    [IO.File]::WriteAllText(($snapshot+'.sha256'),$hash)
    $report=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');action=$Action;zoneStatus=$zone.status;desired=$desired;before=$before;backup=$backup;applied=$false;after=@();productionVerified=$false}
    [IO.File]::WriteAllText((Join-Path $backup 'plan.json'),($report|ConvertTo-Json -Depth 25))
    if($Action -eq 'Apply'){
        # Cloudflare permits linking a bucket once the zone exists in this account.
        # Pending registration is preparation only; Verify still requires activation.
        if($zone.status -notin @('pending','active')){throw 'Zone not eligible for custom domain registration'}
        foreach($item in $before){
            $path='/accounts/'+$accountId+'/r2/buckets/'+$item.bucket+'/domains/custom'
            if($item.operation -eq 'create'){Cf $path 'POST' @{domain=$item.domain;enabled=$true;zoneId=$zoneId;minTLS='1.2'}|Out-Null}
            else{Cf ($path+'/'+$item.domain) 'PUT' @{enabled=$true;minTLS='1.2'}|Out-Null}
        }
        $report.applied=$true
    }
    foreach($item in $desired){
        $domains=@((Cf ('/accounts/'+$accountId+'/r2/buckets/'+$item.bucket+'/domains/custom')).domains)
        $matching=@($domains|Where-Object {$_.domain -eq $item.domain})
        $report.after+=@{bucket=$item.bucket;domain=$item.domain;settings=$matching}
        if($Action -eq 'Apply' -and ($matching.Count -ne 1 -or -not $matching[0].enabled -or $matching[0].minTLS -ne '1.2')){throw 'Custom domain readback incomplete'}
    }
    if($Action -eq 'Verify'){
        if($zone.status -ne 'active'){throw 'Production verification requires an active delegated zone'}
        foreach($entry in $report.after){
            if(@($entry.settings).Count -ne 1 -or -not $entry.settings[0].enabled -or $entry.settings[0].status.ownership -ne 'active' -or $entry.settings[0].status.ssl -ne 'active'){throw ('Domain ownership/TLS not active: '+$entry.domain)}
        }
        $objectProof=@()
        foreach($item in $before){
            $key=if($item.bucket -eq 'aphrody-assets'){'m3/symbols/material-symbols-index.json'}else{'aphrody/manifest.json'}
            if(-not $item.managed.enabled){throw 'Managed reference URL unavailable for object parity qualification'}
            $reference=Join-Path $backup ($item.bucket+'-reference.json')
            $production=Join-Path $backup ($item.bucket+'-production.json')
            $url='https://'+$item.domain+'/'+$key
            # Normal Windows certificate validation remains enabled on both GETs.
            Invoke-WebRequest -UseBasicParsing -Uri ('https://'+$item.managed.domain+'/'+$key) -OutFile $reference -TimeoutSec 30|Out-Null
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $production -TimeoutSec 30|Out-Null
            $referenceHash=(Get-FileHash -LiteralPath $reference -Algorithm SHA256).Hash
            if((Get-FileHash -LiteralPath $production -Algorithm SHA256).Hash -ne $referenceHash){throw ('Public object mismatch for '+$item.domain)}
            [IO.File]::ReadAllText($production)|ConvertFrom-Json|Out-Null
            $marker=if($item.bucket -eq 'aphrody-assets'){'material'}else{'aphrody'}
            if([IO.File]::ReadAllText($production) -notmatch $marker){throw 'Expected public object identity missing'}
            $webOutput=& aphrody web browser snapshot $url --json 2>$null
            if($LASTEXITCODE){throw ('Native Aphrody Web failed for '+$item.domain)}
            $web=$webOutput -join "`n"|ConvertFrom-Json
            if($web.url -ne $url -or $web.snapshot -notmatch $marker){throw 'Native browser snapshot object evidence incomplete'}
            [IO.File]::WriteAllText((Join-Path $backup ($item.bucket+'-web.json')),($webOutput -join "`n"))
            $objectProof+=@{bucket=$item.bucket;url=$url;key=$key;sha256=$referenceHash;publicGet=$true;nativeWeb=$true}
        }
        $report.objectProof=$objectProof
        $report.productionVerified=$true
    }
    $afterRecords=@(Cf ('/zones/'+$zoneId+'/dns_records?per_page=500'))
    $names=@($desired|ForEach-Object {$_.domain})
    $beforeOthers=@($records|Where-Object {$_.name -notin $names}|Sort-Object id)|ConvertTo-Json -Depth 25
    $afterOthers=@($afterRecords|Where-Object {$_.name -notin $names}|Sort-Object id)|ConvertTo-Json -Depth 25
    if($beforeOthers -ne $afterOthers){throw 'Concurrent unrelated DNS change; inspect protected snapshot'}
    $json=$report|ConvertTo-Json -Depth 25
    [IO.File]::WriteAllText((Join-Path $backup 'result.json'),$json)
    Write-Output $json
}finally{[Array]::Clear($bytes,0,$bytes.Length);$headers=$null}
