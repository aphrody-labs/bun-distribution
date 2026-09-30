#!/usr/bin/env bash
set -euo pipefail

aphrody_home="${APHRODY_HOME:-$HOME/.aphrody}"
cookie_dir="${1:-${BXC_COOKIES_DIR:-$aphrody_home/cookies}}"
mkdir -p -- "$cookie_dir"
chmod 700 -- "$cookie_dir"
if [[ -n "${BXC_COOKIES_DIR:-}" && "${BXC_COOKIES_DIR}" != "$cookie_dir" ]]; then
  printf '%s\n' 'BXC_COOKIES_DIR points to a different path; refusing ambiguity.' >&2
  exit 2
fi
export BXC_COOKIES_DIR="$cookie_dir"
export APHRODY_HOME="$aphrody_home"
printf 'APHRODY_HOME=%s\n' "$APHRODY_HOME"
printf 'BXC_COOKIES_DIR=%s\n' "$BXC_COOKIES_DIR"
printf '%s\n' 'Cookie values were not read or copied.'
