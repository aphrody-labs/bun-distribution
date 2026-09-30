[CmdletBinding()]
param([string]$Project = 'aphrody', [string]$Location = 'us-central1')
$ErrorActionPreference = 'Stop'
gcloud config set project $Project --quiet | Out-Null
[Environment]::SetEnvironmentVariable('GOOGLE_CLOUD_PROJECT', $Project, 'User')
[Environment]::SetEnvironmentVariable('GCLOUD_PROJECT', $Project, 'User')
[Environment]::SetEnvironmentVariable('CLOUDSDK_CORE_PROJECT', $Project, 'User')
[Environment]::SetEnvironmentVariable('GOOGLE_CLOUD_LOCATION', $Location, 'User')
[Environment]::SetEnvironmentVariable('GOOGLE_CLOUD_REGION', $Location, 'User')
[Environment]::SetEnvironmentVariable('GOOGLE_GENAI_USE_VERTEXAI', 'true', 'User')
[Environment]::SetEnvironmentVariable('APHRODY_GCP_AUTH', 'adc-or-secret-manager', 'User')
$adc = Join-Path $env:APPDATA 'gcloud\application_default_credentials.json'
Write-Output "GOOGLE_CLOUD_PROJECT=$Project"
Write-Output "GOOGLE_CLOUD_LOCATION=$Location"
Write-Output "ADC_PRESENT=$([bool](Test-Path -LiteralPath $adc))"
Write-Output 'No token, API key or credential content was read or printed.'
