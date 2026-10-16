# SPDX-License-Identifier: Apache-2.0
# Explicit owner-domain transition; never exposes credentials or modifies other zones.
[CmdletBinding()]
param([ValidateSet('Plan','DisableOvhDnssec','SwitchNameServers')][string]$Action='Plan',[string]$StateRoot)
$ErrorActionPreference='Stop'
function Parent-DsProof {
    $proof=@()
    foreach($server in @('a.gtld-servers.net','b.gtld-servers.net')){
        $address=(Resolve-DnsName $server -Type A -DnsOnly -ErrorAction Stop|Where-Object {$_.IPAddress}|Select-Object -First 1).IPAddress
        $id=Get-Random -Minimum 1 -Maximum 65535
        $query=[byte[]]@(($id -shr 8),($id -band 255),0,0,0,1,0,0,0,0,0,0,7,97,112,104,114,111,100,121,3,99,111,109,0,0,43,0,1)
        $udp=New-Object Net.Sockets.UdpClient
        try{
            $udp.Client.ReceiveTimeout=5000;$udp.Connect($address,53);$udp.Send($query,$query.Length)|Out-Null
            $endpoint=New-Object Net.IPEndPoint([Net.IPAddress]::Any,0)
            $reply=$udp.Receive([ref]$endpoint)
            function U16([int]$Position){if($Position+1 -ge $reply.Length){throw 'Truncated DNS packet'};return ([int]$reply[$Position]*256+[int]$reply[$Position+1])}
            if($reply.Length -lt 12 -or (U16 0) -ne $id -or ($reply[2] -band 128) -eq 0 -or ($reply[2] -band 4) -eq 0 -or ($reply[2] -band 2) -ne 0 -or ($reply[3] -band 15) -ne 0 -or (U16 4) -ne 1){throw 'Parent DS reply not authoritative successful proof'}
            $answerCount=U16 6;$authorityCount=U16 8;$additionalCount=U16 10
            $position=12
            function Skip-Name([int]$Position){
                for($limit=0;$limit -lt 128;$limit++){
                    if($Position -ge $reply.Length){throw 'Truncated DNS name'}
                    $length=[int]$reply[$Position];$Position++
                    if($length -eq 0){return $Position}
                    if(($length -band 192) -eq 192){if($Position -ge $reply.Length){throw 'Truncated DNS pointer'};return $Position+1}
                    if($length -gt 63){throw 'Invalid DNS label'};$Position+=$length
                };throw 'DNS name limit exceeded'
            }
            $position=(Skip-Name $position)+4
            if($position -ne $query.Length){throw 'Unexpected DNS question length'}
            for($i=12;$i -lt $query.Length;$i++){if($reply[$i] -ne $query[$i]){throw 'Parent DNS question mismatch'}}
            $dsCount=0;$soaCount=0
            for($i=0;$i -lt ($answerCount+$authorityCount+$additionalCount);$i++){
                $position=Skip-Name $position;$type=U16 $position;$length=U16 ($position+8)
                if($i -lt $answerCount -and $type -eq 43){$dsCount++}
                if($i -ge $answerCount -and $i -lt $answerCount+$authorityCount -and $type -eq 6){$soaCount++}
                $position+=10+$length;if($position -gt $reply.Length){throw 'Truncated DNS record'}
            }
            $proof+=@{server=$server;dsCount=$dsCount;authoritative=$true;absenceProven=($dsCount -eq 0 -and $soaCount -gt 0)}
        }finally{$udp.Dispose()}
    }
    return $proof
}
if(-not $StateRoot){$StateRoot=if($env:APHRODY_HOME){$env:APHRODY_HOME}else{Join-Path $env:USERPROFILE '.aphrody'}}
Add-Type -AssemblyName System.Security
function Read-Protected([string]$Relative){
    $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $StateRoot $Relative)),$null,'CurrentUser')
    try{return [Text.Encoding]::UTF8.GetString($bytes)}finally{[Array]::Clear($bytes,0,$bytes.Length)}
}
$cf=Read-Protected 'auth/cloudflare/native-token.dpapi'
$pair=(Read-Protected 'auth/ovh/service-account.dpapi')|ConvertFrom-Json
try{
    $oauth=Invoke-RestMethod 'https://www.ovh.com/auth/oauth2/token' -Method Post -Body @{grant_type='client_credentials';client_id=$pair.client_id;client_secret=$pair.client_secret;scope='all'} -TimeoutSec 30
    $oh=@{Authorization='Bearer '+$oauth.access_token};$ch=@{Authorization='Bearer '+$cf}
    function Ovh([string]$Path,[string]$Method='GET',$Body=$null){
        $options=@{Uri='https://eu.api.ovh.com/1.0'+$Path;Method=$Method;Headers=$oh;TimeoutSec=30}
        if($null -ne $Body){$options.Body=$Body|ConvertTo-Json -Depth 8 -Compress;$options.ContentType='application/json'}
        try{$result=Invoke-RestMethod @options;foreach($item in $result){Write-Output $item}}catch{throw ('OVH request failed '+$Path+' HTTP '+[int]$_.Exception.Response.StatusCode)}
    }
    function Cf([string]$Path){$response=Invoke-RestMethod ('https://api.cloudflare.com/client/v4'+$Path) -Headers $ch -TimeoutSec 30;if(-not $response.success){throw 'Cloudflare read failed'};return $response.result}
    $zone=Cf '/zones/963461271f885bc3f3c2bfd586f2b7ba'
    if($zone.name -ne 'aphrody.com' -or $zone.account.id -ne 'ca22c1a51a145f919b54afa18d936516'){throw 'Declared zone identity changed'}
    $ns=@($zone.name_servers|Sort-Object)
    if(($ns -join ',') -ne 'duke.ns.cloudflare.com,veda.ns.cloudflare.com'){throw 'Assigned nameservers changed; review required'}
    $records=@(Cf '/zones/963461271f885bc3f3c2bfd586f2b7ba/dns_records?per_page=500')
    if(@($records|Where-Object proxied).Count){throw 'Unexpected proxying; refusing transition'}
    $ids=@(Ovh '/domain/zone/aphrody.com/record')
    $ovhRecords=@(foreach($id in $ids){Ovh ('/domain/zone/aphrody.com/record/'+$id)})
    $ovhExport=Ovh '/domain/zone/aphrody.com/export'
    if($ovhExport -notmatch '(?m)^\$TTL\s+(\d+)'){throw 'OVH export default TTL missing'}
    $ovhDefaultTtl=[int]$Matches[1]
    function Canonical($Record,[bool]$Cloudflare){
        $type=if($Cloudflare){$Record.type}else{$Record.fieldType}
        if($type -eq 'SPF'){$type='TXT'}
        if($type -in @('SOA','NS')){return $null}
        $name=if($Cloudflare){$Record.name}else{if($Record.subDomain){$Record.subDomain+'.aphrody.com'}else{'aphrody.com'}}
        $value=if($Cloudflare){$Record.content}else{$Record.target}
        if($type -eq 'MX' -and $Cloudflare){$value=([string]$Record.priority)+' '+$value}
        if($type -eq 'SRV' -and $Cloudflare){$value=([string]$Record.data.priority)+' '+$Record.data.weight+' '+$Record.data.port+' '+$Record.data.target}
        if($type -eq 'TXT'){
            if($value.StartsWith('"') -and $value.EndsWith('"')){try{$value=$value|ConvertFrom-Json}catch{throw 'TXT quoted value could not normalize'}}
        }else{$value=$value.TrimEnd('.').ToLowerInvariant()}
        $ttl=if(-not $Cloudflare -and $Record.ttl -eq 0){$ovhDefaultTtl}else{$Record.ttl}
        return ($name.ToLowerInvariant()+'|'+$type+'|'+$ttl+'|'+$value)
    }
    $left=@($ovhRecords|ForEach-Object {Canonical $_ $false}|Where-Object {$null -ne $_}|Sort-Object -Unique)
    $right=@($records|ForEach-Object {Canonical $_ $true}|Where-Object {$null -ne $_}|Sort-Object -Unique)
    $diff=@(Compare-Object $left $right)
    $dnssec=Ovh '/domain/zone/aphrody.com/dnssec'
    $tlsOk=$false
    try{$https=Invoke-WebRequest 'https://aphrody.com/' -UseBasicParsing -TimeoutSec 15;$tlsOk=$https.StatusCode -eq 200}catch{}
    $backup=Join-Path $StateRoot ('backup/dns/cutover-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    New-Item -ItemType Directory -Path $backup|Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
    Set-Acl -LiteralPath $backup -AclObject $acl
    foreach($entry in @(@{name='ovh-records.json';data=$ovhRecords},@{name='cloudflare-records.json';data=$records},@{name='cloudflare-zone.json';data=$zone})){
        $path=Join-Path $backup $entry.name;[IO.File]::WriteAllText($path,($entry.data|ConvertTo-Json -Depth 15));$hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;[IO.File]::WriteAllText($path+'.sha256',$hash);if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash){throw 'Backup checksum mismatch'}
    }
    $differenceMetadata=@($diff|ForEach-Object {$parts=$_.InputObject -split '\|',4;@{name=$parts[0];type=$parts[1];ttl=$parts[2];side=$_.SideIndicator}})
    $parentProof=@(Parent-DsProof)
    $plan=[ordered]@{action=$Action;domain='aphrody.com';zoneStatus=$zone.status;assignedNameServers=$ns;ovhRecords=$ovhRecords.Count;cloudflareRecords=$records.Count;nonDelegationDiffCount=$diff.Count;differenceMetadata=$differenceMetadata;dnssec=$dnssec.status;parentDsProof=$parentProof;httpsVerified=$tlsOk;backup=$backup;mailPreserved=($diff.Count -eq 0);proxyEnabled=$false}
    if($Action -ne 'Plan'){
        if($diff.Count -or -not $tlsOk){throw 'DNS parity or validated HTTPS is not ready; no mutation applied'}
        if($Action -eq 'DisableOvhDnssec'){
            if($dnssec.status -eq 'enabled'){Ovh '/domain/zone/aphrody.com/dnssec' 'DELETE'|Out-Null;$plan.applied='dnssec-disable-requested'}else{$plan.applied='no-change'}
        }else{
            if($parentProof.Count -ne 2 -or @($parentProof|Where-Object {-not $_.absenceProven}).Count -or $dnssec.status -ne 'disabled'){throw 'Parent DS removal and disabled OVH DNSSEC not yet verified; no NS mutation'}
            $task=Ovh '/domain/aphrody.com/nameServers/update' 'POST' @{nameServers=@($ns|ForEach-Object {@{host=$_}})}
            $plan.applied='nameserver-update-requested';$plan.taskId=$task.id
        }
    }
    $json=$plan|ConvertTo-Json -Depth 5;[IO.File]::WriteAllText((Join-Path $backup 'plan.json'),$json);Write-Output $json
}finally{$cf=$null;$pair=$null;$oauth=$null;$oh=$null;$ch=$null}
