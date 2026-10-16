#!/usr/bin/env bash
set -euo pipefail

# Scoped Aphrody Web / Shenron crawl entry point. The private Japan SOCKS
# listener is loopback-only; a failed proxy connection fails the crawl instead
# of using the VPS's direct France egress. Each crawl is limited to public
# HTTPS seeds; the native crawler scopes discovered links to their seed hosts.
if (($# == 0)); then
  echo 'usage: aphrody-web-japan-crawl https://public.example/...' >&2
  exit 2
fi

for seed in "$@"; do
  [[ "$seed" =~ ^https://([A-Za-z0-9.-]+)(:443)?(/|\?|#|$) ]] || {
    echo 'only public HTTPS seed URLs are accepted' >&2
    exit 2
  }
  host="${BASH_REMATCH[1],,}"
  [[ "$host" == *.* && "$host" != .* && "$host" != *. && "$host" != *..* && "$host" != localhost && "$host" != *.localhost && "$host" != *.local ]] || {
    echo 'seed URL must use a public DNS hostname' >&2
    exit 2
  }
  [[ ! "$host" =~ ^[0-9.]+$ ]] || {
    echo 'IP-literal seed URLs are not accepted; use a public DNS hostname' >&2
    exit 2
  }
done

exec /usr/local/bin/aphrody web-engine crawl \
  --proxy socks5h://127.0.0.1:1080 \
  --max-depth 3 \
  --max-pages 25 \
  --concurrency 1 \
  --obey-robots \
  "$@"
