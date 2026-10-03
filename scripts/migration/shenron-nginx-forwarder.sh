#!/usr/bin/env bash
# Temporary old-IP compatibility route; invoke only via Infra SSH on VPS.
set -Eeuo pipefail
mode="${1:-plan}"
[[ $# -le 2 && ( "$mode" = plan || "$mode" = apply || "$mode" = restore ) ]] || { echo 'usage: shenron-nginx-forwarder.sh plan|apply|restore BACKUP' >&2; exit 2; }
config=/etc/nginx/conf.d/shenron.conf
ssh_owner=(ssh)
if [[ "$(id -u)" = 0 ]]; then ssh_owner=(runuser -u ubuntu -- ssh); fi
ip="$("${ssh_owner[@]}" -G dbfr 2>/dev/null | awk '$1 == "hostname" { print $2; exit }')"
python3 - "$ip" <<'PYIP'
import ipaddress, sys
if ipaddress.ip_address(sys.argv[1]).version != 4: raise SystemExit('DBFR IPv4 required')
PYIP
if [[ "$mode" = plan ]]; then
  printf 'plan: replace only %s with verified TLS/SNI forwarding to DBFR %s:443 for apex/www/bot/CDN; preserve unrelated hosts\n' "$config" "$ip"
  exit 0
fi
[[ "$(id -u)" = 0 ]] || { echo 'run apply/restore as root' >&2; exit 2; }
[[ -f "$config" && ! -L "$config" ]] || { echo 'dedicated Shenron nginx file required' >&2; exit 2; }
if [[ "$mode" = restore ]]; then
  backup="${2:?restore backup required}"
  [[ "$backup" = /etc/nginx/.shenron-forwarder-backup-* && -f "$backup/shenron.conf" && ! -L "$backup/shenron.conf" ]] || { echo 'invalid forwarder backup' >&2; exit 2; }
  temporary="$(mktemp /etc/nginx/conf.d/.shenron-restore.XXXXXX)"
  cp -- "$backup/shenron.conf" "$temporary"
  chmod 0644 "$temporary"
  mv -Tf -- "$temporary" "$config"
  nginx -t
  systemctl reload nginx
  echo 'original Shenron nginx configuration restored; runtime rollback remains a separate Infra operation'
  exit 0
fi
[[ $# = 1 ]] || { echo 'apply accepts no backup argument' >&2; exit 2; }
for unit in shenron-site.service shenron-bot.service; do
  if systemctl is-active --quiet "$unit"; then echo "old VPS runtime must be stopped: $unit" >&2; exit 2; fi
done
for entry in dragonballfr.com:/api/health bot.dragonballfr.com:/health cdn.dragonballfr.com:/health; do
  host="${entry%%:*}"; path="${entry#*:}"
  curl --fail --silent --show-error --max-time 10 --noproxy '*' --resolve "$host:443:$ip" "https://$host$path" >/dev/null
done
python3 - "$config" <<'PYHOSTS'
import pathlib,re,sys
allowed={'dragonballfr.com','www.dragonballfr.com','bot.dragonballfr.com','cdn.dragonballfr.com'}
hosts=set()
for group in re.findall(r'^\s*server_name\s+([^;]+);',pathlib.Path(sys.argv[1]).read_text(),re.M): hosts.update(group.split())
if not hosts or not hosts.issubset(allowed): raise SystemExit('refusing file containing unrelated host names')
PYHOSTS
backup="$(mktemp -d /etc/nginx/.shenron-forwarder-backup-XXXXXX)"
chmod 0700 "$backup"
cp -p -- "$config" "$backup/shenron.conf"
temporary="$(mktemp /etc/nginx/conf.d/.shenron-forwarder.XXXXXX)"
python3 - "$ip" "$temporary" <<'PYRENDER'
import pathlib,sys
ip,target=sys.argv[1:]
text='map $http_upgrade $shenron_migration_connection { default upgrade; "" close; }\n'
for host,aliases in [('dragonballfr.com','dragonballfr.com www.dragonballfr.com'),('bot.dragonballfr.com','bot.dragonballfr.com'),('cdn.dragonballfr.com','cdn.dragonballfr.com')]:
 text+=f'''server {{
 listen 80; server_name {aliases};
 location /.well-known/acme-challenge/ {{ root /var/www/html; }}
 location / {{ return 308 https://$host$request_uri; }}
}}
server {{
 listen 443 ssl; server_name {aliases};
 ssl_certificate /etc/letsencrypt/live/{host}/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/{host}/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 60m;
 location / {{
  proxy_pass https://{ip}:443;
  proxy_ssl_server_name on; proxy_ssl_name {host};
  proxy_ssl_verify on; proxy_ssl_verify_depth 3;
  proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $shenron_migration_connection;
  proxy_read_timeout 120s; proxy_send_timeout 120s;
 }}
}}
'''
pathlib.Path(target).write_text(text)
PYRENDER
chmod 0644 "$temporary"
mv -Tf -- "$temporary" "$config"
if ! nginx -t || ! systemctl reload nginx; then
  cp -p -- "$backup/shenron.conf" "$config"
  nginx -t && systemctl reload nginx || true
  echo "forwarder failed; original configuration restored; backup=$backup" >&2
  exit 1
fi
for entry in dragonballfr.com:/api/health bot.dragonballfr.com:/health cdn.dragonballfr.com:/health; do
  host="${entry%%:*}"; path="${entry#*:}"
  if ! curl --fail --silent --show-error --max-time 10 --noproxy '*' --resolve "$host:443:127.0.0.1" "https://$host$path" >/dev/null; then
    cp -p -- "$backup/shenron.conf" "$config"
    nginx -t && systemctl reload nginx || true
    echo "forwarder local TLS probe failed; original restored; backup=$backup" >&2
    exit 1
  fi
done
printf 'old-IP verified TLS forwarding active; backup=%s; retain through DNS TTL plus propagation margin\n' "$backup"
