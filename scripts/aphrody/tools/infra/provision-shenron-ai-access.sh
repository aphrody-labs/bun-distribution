#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
ai_env=/etc/aphrody/aphrody-ai-http.env
client_env=/etc/aphrody/shenron-compute-client.env
# aphrody-ai-http origin; must match infra/config/service-catalog.json and tools/aphrody/config/local-ai.json.
ai_url=http://127.0.0.1:8789
[[ -f "$ai_env" && "$(stat -c %a "$ai_env")" = 600 ]] || { echo 'Aphrody AI env file must exist with mode 0600' >&2; exit 2; }
grep -q '^APHRODY_MCP_DATABASE_URL=' "$ai_env" || { echo 'Aphrody AI database is not configured' >&2; exit 2; }

backup="/home/ubuntu/apps/aphrody/shared/deploy-backups/shenron-ai-access-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
cp -a "$ai_env" "$backup/aphrody-ai-http.env"
client_existed=no
if [[ -f "$client_env" ]]; then
    cp -a "$client_env" "$backup/shenron-compute-client.env"
    client_existed=yes
fi
changed=no
rollback() {
    status=$?
    trap - ERR
    if [[ "$changed" = yes ]]; then
        cp -a "$backup/aphrody-ai-http.env" "$ai_env"
        if [[ "$client_existed" = yes ]]; then
            cp -a "$backup/shenron-compute-client.env" "$client_env"
        else
            rm -f -- "$client_env"
        fi
        systemctl restart aphrody-ai-http.service || true
    fi
    echo "Shenron AI access failed; rollback=$backup" >&2
    exit "$status"
}
trap rollback ERR

token="$(sed -n 's/^APHRODY_SHENRON_API_TOKEN=//p' "$ai_env" | tail -n 1)"
if [[ -z "$token" ]]; then
    token="$(openssl rand -hex 32)"
    changed=yes
    printf '\nAPHRODY_SHENRON_API_TOKEN=%s\n' "$token" >> "$ai_env"
fi
changed=yes
temp="$(mktemp /etc/aphrody/.shenron-compute-client.XXXXXX)"
# Canonical names (tools/aphrody/config/local-ai.json) first; the legacy names stay until
# every consumer reads the canonical ones.
{
    printf 'APHRODY_AI_HTTP_URL=%s\nAPHRODY_AI_HTTP_TOKEN=%s\n' "$ai_url" "$token"
    printf 'APHRODY_SHENRON_API_URL=%s\nAPHRODY_SHENRON_API_TOKEN=%s\n' "$ai_url" "$token"
} > "$temp"
chown root:root "$temp"
chmod 0600 "$temp"
mv -f -- "$temp" "$client_env"
systemctl restart aphrody-ai-http.service

export APHRODY_AI_HTTP_URL="$ai_url" APHRODY_AI_HTTP_TOKEN="$token"
/home/ubuntu/.bun/bin/bun -e '
const token = process.env.APHRODY_AI_HTTP_TOKEN;
const base = `${process.env.APHRODY_AI_HTTP_URL}/api/v1/shenron`;
const headers = { authorization: `Bearer ${token}` };
let health;
for (let attempt = 0; attempt < 10; attempt++) {
    try {
        const response = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(5000) });
        if (response.status === 200) { health = await response.json(); break; }
    } catch {}
    await Bun.sleep(1000);
}
if (!health?.capabilities?.rag) throw new Error("Shenron PostgreSQL RAG is unavailable");
const url = new URL(`${base}/rag/search`);
url.searchParams.set("q", "Son Goku");
url.searchParams.set("limit", "3");
const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
if (response.status !== 200) throw new Error(`Shenron search HTTP ${response.status}`);
const search = await response.json();
console.log(JSON.stringify({ rag: health.capabilities.rag, llm: health.capabilities.llm, ocr: health.capabilities.ocr, mode: search.mode, results: search.results?.length ?? 0 }));
if (!Array.isArray(search.results) || search.results.length === 0) throw new Error("Shenron search returned no passages");
'
trap - ERR
echo "Shenron AI access ready; client env=$client_env; backup=$backup"
