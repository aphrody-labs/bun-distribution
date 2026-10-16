#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Reuse the installed Certbot/webroot owner; no DNS mutation or CA trust install.
set -Eeuo pipefail
set +x

[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
command -v certbot >/dev/null
command -v nginx >/dev/null
readonly webroot=/var/www/letsencrypt
readonly lineage=/etc/letsencrypt/live/source.aphrody.app
readonly reload_hook=/etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh
readonly hook_body=$'#!/bin/sh\nnginx -t && systemctl reload nginx'

[[ -d "$webroot" ]] || { echo 'existing ACME webroot missing' >&2; exit 2; }
nginx -t
[[ -f "$reload_hook" && ! -L "$reload_hook" && -x "$reload_hook" ]] || {
  echo 'existing Nginx renewal hook missing' >&2; exit 2;
}
[[ "$(cat "$reload_hook")" == "$hook_body" ]] || {
  echo 'existing Nginx renewal hook differs; inspect before issuing' >&2; exit 2;
}
systemctl is-active --quiet certbot.timer
# Cloudflare may redirect HTTP to HTTPS: both live forge listeners must serve
# the existing webroot before this command. Certbot validates both public names.
timeout 180 certbot certonly --webroot --webroot-path "$webroot" \
  --cert-name source.aphrody.app -d source.aphrody.app -d git.aphrody.app \
  --non-interactive --agree-tos --email contact@aphrody.com --keep-until-expiring

openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost source.aphrody.app
openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost git.aphrody.app
printf '%s\n' 'Source certificate issued; existing Certbot timer and Nginx renewal hook reused.'
