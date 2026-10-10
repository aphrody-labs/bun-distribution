#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Issue the downloads certificate (downloads.aphrody.com, aphrody.com, www.aphrody.com) with HTTP-01
# before the downloads vhost is active. The installed vhost keeps the same challenge webroot for renewals.
# The leftover vhost aphrody-acme-temp.conf already answers port 80 for aphrody.com and www.aphrody.com (challenge
# webroot, 404 elsewhere): it must still be installed here, and publish-downloads.ts host-apply retires it once the
# downloads vhost owns those names. Run once, as root, on the vps.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
command -v certbot >/dev/null || { echo 'certbot is required' >&2; exit 2; }
command -v nginx >/dev/null || { echo 'nginx is required' >&2; exit 2; }

webroot=/var/www/letsencrypt
config=/etc/nginx/conf.d/aphrody-downloads-acme-bootstrap.conf
[[ ! -e "$config" ]] || { echo "$config already exists; refusing to overwrite" >&2; exit 2; }
install -d -m 0755 "$webroot/.well-known/acme-challenge"

# Only the new name needs a bootstrap block: the apex names are covered by aphrody-acme-temp.conf.
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
    server_name downloads.aphrody.com;
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
certbot certonly --webroot --webroot-path "$webroot" --cert-name downloads.aphrody.com \
  -d downloads.aphrody.com -d aphrody.com -d www.aphrody.com --non-interactive --agree-tos \
  --register-unsafely-without-email
