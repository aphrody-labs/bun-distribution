#Requires -Version 7.2
# SPDX-License-Identifier: Apache-2.0
# Native Windows PKI for the current user's local Aphrody endpoints only.
[CmdletBinding(SupportsShouldProcess)]
param([Parameter(Mandatory)][string]$HomeDirectory, [switch]$DryRun, [switch]$Apply, [switch]$Renew, [switch]$RotateCa)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Native Windows PKI is required.' }
if ($Apply -and $DryRun) { throw 'Choose Apply or DryRun.' }
if (-not [IO.Path]::IsPathFullyQualified($HomeDirectory) -or -not (Test-Path -LiteralPath $HomeDirectory -PathType Container)) { throw 'Choose an existing absolute configured home.' }
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$directory = Join-Path $HomeDirectory 'credentials/tls/local'
$manifestPath = Join-Path $directory 'manifest.json'
$manifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { $null }
if ($manifest -and ($manifest.ownerSid -ne $ownerSid -or $manifest.purpose -ne 'aphrody-local-tls-v1')) { throw 'Certificate manifest belongs to another owner or purpose.' }
if ((Test-Path -LiteralPath $directory) -and -not $manifest -and @(Get-ChildItem -LiteralPath $directory -Force).Count -gt 0) { throw 'Nonempty unowned TLS directory is preserved.' }
$ca = if ($manifest -and -not $RotateCa) { Get-Item -LiteralPath "Cert:\CurrentUser\My\$($manifest.caThumbprint)" -ErrorAction SilentlyContinue } else { $null }
if ($manifest -and -not $RotateCa -and (-not $ca -or -not $ca.HasPrivateKey -or $ca.NotAfter -lt [DateTime]::Now.AddDays(31))) { throw 'Owned CA is unavailable or expiring; explicitly RotateCa under the same user profile.' }
$leaf = if ($manifest) { Get-Item -LiteralPath "Cert:\CurrentUser\My\$($manifest.leafThumbprint)" -ErrorAction SilentlyContinue } else { $null }
$renewLeaf = $Renew -or $RotateCa -or -not $leaf -or $leaf.NotAfter -lt [DateTime]::Now.AddDays(30)
[pscustomobject]@{ mode = if ($Apply) { 'apply' } else { 'plan' }; trustStore = 'Cert:\CurrentUser\Root'; ownerSid = $ownerSid; reuseCa = [bool]$ca; renewLeaf = [bool]$renewLeaf; dnsNames = @('localhost','aphrody.local'); ipAddresses = @('127.0.0.1','::1'); directory = $directory }
if (-not $Apply -or $DryRun -or $WhatIfPreference) { return }
if (-not $PSCmdlet.ShouldProcess('CurrentUser Aphrody local CA/leaf and protected TLS directory', 'Create/renew local TLS and trust only this user CA')) { return }
if (-not $renewLeaf -and $manifest) { return }

[IO.Directory]::CreateDirectory($directory) | Out-Null
$directoryAcl = [Security.AccessControl.DirectorySecurity]::new()
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.SetOwner([Security.Principal.SecurityIdentifier]::new($ownerSid))
foreach ($sid in @($ownerSid, 'S-1-5-18', 'S-1-5-32-544')) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $directoryAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $directory -AclObject $directoryAcl
if (-not $ca) {
    $ca = New-SelfSignedCertificate -Type Custom -Subject 'CN=Aphrody local development CA' -FriendlyName 'Aphrody local CA v1' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy NonExportable -Provider 'Microsoft Software Key Storage Provider' -HashAlgorithm SHA256 -KeyUsage CertSign,CRLSign -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0') -NotAfter ([DateTime]::Now.AddYears(5))
}
$expiry = [DateTime]::Now.AddDays(365)
if ($ca.NotAfter.AddDays(-1) -lt $expiry) { $expiry = $ca.NotAfter.AddDays(-1) }
$leaf = New-SelfSignedCertificate -Type Custom -Subject 'CN=localhost' -FriendlyName 'Aphrody local TLS v1' -Signer $ca -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy Exportable -Provider 'Microsoft Software Key Storage Provider' -HashAlgorithm SHA256 -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @('2.5.29.17={text}DNS=localhost&DNS=aphrody.local&IPAddress=127.0.0.1&IPAddress=::1', '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={critical}{text}ca=false') -NotAfter $expiry
$rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($leaf)
try { $privatePem = $rsa.ExportPkcs8PrivateKeyPem() } finally { $rsa.Dispose() }
$encoding = [Text.UTF8Encoding]::new($false)
$privatePath = Join-Path $directory 'leaf-key.pem'
$chainPath = Join-Path $directory 'leaf-chain.pem'
$publicCaPath = Join-Path $directory 'ca.cer'
$privateAcl = [Security.AccessControl.FileSecurity]::new()
$privateAcl.SetAccessRuleProtection($true, $false)
$privateAcl.SetOwner([Security.Principal.SecurityIdentifier]::new($ownerSid))
foreach ($sid in @($ownerSid, 'S-1-5-18', 'S-1-5-32-544')) {
    $privateAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
}
if (Test-Path -LiteralPath $privatePath) { Set-Acl -LiteralPath $privatePath -AclObject $privateAcl }
[IO.File]::WriteAllText($privatePath, $privatePem, $encoding)
Set-Acl -LiteralPath $privatePath -AclObject $privateAcl
$privatePem = $null
[IO.File]::WriteAllText($chainPath, $leaf.ExportCertificatePem() + "`n" + $ca.ExportCertificatePem() + "`n", $encoding)
Export-Certificate -Cert $ca -FilePath $publicCaPath -Force | Out-Null
# Trust is scoped to CurrentUser; LocalMachine Root is never changed.
Import-Certificate -FilePath $publicCaPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
$newManifest = [ordered]@{ purpose = 'aphrody-local-tls-v1'; ownerSid = $ownerSid; caThumbprint = $ca.Thumbprint; leafThumbprint = $leaf.Thumbprint; expiresAt = $leaf.NotAfter.ToUniversalTime().ToString('o'); certificateSha256 = (Get-FileHash -LiteralPath $chainPath -Algorithm SHA256).Hash; privateKeySha256 = (Get-FileHash -LiteralPath $privatePath -Algorithm SHA256).Hash; trustStore = 'CurrentUserRoot'; dnsNames = @('localhost','aphrody.local'); ipAddresses = @('127.0.0.1','::1') }
$temporaryManifest = Join-Path $directory ('manifest.' + [guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($temporaryManifest, ($newManifest | ConvertTo-Json), $encoding)
[IO.File]::Move($temporaryManifest, $manifestPath, $true)
[pscustomobject]@{ created = $true; renewed = [bool]$manifest; trustStore = 'CurrentUserRoot'; manifest = $manifestPath; leafExpiresAt = $newManifest.expiresAt }
