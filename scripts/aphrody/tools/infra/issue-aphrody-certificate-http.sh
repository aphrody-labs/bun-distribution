#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Bootstrap the Aphrody certificate with HTTP-01 before the Aphrody vhost is
# active. The installed Aphrody vhost keeps the same challenge webroot for
# automatic renewals.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
command -v certbot >/dev/null || { echo 'certbot is required' >&2; exit 2; }
command -v nginx >/dev/null || { echo 'nginx is required' >&2; exit 2; }

config=/etc/nginx/conf.d/aphrody-acme-bootstrap.conf
webroot=/var/www/letsencrypt
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
    server_name aphrody.com www.aphrody.com mcp.aphrody.com;
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
certbot certonly --webroot --webroot-path "$webroot" --cert-name aphrody.com \
  -d aphrody.com -d www.aphrody.com -d mcp.aphrody.com --non-interactive --agree-tos \
  --register-unsafely-without-email
