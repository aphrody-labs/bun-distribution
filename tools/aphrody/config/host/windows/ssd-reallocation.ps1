# SPDX-License-Identifier: Apache-2.0
# Owner-authorized disk0 operations only. Root invokes via native Windows UAC.
param([Parameter(Mandatory=$true)][ValidateSet('disable-winre','extend-c','verify')][string]$Phase)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$rows=@(
 @(1,'67ea7b29-d113-41e1-8cb4-c8f243345336','c12a7328-f81f-11d2-ba4b-00a0c93ec93b',1048576,272629760),
 @(2,'fe083a25-a65b-4ae9-bb06-533039ae9d29','e3c9e316-0b5c-4db8-817d-f92df00215ae',273678336,16777216),
 @(3,'e1eae83d-a9f4-42da-a334-a115ecf46eb1','ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',290455552,996911947264),
 @(4,'ef33b7e4-c8b9-4798-8b2b-859bbc2eac39','de94bba4-06d1-4d40-a16a-bfd50179d6ac',997203116032,963641344),
 @(5,'6cd6d60d-66a8-4187-930f-62ff3a69a665','ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',998166757376,25769803776),
 @(6,'8942130b-6c3b-421a-8684-afd63f38a795','de94bba4-06d1-4d40-a16a-bfd50179d6ac',1023936561152,272629760)
)
$deleted=@()
function Assert-Layout([int[]]$Remaining,[switch]$Expanded) {
 $d=Get-Disk -Number 0
 if($d.FriendlyName -ne 'NVMe Micron_2400_MTFDKBA1T0QFM' -or $d.Size -ne 1024209543168 -or $d.PartitionStyle -ne 'GPT' -or !$d.IsBoot -or !$d.IsSystem -or $d.IsOffline -or $d.IsReadOnly -or $d.HealthStatus -ne 'Healthy'){throw 'DISK_CHANGED'}
 $parts=@(Get-Partition -DiskNumber 0)
 if($parts.Count -ne $Remaining.Count){throw 'LAYOUT_CHANGED'}
 foreach($n in $Remaining){$r=$rows[$n-1];$p=@($parts | Where-Object PartitionNumber -eq $n)
  if($p.Count -ne 1 -or [guid]$p[0].Guid -ne [guid]$r[1] -or [guid]$p[0].GptType -ne [guid]$r[2] -or $p[0].Offset -ne $r[3]){throw 'PARTITION_ID_CHANGED'}
  if(!($Expanded -and $n -eq 3) -and $p[0].Size -ne $r[4]){throw 'PARTITION_SIZE_CHANGED'}
 }
 $c=Get-Partition -DriveLetter C
 if($c.DiskNumber -ne 0 -or $c.PartitionNumber -ne 3 -or !(Test-Path -LiteralPath 'C:\bun' -PathType Container)){throw 'C_OR_BUN_CHANGED'}
}
function Get-WinReState {
 $text=(& "$env:SystemRoot\System32\reagentc.exe" /info 2>&1 | Out-String)
 if($LASTEXITCODE -ne 0){throw 'WINRE_INFO_FAILED'}
 $matches=@([regex]::Matches($text,'(?im)^\s*[^\r\n:]+:\s*(Enabled|Disabled|Activ[eé]|D[eé]sactiv[eé])\s*$'))
 if($matches.Count -ne 1){throw 'WINRE_STATE_UNRECOGNIZED'}
 if($matches[0].Groups[1].Value -match '^(Disabled|D[eé]sactiv[eé])$'){return 'Disabled'}
 return 'Enabled'
}
try {
 $p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(!$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'NATIVE_ADMIN_REQUIRED'}
 if(![Environment]::Is64BitProcess){throw 'NATIVE_64BIT_REQUIRED'}
 $current=@(Get-Partition -DiskNumber 0)
 if($Phase -eq 'verify' -or $current.Count -eq 3){
  Assert-Layout @(1,2,3) -Expanded
  $final=Get-Partition -DiskNumber 0 -PartitionNumber 3
  if($final.Size -ne 1023919070720 -or (Get-Disk -Number 0).LargestFreeExtent -ne 0 -or (Get-WinReState) -ne 'Disabled'){throw 'FINAL_STATE_MISMATCH'}
  $volume=Get-Volume -DriveLetter C
  @{phase=$Phase;complete=$true;changed=$false;cSize=$final.Size;cVolumeSize=$volume.Size;freeBytes=$volume.SizeRemaining;winRe='Disabled';bunPreserved=$true;bSubstUnchanged=$true} | ConvertTo-Json -Compress
  exit 0
 }
 Assert-Layout @(1,2,3,4,5,6)
 if($Phase -eq 'disable-winre'){
  $before=Get-WinReState
  if($before -ne 'Disabled'){
   & "$env:SystemRoot\System32\reagentc.exe" /disable 2>&1 | Out-Null
   if($LASTEXITCODE -ne 0){throw 'WINRE_DISABLE_FAILED'}
  }
  if((Get-WinReState) -ne 'Disabled'){throw 'WINRE_NOT_DISABLED'}
  Assert-Layout @(1,2,3,4,5,6)
  @{phase=$Phase;complete=$true;winRe='Disabled';partitionMutation=$false} | ConvertTo-Json -Compress
 }else{
  if((Get-WinReState) -ne 'Disabled'){throw 'WINRE_NOT_DISABLED'}
  $bitlocker=Get-BitLockerVolume -MountPoint C:
  if($bitlocker.VolumeStatus -ne 'FullyDecrypted' -or $bitlocker.ProtectionStatus -ne 'Off' -or $bitlocker.LockStatus -ne 'Unlocked' -or $bitlocker.EncryptionPercentage -ne 0){throw 'BITLOCKER_STATE_CHANGED'}
  $remaining=@(1,2,3,4,5,6)
  foreach($n in @(6,5,4)){
   Assert-Layout $remaining
   if((Get-WinReState) -ne 'Disabled'){throw 'WINRE_STATE_CHANGED'}
   Remove-Partition -DiskNumber 0 -PartitionNumber $n -Confirm:$false -ErrorAction Stop
   $deleted+=$n;$remaining=@($remaining | Where-Object {$_ -ne $n})
   Assert-Layout $remaining
  }
  $maximum=(Get-PartitionSupportedSize -DiskNumber 0 -PartitionNumber 3).SizeMax
  if($maximum -le 996911947264){throw 'NO_C_EXTENSION_AVAILABLE'}
  Assert-Layout @(1,2,3)
  Resize-Partition -DiskNumber 0 -PartitionNumber 3 -Size $maximum -ErrorAction Stop
  Assert-Layout @(1,2,3) -Expanded
  if((Get-Partition -DiskNumber 0 -PartitionNumber 3).Size -ne $maximum -or (Get-WinReState) -ne 'Disabled'){throw 'FINAL_STATE_MISMATCH'}
  @{phase=$Phase;complete=$true;deleted=$deleted;cSize=$maximum;winRe='Disabled';bunPreserved=$true;bSubstUnchanged=$true} | ConvertTo-Json -Compress
 }
}catch{@{phase=$Phase;complete=$false;deleted=$deleted;error=$_.Exception.Message} | ConvertTo-Json -Compress;exit 1}
