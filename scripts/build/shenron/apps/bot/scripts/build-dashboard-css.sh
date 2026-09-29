#!/usr/bin/env bash
# Compile le CSS Tailwind v4 du dashboard admin (styles.css → styles.compiled.css).
#
set -uo pipefail

cd "$(dirname "$0")/.."
IN=src/dashboard/styles.css
OUT=src/dashboard/styles.compiled.css
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
if [ -z "$BUN_BIN" ] || ! [ -x "$BUN_BIN" ]; then
	echo "✗ bun is required" >&2
	exit 1
fi

# Bun ne supporte pas le protocole socks5:// dans fetch / bunx (UnsupportedProxyProtocol)
# Si un proxy socks5 est présent dans l'environnement, on le retire pour l'invocation de Tailwind.
CLEAN_ENV=()
for k in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy; do
	if [[ "${!k:-}" =~ ^socks5 ]]; then
		CLEAN_ENV+=("$k=")
	fi
done

exec env "${CLEAN_ENV[@]}" "$BUN_BIN" x @tailwindcss/cli --input "$IN" --output "$OUT" --minify
