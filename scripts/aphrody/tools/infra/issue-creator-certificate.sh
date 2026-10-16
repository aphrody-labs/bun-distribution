#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Issue the creator.aphrody.com certificate with HTTP-01 before the creator vhost is active
# (tools/config/host/nginx/aphrody/creator.aphrody.com.conf keeps the same challenge webroot for renewals).
# Requires the DNS record creator.aphrody.com (CNAME aphrody.com). Run once, as root, on the vps.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
command -v certbot >/dev/null || { echo 'certbot is required' >&2; exit 2; }
command -v nginx >/dev/null || { echo 'nginx is required' >&2; exit 2; }

webroot=/var/www/letsencrypt
config=/etc/nginx/conf.d/aphrody-creator-acme-bootstrap.conf
[[ ! -e "$config" ]] || { echo "$config already exists; refusing to overwrite" >&2; exit 2; }
install -d -m 0755 "$webroot/.well-known/acme-challenge"

cleanup() {
  rm -f -- "$config"
  nginx -t
  systemctl reload nginx
}
trap cleanup EXIT
cat >"$config" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name creator.aphrody.com;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
chmod 0644 "$config"
nginx -t
systemctl reload nginx
certbot certonly --webroot --webroot-path "$webroot" --cert-name creator.aphrody.com \
  -d creator.aphrody.com --non-interactive --agree-tos --register-unsafely-without-email
