# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
Create or validate Cloudflare's environment through the existing Infra secrets owner.
.DESCRIPTION
Only creates an empty private environment skeleton. Tokens are provisioned through
Cloudflare OAuth/account APIs and supplied by the owner or a secret manager.
Never overwrites a credential file, imports browser sessions or prints credentials.
#>
[CmdletBinding()]
param(
    [string]$EnvFile = $env:APHRODY_CLOUDFLARE_ENV_FILE,
    [string]$WorkspaceRoot = $env:APHRODY_WORKSPACE_ROOT,
    [switch]$Initialize,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
if (-not $WorkspaceRoot) { $WorkspaceRoot = $env:APHRODY_ROOT }
if (-not $WorkspaceRoot) { $WorkspaceRoot = Join-Path $PSScriptRoot '../../../docs/aphrody' }
$WorkspaceRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot)
if (-not $EnvFile) {
    $stateRoot = $env:APHRODY_HOME
    if (-not $stateRoot) {
        $accountHome = [Environment]::GetFolderPath('UserProfile')
        if (-not $accountHome) { throw 'Set APHRODY_HOME or APHRODY_CLOUDFLARE_ENV_FILE.' }
        $stateRoot = Join-Path $accountHome '.aphrody'
    }
    $EnvFile = Join-Path $stateRoot 'config/cloudflare.env'
}
$EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
# Reject every Git worktree, including repositories nested outside this workspace.
$cursor = [System.IO.DirectoryInfo]::new([System.IO.Path]::GetDirectoryName($EnvFile))
while ($cursor) {
    if (Test-Path -LiteralPath (Join-Path $cursor.FullName '.git')) {
        throw 'Cloudflare credentials must be stored outside Git worktrees.'
    }
    $cursor = $cursor.Parent
}
if ($Initialize -and -not (Test-Path -LiteralPath $EnvFile)) {
    $parent = [System.IO.Path]::GetDirectoryName($EnvFile)
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    $keys = @(
        'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_GATEWAY_ID',
        'CLOUDFLARE_AI_GATEWAY_API_KEY',
        'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL_S3'
    )
    # CreateNew prevents a concurrent setup from overwriting an existing store.
    if ($IsWindows) {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [System.Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($identity)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
        $stream = [System.IO.FileSystemAclExtensions]::Create(
            [System.IO.FileInfo]::new($EnvFile), [System.IO.FileMode]::CreateNew,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $acl)
    } else {
        $options = [System.IO.FileStreamOptions]::new()
        $options.Mode = [System.IO.FileMode]::CreateNew
        $options.Access = [System.IO.FileAccess]::Write
        $options.Share = [System.IO.FileShare]::None
        $options.UnixCreateMode = [System.IO.UnixFileMode]::UserRead -bor
            [System.IO.UnixFileMode]::UserWrite
        $stream = [System.IO.FileStream]::new($EnvFile, $options)
    }
    try {
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(
            (($keys | ForEach-Object { "$_=" }) -join "`n") + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
}
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw 'Credential file absent. Use -Initialize or supply APHRODY_CLOUDFLARE_ENV_FILE.'
}
$env:APHRODY_CLOUDFLARE_ENV_FILE = $EnvFile
if ($Check) {
    Push-Location $WorkspaceRoot
    try {
        $raw = & aphrody infra secrets check --service cloudflare --env-file $EnvFile --json
        if ($LASTEXITCODE -ne 0) { throw 'Infra secret validation failed.' }
        $report = ($raw -join "`n") | ConvertFrom-Json
        $report | ConvertTo-Json -Depth 5
        # Infra reports missing keys in JSON but currently returns success; enforce the gate here.
        if ($report.missing_required.Count) { throw 'Cloudflare authentication is not configured.' }
    } finally { Pop-Location }
} else {
    [pscustomobject]@{ envFile = $EnvFile; credentialsVerified = $false } | ConvertTo-Json
}
