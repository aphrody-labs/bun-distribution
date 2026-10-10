#!/usr/bin/env bash
set -euo pipefail
project="${1:-aphrody}"
location="${2:-us-central1}"
gcloud config set project "$project" --quiet >/dev/null
export GOOGLE_CLOUD_PROJECT="$project" GCLOUD_PROJECT="$project" CLOUDSDK_CORE_PROJECT="$project" GOOGLE_CLOUD_LOCATION="$location" GOOGLE_CLOUD_REGION="$location" GOOGLE_GENAI_USE_VERTEXAI=true APHRODY_GCP_AUTH=adc-or-secret-manager
printf 'GOOGLE_CLOUD_PROJECT=%s\n' "$project"
printf 'GOOGLE_CLOUD_LOCATION=%s\n' "$location"
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then adc="$GOOGLE_APPLICATION_CREDENTIALS"; else adc="$HOME/.config/gcloud/application_default_credentials.json"; fi
printf 'ADC_PRESENT=%s\n' "$([[ -f "$adc" ]] && echo true || echo false)"
printf '%s\n' 'No token, API key or credential content was read or printed.'
