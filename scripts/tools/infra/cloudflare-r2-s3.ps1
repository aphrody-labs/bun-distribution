# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Create,[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$store=Join-Path $StateRoot 'auth/cloudflare'
$destination=Join-Path $store 'r2-s3.dpapi'
Add-Type -AssemblyName System.Security
$account='ca22c1a51a145f919b54afa18d936516'
if($Create){
    if(Test-Path -LiteralPath $destination){throw 'Existing S3 credential retained; refusing duplicate issuance'}
    $bootstrap=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $store 'owner-token.dpapi')),$null,'CurrentUser')
    try{
        $headers=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($bootstrap)}
        $groups=(Invoke-RestMethod 'https://api.cloudflare.com/client/v4/user/tokens/permission_groups' -Headers $headers -TimeoutSec 30).result
        $write=@($groups|Where-Object {$_.name -eq 'Workers R2 Storage Bucket Item Write' -and $_.is_selectable})
        if($write.Count -ne 1){throw 'Unique selectable bucket write permission not found'}
        $buckets=(Invoke-RestMethod ('https://api.cloudflare.com/client/v4/accounts/'+$account+'/r2/buckets') -Headers $headers -TimeoutSec 30).result.buckets
        $resources=@{}
        foreach($name in @('aphrody-assets','aphrody-dist')){
            $bucket=@($buckets|Where-Object {$_.name -eq $name})
            if($bucket.Count -ne 1){throw 'Declared R2 bucket identity missing'}
            $jurisdiction=if($bucket[0].jurisdiction){$bucket[0].jurisdiction}else{'default'}
            if($jurisdiction -ne 'default'){throw 'Jurisdiction requires dedicated qualified endpoint'}
            $resources['com.cloudflare.edge.r2.bucket.'+$account+'_'+$jurisdiction+'_'+$name]='*'
        }
        $body=@{name='Aphrody assets and dist S3';policies=@(@{effect='allow';resources=$resources;permission_groups=@(@{id=$write[0].id})})}|ConvertTo-Json -Depth 8 -Compress
        try{$created=(Invoke-RestMethod 'https://api.cloudflare.com/client/v4/user/tokens' -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30).result}catch{throw 'Cloudflare S3 token issuance failed; no credential printed'}
        if(-not $created.id -or -not $created.value){throw 'S3 issuance returned incomplete credential'}
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$secret=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($created.value)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
        $plain=[Text.Encoding]::UTF8.GetBytes((@{account=$account;accessKeyId=$created.id;secretAccessKey=$secret;endpoint='https://'+$account+'.r2.cloudflarestorage.com';buckets=@('aphrody-assets','aphrody-dist')}|ConvertTo-Json -Compress))
        try{[IO.File]::WriteAllBytes($destination,[Security.Cryptography.ProtectedData]::Protect($plain,$null,'CurrentUser'))}finally{[Array]::Clear($plain,0,$plain.Length)}
        Write-Output ('Issued bucket-scoped S3 credential ID '+$created.id)
        $created=$null;$secret=$null;$headers=$null
    }finally{[Array]::Clear($bootstrap,0,$bootstrap.Length)}
}
$decoded=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($destination),$null,'CurrentUser')
$old=@{}
foreach($name in @('CLOUDFLARE_ACCOUNT_ID','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY')){$old[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
    $credential=[Text.Encoding]::UTF8.GetString($decoded)|ConvertFrom-Json
    $env:CLOUDFLARE_ACCOUNT_ID=$credential.account
    $env:AWS_ACCESS_KEY_ID=$credential.accessKeyId
    $env:AWS_SECRET_ACCESS_KEY=$credential.secretAccessKey
    & bun (Join-Path $PSScriptRoot '../../audit/r2-s3-protected.ts')
    if($LASTEXITCODE){throw 'Native S3 qualification failed'}
}finally{
    foreach($name in $old.Keys){[Environment]::SetEnvironmentVariable($name,$old[$name],'Process')}
    [Array]::Clear($decoded,0,$decoded.Length);$credential=$null
}
