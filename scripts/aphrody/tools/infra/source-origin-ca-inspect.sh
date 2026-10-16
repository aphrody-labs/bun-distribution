#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Read-only expiry and hostname inspection for the Gitea Cloudflare Origin CA leaf.
set -euo pipefail

readonly certificate="${SOURCE_ORIGIN_CA_CERTIFICATE:-/home/ubuntu/.aphrody/secrets/tls/source-origin/fullchain.pem}"
readonly renewal_window_days="${SOURCE_ORIGIN_CA_RENEWAL_WINDOW_DAYS:-30}"

emit_unavailable() {
  local reason="$1"
  printf '{"schemaVersion":1,"status":"unavailable","renewalDue":true,"reason":"%s","renewalMethod":"Codex heartbeat + Cloudflare MCP; private key remains on VPS"}\n' "$reason"
}

if ! [[ "$renewal_window_days" =~ ^[1-9][0-9]{0,2}$ ]]; then
  emit_unavailable "invalid_renewal_window"
  exit 2
fi

if [[ ! -r "$certificate" ]]; then
  emit_unavailable "certificate_unreadable"
  exit 2
fi

if ! command -v openssl >/dev/null 2>&1 || ! command -v date >/dev/null 2>&1; then
  emit_unavailable "required_tool_missing"
  exit 2
fi

not_before="$(openssl x509 -in "$certificate" -noout -startdate 2>/dev/null | sed 's/^notBefore=//')" || {
  emit_unavailable "certificate_parse_failed"
  exit 2
}
not_after="$(openssl x509 -in "$certificate" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')" || {
  emit_unavailable "certificate_parse_failed"
  exit 2
}
if [[ -z "$not_before" || -z "$not_after" ]]; then
  emit_unavailable "certificate_dates_missing"
  exit 2
fi

not_before_epoch="$(date -u -d "$not_before" +%s 2>/dev/null)" || {
  emit_unavailable "certificate_date_parse_failed"
  exit 2
}
not_after_epoch="$(date -u -d "$not_after" +%s 2>/dev/null)" || {
  emit_unavailable "certificate_date_parse_failed"
  exit 2
}
now_epoch="$(date -u +%s)"
remaining_seconds=$((not_after_epoch - now_epoch))
if (( remaining_seconds > 0 )); then
  days_remaining=$(((remaining_seconds + 86399) / 86400))
else
  days_remaining=$((remaining_seconds / 86400))
fi

source_host_valid=false
git_host_valid=false
if openssl x509 -in "$certificate" -noout -checkhost source.aphrody.app >/dev/null 2>&1; then
  source_host_valid=true
fi
if openssl x509 -in "$certificate" -noout -checkhost git.aphrody.app >/dev/null 2>&1; then
  git_host_valid=true
fi

status="healthy"
renewal_due=false
if [[ "$source_host_valid" != true || "$git_host_valid" != true || "$now_epoch" -lt "$not_before_epoch" ]]; then
  status="invalid"
  renewal_due=true
elif (( remaining_seconds <= 0 )); then
  status="expired"
  renewal_due=true
elif (( remaining_seconds <= renewal_window_days * 86400 )); then
  status="renewal_due"
  renewal_due=true
fi

printf '{"schemaVersion":1,"status":"%s","renewalDue":%s,"daysRemaining":%d,"notBefore":"%s","notAfter":"%s","hosts":{"source.aphrody.app":%s,"git.aphrody.app":%s},"renewalWindowDays":%d,"renewalMethod":"Codex heartbeat + Cloudflare MCP; private key remains on VPS"}\n' \
  "$status" "$renewal_due" "$days_remaining" "$not_before" "$not_after" \
  "$source_host_valid" "$git_host_valid" "$renewal_window_days"

if [[ "$status" == healthy ]]; then
  exit 0
fi
if [[ "$status" == renewal_due ]]; then
  exit 1
fi
exit 2
