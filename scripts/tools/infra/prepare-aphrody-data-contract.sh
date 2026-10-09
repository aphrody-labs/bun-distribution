#!/usr/bin/env bash
set +x
set -Eeuo pipefail

# Stage the canonical Web DSN on an already-provisioned VPS without rotating
# credentials or changing the active site environment.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
site_env=/etc/aphrody/aphrody-site.env
next_env=/etc/aphrody/aphrody-site.next.env
web_env=/etc/aphrody/aphrody-web-api.env
next_web_env=/etc/aphrody/aphrody-web-api.next.env
[[ -f "$site_env" && "$(stat -c %a "$site_env")" = 600 ]] || {
  echo 'active site env must exist with mode 0600' >&2; exit 2;
}
[[ -f "$web_env" && "$(stat -c %a "$web_env")" = 600 ]] || {
  echo 'active Web API env must exist with mode 0600' >&2; exit 2;
}
[[ ! -e "$next_env" && ! -e "$next_web_env" ]] || {
  echo 'staged Web env already exists' >&2; exit 2;
}
if grep -Eq '^APHRODY_WEB_API_TOKEN=' "$site_env"; then
  echo 'AI backend token variable must not be in site env' >&2; exit 2;
fi
[[ "$(grep -Ec '^APHRODY_SITE_DATABASE_URL=' "$site_env" || true)" = 1 ]] || {
  echo 'expected one legacy Web DSN in active site env' >&2; exit 2;
}
[[ "$(grep -Ec '^APHRODY_WEB_DATABASE_URL=' "$site_env" || true)" -le 1 ]] || {
  echo 'duplicate canonical Web DSN in active site env' >&2; exit 2;
}
[[ "$(grep -Ec '^APHRODY_BXC_API_TOKEN=' "$site_env" || true)" = 1 ]] || {
  echo 'expected one legacy public Web token in active site env' >&2; exit 2;
}
[[ "$(grep -Ec '^APHRODY_SITE_WEB_API_TOKEN=' "$site_env" || true)" -le 1 ]] || {
  echo 'duplicate canonical public Web token in active site env' >&2; exit 2;
}
legacy="$(sed -n 's/^APHRODY_SITE_DATABASE_URL=//p' "$site_env")"
canonical="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$site_env")"
legacy_public_token="$(sed -n 's/^APHRODY_BXC_API_TOKEN=//p' "$site_env")"
canonical_public_token="$(sed -n 's/^APHRODY_SITE_WEB_API_TOKEN=//p' "$site_env")"
if grep -Eq '^APHRODY_SITE_WEB_API_TOKEN=' "$site_env" && [[ -z "$canonical_public_token" ]]; then
  echo 'canonical public Web token is empty' >&2; exit 2;
fi
web_canonical="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$web_env")"
[[ "$(grep -Ec '^APHRODY_WEB_DATABASE_URL=' "$web_env" || true)" -le 1 ]] || {
  echo 'duplicate canonical Web DSN in active Web API env' >&2; exit 2;
}
[[ "$(grep -Ec '^BXC_API_TOKEN=' "$web_env" || true)" = 1 ]] || {
  echo 'expected one backend token in active Web API env' >&2; exit 2;
}
[[ "$(grep -Ec '^APHRODY_SITE_WEB_BACKEND_TOKEN=' "$site_env" || true)" -le 1 ]] || {
  echo 'duplicate backend token in active site env' >&2; exit 2;
}
web_backend_token="$(sed -n 's/^BXC_API_TOKEN=//p' "$web_env")"
site_backend_token="$(sed -n 's/^APHRODY_SITE_WEB_BACKEND_TOKEN=//p' "$site_env")"
[[ "$web_backend_token" =~ ^[0-9a-f]{64}$ && ( -z "$site_backend_token" || "$site_backend_token" = "$web_backend_token" ) ]] || {
  echo 'site and Web API backend tokens differ or are invalid' >&2; exit 2;
}
[[ -n "$legacy" && ( -z "$canonical" || "$canonical" = "$legacy" ) ]] || {
  echo 'legacy and canonical Web DSNs differ' >&2; exit 2;
}
[[ -z "$web_canonical" || "$web_canonical" = "$legacy" ]] || {
  echo 'site and Web API DSNs differ' >&2; exit 2;
}
[[ "$legacy_public_token" =~ ^[0-9a-f]{64}$ && ( -z "$canonical_public_token" || "$canonical_public_token" = "$legacy_public_token" ) ]] || {
  echo 'legacy and canonical public Web tokens differ or are invalid' >&2; exit 2;
}
printf '%s' "$legacy" | python3 -c 'import sys,urllib.parse; p=urllib.parse.urlsplit(sys.stdin.read()); sys.exit(0 if p.scheme in ("postgres","postgresql") and p.hostname in ("127.0.0.1","localhost") and p.username == "aphrody_web" and p.path == "/aphrody_web" else 1)' || {
  echo 'Web DSN does not target local aphrody_web as aphrody_web' >&2; exit 2;
}
umask 077
backup="/home/ubuntu/apps/aphrody/shared/deploy-backups/site-env-contract-$(date -u +%Y%m%dT%H%M%SZ)"
install -m 0600 -o root -g root "$site_env" "$backup"
install -m 0600 -o root -g root "$web_env" "$backup.web-api"
temp="$(mktemp /etc/aphrody/.aphrody-site.next.XXXXXXXX)"
web_temp="$(mktemp /etc/aphrody/.aphrody-web-api.next.XXXXXXXX)"
trap 'rm -f -- "$temp" "$web_temp"' EXIT
install -m 0600 -o root -g root "$site_env" "$temp"
install -m 0600 -o root -g root "$web_env" "$web_temp"
if [[ -z "$canonical" ]]; then printf 'APHRODY_WEB_DATABASE_URL=%s\n' "$legacy" >> "$temp"; fi
if [[ -z "$canonical_public_token" ]]; then printf 'APHRODY_SITE_WEB_API_TOKEN=%s\n' "$legacy_public_token" >> "$temp"; fi
if [[ -z "$site_backend_token" ]]; then printf 'APHRODY_SITE_WEB_BACKEND_TOKEN=%s\n' "$web_backend_token" >> "$temp"; fi
if [[ -z "$web_canonical" ]]; then printf 'APHRODY_WEB_DATABASE_URL=%s\n' "$legacy" >> "$web_temp"; fi
install -d -m 0700 -o aphrody -g aphrody /home/ubuntu/apps/aphrody/shared/ai/models
install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/apps/aphrody/shared/bxc/storage
mv -T -- "$temp" "$next_env"
mv -T -- "$web_temp" "$next_web_env"
trap - EXIT
echo 'canonical Web DSN staged for site and Web API without credential rotation; active env retained'
