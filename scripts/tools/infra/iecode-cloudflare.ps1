# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [ValidateSet('Plan','ApplyBuckets','Verify','PlanCredential','ApplyCredential')][string]$Action='Plan',
    [Parameter(Mandatory=$true)][string]$Catalog,
    [string]$StateRoot
)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$StateRoot=[IO.Path]::GetFullPath($StateRoot)
$catalogPath=[IO.Path]::GetFullPath($Catalog)
$desired=[IO.File]::ReadAllText($catalogPath)|ConvertFrom-Json
if($desired.schema -ne 'iecode.cloudflare-product/1' -or $desired.owner -ne 'aphrody-infra' -or $desired.zone -ne 'aphrody.com' -or $desired.runtimeHost -ne 'dbfr'){throw 'Unexpected IECODE Cloudflare catalog'}
$names=@($desired.buckets|ForEach-Object name|Sort-Object)
if(($names -join ',') -ne 'iecode-vfs,rg-assets' -or @($desired.buckets|Where-Object {$_.jurisdiction -ne 'eu' -or $_.public -ne $false}).Count){throw 'Only the two private EU product buckets are authorized'}
if((@($desired.surfaces|ForEach-Object domain|Sort-Object) -join ',') -ne 'iecode.aphrody.com,nie.aphrody.com,rg.aphrody.com'){throw 'Unexpected product domains'}
$cursor=[IO.DirectoryInfo]::new($StateRoot)
while($cursor){if(Test-Path -LiteralPath (Join-Path $cursor.FullName '.git')){throw 'Protected Cloudflare state must stay outside Git'};$cursor=$cursor.Parent}
Add-Type -AssemblyName System.Security
$bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot 'auth/cloudflare/native-token.dpapi')),$null,'CurrentUser')
try{
    $taskHeaders=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($bytes)}
    function Cf([string]$Path,[string]$Method='GET',$Body=$null,[string]$Jurisdiction){
        $headers=$taskHeaders.Clone()
        if($Jurisdiction){$headers['cf-r2-jurisdiction']=$Jurisdiction}
        $options=@{Uri='https://api.cloudflare.com/client/v4'+$Path;Headers=$headers;Method=$Method;TimeoutSec=30;ErrorAction='Stop'}
        if($null -ne $Body){$options.Body=$Body|ConvertTo-Json -Depth 12 -Compress;$options.ContentType='application/json'}
        try{$response=Invoke-RestMethod @options}catch{
            $failure=$_;$codes='unknown'
            try{$codes=(($failure.ErrorDetails.Message|ConvertFrom-Json).errors|ForEach-Object code) -join ',';if($codes -notmatch '^\d+(,\d+)*$'){$codes='unknown'}}catch{}
            throw ('Cloudflare request failed '+$Path+' HTTP '+[int]$failure.Exception.Response.StatusCode+' codes '+$codes)
        }
        if(-not $response.success){throw ('Cloudflare rejected '+$Path)}
        return $response.result
    }
    $accounts=@(Cf '/accounts')
    $zones=@(Cf ('/zones?name='+$desired.zone))
    if($accounts.Count -ne 1 -or $zones.Count -ne 1 -or $zones[0].account.id -ne $accounts[0].id){throw 'Owner account and zone identity did not qualify'}
    $account=$accounts[0].id;$zone=$zones[0]
    $base='/accounts/'+$account+'/r2/buckets'
    $records=@(Cf ('/zones/'+$zone.id+'/dns_records?per_page=500'))
    if($records.Count -ge 500){throw 'Complete DNS snapshot required'}
    $existing=@((Cf $base 'GET' $null 'eu').buckets)
    $plan=@()
    foreach($bucket in $desired.buckets){
        $matching=@($existing|Where-Object {$_.name -eq $bucket.name})
        if($matching.Count -gt 1){throw 'Duplicate bucket identity'}
        if($matching.Count){
            $identity=Cf ($base+'/'+$bucket.name) 'GET' $null 'eu'
            if($identity.name -ne $bucket.name -or $identity.jurisdiction -ne 'eu'){throw 'Bucket jurisdiction identity mismatch'}
        }
        $plan+=@{name=$bucket.name;jurisdiction='eu';public=$false;operation=if($matching.Count){'current'}else{'create'}}
    }
    $backup=Join-Path $StateRoot ('protected-backups/cloudflare/iecode-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    New-Item -ItemType Directory -Path $backup|Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $backup -AclObject $acl
    $snapshot=Join-Path $backup 'before.json'
    [IO.File]::WriteAllText($snapshot,(@{records=$records;buckets=$existing;zoneStatus=$zone.status}|ConvertTo-Json -Depth 20))
    $hash=(Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $snapshot -Destination ($snapshot+'.verified')
    if((Get-FileHash -LiteralPath ($snapshot+'.verified') -Algorithm SHA256).Hash -ne $hash){throw 'Protected snapshot checksum mismatch'}
    $report=[ordered]@{schema='iecode.cloudflare-plan/1';observedAt=[DateTime]::UtcNow.ToString('o');action=$Action;catalogSha256=(Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash;accountId=$account;zoneId=$zone.id;zoneStatus=$zone.status;buckets=$plan;domains=@($desired.surfaces|ForEach-Object domain);dnsMutation=$false;contentUploaded=$false;productionActivated=$false;backup=$backup;after=@()}
    [IO.File]::WriteAllText((Join-Path $backup 'plan.json'),($report|ConvertTo-Json -Depth 15))
    if($Action -eq 'ApplyBuckets'){
        foreach($bucket in $plan){if($bucket.operation -eq 'create'){Cf $base 'POST' @{name=$bucket.name;storageClass='Standard'} 'eu'|Out-Null}}
    }
    foreach($bucket in $plan){
        if($Action -eq 'Plan' -and $bucket.operation -eq 'create'){continue}
        $current=Cf ($base+'/'+$bucket.name) 'GET' $null 'eu'
        $managed=Cf ($base+'/'+$bucket.name+'/domains/managed') 'GET' $null 'eu'
        $custom=Cf ($base+'/'+$bucket.name+'/domains/custom') 'GET' $null 'eu'
        if($current.name -ne $bucket.name -or $current.jurisdiction -ne 'eu' -or $managed.enabled -or @($custom.domains).Count){throw 'Product bucket is not qualified private EU storage'}
        $report.after+=@{name=$current.name;jurisdiction=$current.jurisdiction;public=$false;creationDate=$current.creation_date}
    }
    if($Action -in @('PlanCredential','ApplyCredential')){
        $credentialPath=Join-Path $StateRoot 'auth/cloudflare/iecode-r2-s3.dpapi'
        $endpoint='https://'+$account+'.eu.r2.cloudflarestorage.com'
        $report.storageCredential=@{operation='current';store='auth/cloudflare/iecode-r2-s3.dpapi';endpoint=$endpoint;buckets=$names;permission='Workers R2 Storage Bucket Item Write';qualified=$false}
        if(Test-Path -LiteralPath $credentialPath){
            $credentialBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialPath),$null,'CurrentUser')
            try{
                $credential=[Text.Encoding]::UTF8.GetString($credentialBytes)|ConvertFrom-Json
                if($credential.account -ne $account -or $credential.endpoint -ne $endpoint -or (@($credential.buckets|Sort-Object) -join ',') -ne ($names -join ',') -or -not $credential.accessKeyId -or -not $credential.secretAccessKey){throw 'Existing product storage credential scope mismatch'}
                $report.storageCredential.qualified=$true
            }finally{[Array]::Clear($credentialBytes,0,$credentialBytes.Length);$credential=$null}
        }else{
            $report.storageCredential.operation='create'
            $ownerBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot 'auth/cloudflare/owner-token.dpapi')),$null,'CurrentUser')
            $nativeHeaders=$taskHeaders
            $created=$null;$persisted=$false
            try{
                $taskHeaders=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($ownerBytes)}
                $permissions=@(Cf '/user/tokens/permission_groups')
                $permission=@($permissions|Where-Object {$_.name -eq 'Workers R2 Storage Bucket Item Write' -and $_.is_selectable})
                if($permission.Count -ne 1){throw 'Unique selectable R2 object permission required'}
                $resources=@{}
                foreach($name in $names){$resources['com.cloudflare.edge.r2.bucket.'+$account+'_eu_'+$name]='*'}
                $report.storageCredential.resources=@($resources.Keys|Sort-Object)
                [IO.File]::WriteAllText((Join-Path $backup 'credential-plan.json'),($report.storageCredential|ConvertTo-Json -Depth 8))
                if($Action -eq 'ApplyCredential'){
                    $created=Cf '/user/tokens' 'POST' @{name='IECODE and RG private EU object storage';policies=@(@{effect='allow';resources=$resources;permission_groups=@(@{id=$permission[0].id})})}
                    if(-not $created.id -or -not $created.value){throw 'Incomplete product credential issuance'}
                    $digest=[Security.Cryptography.SHA256]::Create()
                    try{$secret=([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($created.value)))).Replace('-','').ToLowerInvariant()}finally{$digest.Dispose()}
                    $plain=[Text.Encoding]::UTF8.GetBytes((@{account=$account;accessKeyId=$created.id;secretAccessKey=$secret;endpoint=$endpoint;buckets=$names}|ConvertTo-Json -Compress))
                    $temporary=$credentialPath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
                    try{
                        [IO.File]::WriteAllBytes($temporary,[Security.Cryptography.ProtectedData]::Protect($plain,$null,'CurrentUser'))
                        [IO.File]::Move($temporary,$credentialPath)
                        $persisted=$true;$report.storageCredential.qualified=$true
                    }finally{[Array]::Clear($plain,0,$plain.Length);$secret=$null;if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
                }
            }catch{
                if($created.id -and -not $persisted){Cf ('/user/tokens/'+$created.id) 'DELETE'|Out-Null}
                throw
            }finally{[Array]::Clear($ownerBytes,0,$ownerBytes.Length);$taskHeaders=$nativeHeaders;$created=$null}
        }
    }
    $afterRecords=@(Cf ('/zones/'+$zone.id+'/dns_records?per_page=500'))
    if(($records|ConvertTo-Json -Depth 20 -Compress) -ne ($afterRecords|ConvertTo-Json -Depth 20 -Compress)){throw 'Concurrent DNS drift observed; no DNS write performed by this adapter'}
    [IO.File]::WriteAllText((Join-Path $backup 'receipt.json'),($report|ConvertTo-Json -Depth 15))
    $report|ConvertTo-Json -Depth 15
}finally{[Array]::Clear($bytes,0,$bytes.Length);$taskHeaders=$null}
