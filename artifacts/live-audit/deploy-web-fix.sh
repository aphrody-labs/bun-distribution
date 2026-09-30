#!/usr/bin/env bash
set -Eeuo pipefail

stage="${1:?stage directory required}"
unit=/etc/systemd/system/aphrody-web-api.service
nginx_conf=/etc/nginx/conf.d/aphrody-apex.conf
test -s "$stage/aphrody-web-api.service"
test -s "$stage/aphrody-apex.conf"
grep -Fq 'Environment=PORT=3007' "$unit"
grep -Fq 'proxy_pass http://127.0.0.1:8083;' "$nginx_conf"
backup="/srv/aphrody/shared/deploy-backups/web-fix-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
cp -a "$unit" "$backup/aphrody-web-api.service"
cp -a "$nginx_conf" "$backup/aphrody-apex.conf"

changed=no
rollback() {
    status=$?
    trap - ERR
    if [[ "$changed" = yes ]]; then
        cp -a "$backup/aphrody-web-api.service" "$unit"
        cp -a "$backup/aphrody-apex.conf" "$nginx_conf"
        systemctl daemon-reload || true
        systemctl restart aphrody-web-api.service || true
        nginx -t && systemctl reload nginx || true
    fi
    echo "web activation failed; rollback=$backup" >&2
    exit "$status"
}
trap rollback ERR

install -d -o ubuntu -g ubuntu -m 0700 /srv/aphrody/shared/bxc/storage
install -m 0644 "$stage/aphrody-web-api.service" "$unit"
install -m 0644 "$stage/aphrody-apex.conf" "$nginx_conf"
changed=yes
nginx -t
systemctl daemon-reload
systemctl restart aphrody-web-api.service
systemctl reload nginx

set -a
. /etc/aphrody/aphrody-web-api.env
set +a
/home/ubuntu/.bun/bin/bun -e '
const token = process.env.BXC_API_TOKEN;
if (!token) throw new Error("BXC token unavailable");
for (const url of [
    "http://127.0.0.1:3007/api/v1/crawl/stats",
    "https://aphrody.com/api/v1/web/crawl/stats",
]) {
    let status = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            status = (await fetch(url, {
                headers: { authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(5000),
            })).status;
        } catch { status = 0; }
        if (status === 200) break;
        await Bun.sleep(1000);
    }
    console.log(`${new URL(url).pathname}: ${status}`);
    if (status !== 200) throw new Error("BXC crawl status probe failed");
}
'
trap - ERR
echo "web activated; backup=$backup"
