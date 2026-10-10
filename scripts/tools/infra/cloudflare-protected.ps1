# SPDX-License-Identifier: Apache-2.0
# Isolated Cloudflare bearer adapter; secrets never appear in output or arguments.
[CmdletBinding()]
param([ValidateSet('Audit','CreateOwnerToken')][string]$Action='Audit',[string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
$store=Join-Path $StateRoot 'auth/cloudflare'
Add-Type -AssemblyName System.Security
$credential=if($Action -eq 'Audit' -and (Test-Path -LiteralPath (Join-Path $store 'native-token.dpapi'))){'native-token.dpapi'}else{'owner-token.dpapi'}
$bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $store $credential)),$null,'CurrentUser')
try{
    $headers=@{Authorization='Bearer '+[Text.Encoding]::UTF8.GetString($bytes)}
    function Invoke-Cf([string]$Path,[string]$Method='GET',$Body=$null){
        $options=@{Uri='https://api.cloudflare.com/client/v4'+$Path;Headers=$headers;Method=$Method;TimeoutSec=30;ErrorAction='Stop'}
        if($null -ne $Body){$options.Body=$Body|ConvertTo-Json -Depth 12 -Compress;$options.ContentType='application/json'}
        try{$response=Invoke-RestMethod @options}catch{
            $errorCodes='unknown'
            try{
                $failureText=$_.ErrorDetails.Message
                if(-not $failureText){$reader=New-Object IO.StreamReader($_.Exception.Response.GetResponseStream());try{$failureText=$reader.ReadToEnd()}finally{$reader.Dispose()}}
                $failure=$failureText|ConvertFrom-Json
                $errorCodes=($failure.errors|ForEach-Object {$_.code}) -join ','
            }catch{}
            throw ('Cloudflare request failed: '+$Path+' HTTP '+[int]$_.Exception.Response.StatusCode+' codes '+$errorCodes)
        }
        if(-not $response.success){throw ('Cloudflare rejected request: '+$Path)}
        return $response.result
    }
    $verify=Invoke-Cf '/user/tokens/verify'
    $accounts=@(Invoke-Cf '/accounts')
    $zones=@(Invoke-Cf '/zones?name=aphrody.com')
    $user=Invoke-Cf '/user'
    $groups=@()
    if($Action -eq 'CreateOwnerToken'){$groups=@(Invoke-Cf '/user/tokens/permission_groups')}
    if($verify.status -ne 'active' -or $accounts.Count -ne 1 -or $zones.Count -ne 1 -or $zones[0].account.id -ne $accounts[0].id){throw 'Owner account/zone identity did not qualify'}
    $report=[ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');authenticated=$true;accountId=$accounts[0].id;zoneId=$zones[0].id;zoneStatus=$zones[0].status;permissionGroups=if($Action -eq 'CreateOwnerToken'){$groups.Count}else{$null};issuedTokenId=$null;issuedPermissionGroups=$null;dnsMutation=$false}
    if($Action -eq 'Audit'){
        $buckets=Invoke-Cf ('/accounts/'+$accounts[0].id+'/r2/buckets')
        $records=@(Invoke-Cf ('/zones/'+$zones[0].id+'/dns_records'))
        $report.r2BucketCount=@($buckets.buckets).Count
        $report.dnsRecordCount=$records.Count
    }
    if($Action -eq 'CreateOwnerToken'){
        $destination=Join-Path $store 'native-token.dpapi'
        if(Test-Path -LiteralPath $destination){throw 'Native token already exists; refusing duplicate issuance or overwrite'}
        $policies=@()
        foreach($scope in @('com.cloudflare.api.user','com.cloudflare.api.account','com.cloudflare.api.account.zone')){
            $selected=@($groups|Where-Object {$_.is_selectable -eq $true -and $_.scopes -contains $scope -and -not $_.meta.deprecated -and $_.name -notmatch '^(Account )?API Tokens (Read|Write)$'}|ForEach-Object {@{id=$_.id}})
            $resource=if($scope -eq 'com.cloudflare.api.user'){@{('com.cloudflare.api.user.'+$user.id)='*'}}elseif($scope -eq 'com.cloudflare.api.account'){@{('com.cloudflare.api.account.'+$accounts[0].id)='*'}}else{@{('com.cloudflare.api.account.'+$accounts[0].id)=@{'com.cloudflare.api.account.zone.*'='*'}}}
            for($offset=0;$offset -lt $selected.Count;$offset+=300){
                $last=[Math]::Min($offset+299,$selected.Count-1)
                $policies+=@{effect='allow';resources=$resource;permission_groups=@($selected[$offset..$last])}
            }
        }
        $created=Invoke-Cf '/user/tokens' 'POST' @{name='Aphrody native owner automation';policies=$policies}
        if(-not $created.value){throw 'Token creation returned no credential'}
        $secret=[Text.Encoding]::UTF8.GetBytes($created.value)
        try{[IO.File]::WriteAllBytes($destination,[Security.Cryptography.ProtectedData]::Protect($secret,$null,'CurrentUser'))}finally{[Array]::Clear($secret,0,$secret.Length)}
        $report.issuedTokenId=$created.id
        $report.issuedPermissionGroups=($policies|ForEach-Object {$_.permission_groups.Count}|Measure-Object -Sum).Sum
        $created=$null
    }
    $json=$report|ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText((Join-Path $store 'audit-status.json'),$json)
    Write-Output $json
}finally{[Array]::Clear($bytes,0,$bytes.Length);$headers=$null}
