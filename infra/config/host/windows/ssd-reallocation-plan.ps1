# SPDX-License-Identifier: Apache-2.0
# Read-only Windows Storage plan; no partition, WinRE, BitLocker or SUBST mutation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expected = @(
    @(1,'67ea7b29-d113-41e1-8cb4-c8f243345336','c12a7328-f81f-11d2-ba4b-00a0c93ec93b',1048576,272629760),
    @(2,'fe083a25-a65b-4ae9-bb06-533039ae9d29','e3c9e316-0b5c-4db8-817d-f92df00215ae',273678336,16777216),
    @(3,'e1eae83d-a9f4-42da-a334-a115ecf46eb1','ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',290455552,996911947264),
    @(4,'ef33b7e4-c8b9-4798-8b2b-859bbc2eac39','de94bba4-06d1-4d40-a16a-bfd50179d6ac',997203116032,963641344),
    @(5,'6cd6d60d-66a8-4187-930f-62ff3a69a665','ebd0a0a2-b9e5-4433-87c0-68b6b72699c7',998166757376,25769803776),
    @(6,'8942130b-6c3b-421a-8684-afd63f38a795','de94bba4-06d1-4d40-a16a-bfd50179d6ac',1023936561152,272629760)
)
try {
    $disk = Get-Disk -Number 0
    if ($disk.FriendlyName -ne 'NVMe Micron_2400_MTFDKBA1T0QFM' -or $disk.Size -ne 1024209543168 -or
        $disk.PartitionStyle -ne 'GPT' -or !$disk.IsBoot -or !$disk.IsSystem -or $disk.IsOffline -or
        $disk.IsReadOnly -or $disk.HealthStatus -ne 'Healthy') { throw 'DISK_IDENTITY_OR_HEALTH_CHANGED' }
    $actual = @(Get-Partition -DiskNumber 0)
    if ($actual.Count -eq 3) {
        foreach ($row in $expected[0..2]) {
            $partition = @($actual | Where-Object PartitionNumber -eq $row[0])
            $size = if ($row[0] -eq 3) { 1023919070720 } else { $row[4] }
            if ($partition.Count -ne 1 -or [guid]$partition[0].Guid -ne [guid]$row[1] -or
                [guid]$partition[0].GptType -ne [guid]$row[2] -or $partition[0].Offset -ne $row[3] -or
                $partition[0].Size -ne $size) { throw 'FINAL_PARTITION_IDENTITY_CHANGED' }
        }
        if ((Get-Partition -DriveLetter C).DiskNumber -ne 0 -or (Get-Partition -DriveLetter C).PartitionNumber -ne 3 -or
            $disk.LargestFreeExtent -ne 0 -or !(Test-Path -LiteralPath 'C:\bun' -PathType Container)) { throw 'FINAL_C_OR_BUN_CHANGED' }
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $subst = @(& (Join-Path $system 'subst.exe'))
        if ($LASTEXITCODE -ne 0 -or @($subst | Where-Object { $_ -match '^B:\\:' }).Count -or (Test-Path -LiteralPath 'B:\')) { throw 'FINAL_B_MAPPING_STILL_PRESENT' }
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if ($isAdmin) { & (Join-Path $PSScriptRoot 'ssd-reallocation.ps1') -Phase verify; exit $LASTEXITCODE }
        @{schemaVersion=1;action='readonly-final-plan';layoutValidated=$true;protectedPartitions=@(1,2,3);
            protectedPath='C:\bun';bMappingAbsentInCurrentSession=$true;isAdmin=$false;
            cSize=1023919070720;executableMutationIncluded=$false;winReQualified=$false;
            verificationRequiresAdmin=$true;verifyScript=(Join-Path $PSScriptRoot 'ssd-reallocation.ps1');verifyPhase='verify'} | ConvertTo-Json -Compress
        exit 0
    }
    if ($actual.Count -ne 6) { throw 'PARTITION_LAYOUT_CHANGED' }
    foreach ($row in $expected) {
        $partition = @($actual | Where-Object PartitionNumber -eq $row[0])
        if ($partition.Count -ne 1 -or [guid]$partition[0].Guid -ne [guid]$row[1] -or
            [guid]$partition[0].GptType -ne [guid]$row[2] -or $partition[0].Offset -ne $row[3] -or
            $partition[0].Size -ne $row[4]) { throw 'PARTITION_GUID_TYPE_OFFSET_SIZE_CHANGED' }
    }
    $os = $actual | Where-Object PartitionNumber -eq 3
    if ($os.DriveLetter -ne 'C' -or (Get-Partition -DriveLetter C).DiskNumber -ne 0 -or
        @($actual | Where-Object DriveLetter -eq 'B').Count) { throw 'OS_OR_B_DRIVE_LAYOUT_CHANGED' }
    if (!(Test-Path -LiteralPath 'C:\bun' -PathType Container)) { throw 'BUN_OWNER_PATH_MISSING' }
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $subst = @(& (Join-Path $system 'subst.exe'))
    if ($LASTEXITCODE -ne 0 -or @($subst | Where-Object { $_ -match '^B:\\:\s*=>\s*C:\\bun\s*$' }).Count -ne 1) {
        throw 'B_IS_NOT_THE_EXPECTED_CURRENT_SESSION_SUBST'
    }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    @{
        schemaVersion=1; action='readonly-plan'; disk=0; layoutValidated=$true;
        isAdmin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
        protectedPartitions=@(1,2,3); protectedPath='C:\bun'; bIsSubstOnly=$true;
        deletePartitions=@(6,5,4); reclaimPartitionBytes=27006074880;
        adminWinReAndBitLockerMetadataQualified=$false; executableMutationIncluded=$false;
        orderedSteps=@(
            'Root legitimate elevated session: inspect WinRE status/location and BitLocker status only; never print recovery keys',
            'Revalidate disk identity and all six GUIDs/types/offsets/sizes immediately before mutation',
            'Disable Windows RE via reagentc /disable; verify disabled before deleting any recovery partition',
            'Delete only validated partitions 6,5,4 in descending order; revalidate protected EFI/MSR/C and each exact target before its deletion',
            'Query Get-PartitionSupportedSize for disk0 partition3; extend C only to current SizeMax with Resize-Partition',
            'Verify EFI/MSR GUID/type/offset/size unchanged; C GUID/type/offset unchanged and expanded; C:\bun remains present',
            'Remove only B: SUBST in its original user session after rechecking it maps to C:\bun; never delete C:\bun or a B: volume',
            'Record final partition/volume/free-space metadata and WinRE disabled state; no OEM recovery partition recreation requested'
        )
    } | ConvertTo-Json -Depth 5
} catch { @{action='readonly-plan';layoutValidated=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
