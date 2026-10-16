# SPDX-License-Identifier: Apache-2.0
# Aphrody Infra owns bootstrap; registration and connection remain separate.
[CmdletBinding()]
param([ValidateSet('plan','download','install','status','verify')][string]$Phase='plan',
 [Parameter(Mandatory=$true)][string]$WorkspacePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$version='2026.8.2110.0'
$expectedSha256='f4668340028aa209a148b5d0a15846434e2c90ae2596841e9c75fd607cf045a5'
$installAttempted=$false
$url="https://downloads.cloudflareclient.com/v1/download/windows/version/$version"
$root=[IO.Path]::GetFullPath($WorkspacePath).TrimEnd('\')
$cache=Join-Path $root "install\cache\cloudflare-one\$version"
$msi=Join-Path $cache 'Cloudflare-One-x64.msi'
$receiptPath=Join-Path $cache 'download-receipt.json'
$installReceiptPath=Join-Path $cache 'install-receipt.json'
$limit=100MB
function Assert-SafePath([string]$Path) {
 $full=[IO.Path]::GetFullPath($Path)
 if($full -ne $root -and !$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'CACHE_OUTSIDE_WORKSPACE'}
 $cursor=$full
 while($cursor){
  if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_POINT_REFUSED'}}
  $parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent
 }
}
function Get-Identity {
 Assert-SafePath $msi
 $f=Get-Item -LiteralPath $msi
 if($f.PSIsContainer -or $f.Length -le 0 -or $f.Length -gt $limit){throw 'MSI_SIZE_INVALID'}
 $hash=(Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
 if($hash -ne $expectedSha256){throw 'MSI_OBSERVED_SHA256_MISMATCH'}
 $signature=Get-AuthenticodeSignature -LiteralPath $msi
 if($signature.Status -ne 'Valid' -or !$signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O="?Cloudflare,? Inc\.?"?(?:,|$)'){throw 'CLOUDFLARE_SIGNATURE_REQUIRED'}
 $installer=New-Object -ComObject WindowsInstaller.Installer
 $db=$installer.GetType().InvokeMember('OpenDatabase','InvokeMethod',$null,$installer,@([string]$msi,0))
 $summary=$db.GetType().InvokeMember('SummaryInformation','GetProperty',$null,$db,@(0))
 $template=$summary.GetType().InvokeMember('Property','GetProperty',$null,$summary,@(7))
 if($template -notmatch '^x64;'){throw 'MSI_X64_REQUIRED'}
 $view=$db.GetType().InvokeMember('OpenView','InvokeMethod',$null,$db,@("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ProductVersion'"))
 $view.GetType().InvokeMember('Execute','InvokeMethod',$null,$view,$null)|Out-Null
 $record=$view.GetType().InvokeMember('Fetch','InvokeMethod',$null,$view,$null)
 $actualVersion=$record.GetType().InvokeMember('StringData','GetProperty',$null,$record,@(1))
 if($actualVersion -ne '26.8.2110.0'){throw 'MSI_VERSION_MISMATCH'}
 foreach($com in @($record,$view,$summary,$db,$installer)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)|Out-Null}
 return @{version=$version;msiProductVersion=$actualVersion;architecture='x64';bytes=$f.Length;sha256=$hash;publisher=$signature.SignerCertificate.Subject;signerThumbprint=$signature.SignerCertificate.Thumbprint;signature='Valid'}
}
function Get-VerifiedDownload {
 Assert-SafePath $receiptPath
 $receipt=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json
 $identity=Get-Identity
 if($receipt.schema -ne 1 -or $receipt.owner -ne 'aphrody-infra-cloudflare-one' -or $receipt.sourceUrl -ne $url -or $receipt.artifact.sha256 -ne $identity.sha256){throw 'DOWNLOAD_ATTESTATION_MISMATCH'}
 return $identity
}
function Get-InstalledState {
 $identity=Get-VerifiedDownload
 $svc=Get-Service -Name CloudflareWARP -ErrorAction SilentlyContinue
 if(!$svc -or $svc.Status -ne 'Running' -or $svc.StartType -ne 'Automatic'){throw 'CLOUDFLARE_WARP_SERVICE_NOT_HEALTHY'}
 $binary=Join-Path $env:ProgramFiles 'Cloudflare\Cloudflare WARP\warp-svc.exe'
 $file=Get-Item -LiteralPath $binary
 $signature=Get-AuthenticodeSignature -LiteralPath $binary
 if($file.VersionInfo.ProductVersion -ne $version -or $signature.Status -ne 'Valid' -or !$signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O="?Cloudflare,? Inc\.?"?(?:,|$)'){throw 'INSTALLED_BINARY_IDENTITY_MISMATCH'}
 $products=@(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'|ForEach-Object {Get-ItemProperty $_.PSPath}|Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'Cloudflare One Client' })
 if($products.Count -ne 1 -or $products[0].DisplayVersion -ne '26.8.2110.0' -or $products[0].Publisher -ne 'Cloudflare, Inc.'){throw 'INSTALLED_REGISTRY_IDENTITY_MISMATCH'}
 $execution=$null
 if(Test-Path -LiteralPath $installReceiptPath){Assert-SafePath $installReceiptPath;$execution=Get-Content -LiteralPath $installReceiptPath -Raw|ConvertFrom-Json;if($execution.owner -ne 'aphrody-infra-cloudflare-one' -or $execution.schema -ne 1 -or $execution.artifact.sha256 -ne $identity.sha256){throw 'INSTALL_RECEIPT_IDENTITY_MISMATCH'}}
 return @{phase=$Phase;complete=$true;installed=$true;artifact=$identity;service='CloudflareWARP';serviceState=[string]$svc.Status;serviceStart=[string]$svc.StartType;installedProductVersion=$file.VersionInfo.ProductVersion;installedBinarySha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant();registryVersion=$products[0].DisplayVersion;installExecutionReceiptPresent=($null -ne $execution);installExecution=$execution;enrolled=$null;connected=$null}
}
try {
 if(![Environment]::Is64BitProcess -or ![Environment]::Is64BitOperatingSystem){throw 'NATIVE_WINDOWS_X64_REQUIRED'}
 if(!(Test-Path -LiteralPath $root -PathType Container) -or !(Test-Path -LiteralPath (Join-Path $root '.git'))){throw 'EXISTING_GIT_WORKSPACE_REQUIRED'}
 Assert-SafePath $cache
 if(Test-Path -LiteralPath $cache){foreach($item in Get-ChildItem -LiteralPath $cache -Force){Assert-SafePath $item.FullName;if($item.PSIsContainer -or $item.Name -notin @('Cloudflare-One-x64.msi','download-receipt.json','install-receipt.json')){throw 'FOREIGN_CACHE_ENTRY_REFUSED'}}}
 $services=@(Get-Service -Name CloudflareWARP,WarpSvc -ErrorAction SilentlyContinue)
 $existing=($services.Count -gt 0 -or (Test-Path -LiteralPath "$env:ProgramFiles\Cloudflare\Cloudflare WARP\warp-svc.exe"))
 if($Phase -eq 'plan'){@{phase=$Phase;version=$version;url=$url;cache=$cache;existingClient=$existing;installRequiresAdmin=$true;downloadLimitBytes=$limit;minimumFreeAfterBytes=300MB;installed=$null;enrolled=$null;connected=$null}|ConvertTo-Json -Compress;exit 0}
 if($Phase -in @('status','verify')){Get-InstalledState|ConvertTo-Json -Depth 7 -Compress;exit 0}
 if($Phase -eq 'download'){
  if(!(Test-Path -LiteralPath $msi)){
   Add-Type -AssemblyName System.Net.Http
   $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
   $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(120)
   $cancel=[Threading.CancellationTokenSource]::new(120000)
   $uri=[uri]$url;$response=$null
   try {
    for($hop=0;$hop -lt 6;$hop++){
     if($uri.Scheme -ne 'https' -or $uri.Host -ne 'downloads.cloudflareclient.com' -or $uri.UserInfo){throw 'NON_OFFICIAL_REDIRECT_REFUSED'}
     $response=$client.GetAsync($uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
     if([int]$response.StatusCode -in @(301,302,303,307,308)){$next=[uri]::new($uri,$response.Headers.Location);$response.Dispose();$response=$null;$uri=$next;continue};break
    }
    if(!$response -or [int]$response.StatusCode -ne 200){throw 'OFFICIAL_DOWNLOAD_HTTP_FAILED'}
    $length=$response.Content.Headers.ContentLength
    if(!$length -or $length -le 0 -or $length -gt $limit){throw 'DOWNLOAD_SIZE_PREFLIGHT_FAILED'}
    $volume=Get-Volume -DriveLetter ([IO.Path]::GetPathRoot($root).Substring(0,1))
    if($volume.SizeRemaining - $length -lt 300MB){throw 'INSUFFICIENT_CACHE_CAPACITY'}
    [IO.Directory]::CreateDirectory($cache)|Out-Null;Assert-SafePath $cache
    $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $file=[IO.File]::Open($msi,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$buffer=New-Object byte[] 65536;$total=0L;while(($count=$stream.ReadAsync($buffer,0,$buffer.Length,$cancel.Token).GetAwaiter().GetResult()) -gt 0){$total+=$count;if($total -gt $length -or $total -gt $limit){throw 'DOWNLOAD_SIZE_CHANGED'};$file.Write($buffer,0,$count)};if($total -ne $length){throw 'DOWNLOAD_TRUNCATED'}}
    finally {$file.Dispose();$stream.Dispose()}
   }finally {if($response){$response.Dispose()};$cancel.Dispose();$client.Dispose();$handler.Dispose()}
  }
  $identity=Get-Identity
  $receipt=@{schema=1;owner='aphrody-infra-cloudflare-one';sourceUrl=$url;observedAt=[DateTime]::UtcNow.ToString('o');artifact=$identity;installed=$null;enrolled=$null;connected=$null}
  Assert-SafePath $receiptPath
  if(Test-Path -LiteralPath $receiptPath){$previous=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json;if($previous.owner -ne $receipt.owner -or $previous.artifact.sha256 -ne $identity.sha256){throw 'FOREIGN_OR_CHANGED_RECEIPT'}}
  else {[IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))}
  $receipt|ConvertTo-Json -Depth 5 -Compress;exit 0
 }
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'GENUINE_NATIVE_ADMIN_REQUIRED'}
 if($existing){throw 'EXISTING_CLIENT_REQUIRES_SEPARATE_REVIEW'}
 if(Test-Path -LiteralPath "$env:ProgramData\Cloudflare\mdm.xml"){throw 'EXISTING_MANAGED_CONFIGURATION_REQUIRES_REVIEW'}
 $identity=Get-VerifiedDownload
 Assert-SafePath $installReceiptPath
 if(Test-Path -LiteralPath $installReceiptPath){throw 'EXISTING_INSTALL_ATTEMPT_REQUIRES_REVIEW'}
 $execution=@{schema=1;owner='aphrody-infra-cloudflare-one';artifact=$identity;startedAt=[DateTime]::UtcNow.ToString('o');command='msiexec /i <verified-msi> /qn /norestart ORGANIZATION=aphrody-labs';nativeExitCode=$null;completed=$false;healthVerified=$false}
 [IO.File]::WriteAllText($installReceiptPath,($execution|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 $installAttempted=$true
 $process=Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @('/i',('"'+$msi+'"'),'/qn','/norestart','ORGANIZATION=aphrody-labs') -WindowStyle Hidden -PassThru
 if(!$process.WaitForExit(180000)){throw 'INSTALL_TIMEOUT_STATE_REQUIRES_REVIEW'}
 $execution.nativeExitCode=$process.ExitCode;$execution.completed=$true;$execution.completedAt=[DateTime]::UtcNow.ToString('o')
 Assert-SafePath $installReceiptPath
 [IO.File]::WriteAllText($installReceiptPath,($execution|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 if($process.ExitCode -notin @(0,3010)){throw "INSTALL_FAILED_$($process.ExitCode)"}
 $state=Get-InstalledState
 $execution.healthVerified=$true
 Assert-SafePath $installReceiptPath
 [IO.File]::WriteAllText($installReceiptPath,($execution|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 $state.installExecution=$execution;$state.rebootRequired=($process.ExitCode -eq 3010);$state|ConvertTo-Json -Depth 7 -Compress
}catch{@{phase=$Phase;complete=$false;error=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber;installAttempted=$installAttempted;installed=$null;enrolled=$null;connected=$null}|ConvertTo-Json -Compress;exit 1}
