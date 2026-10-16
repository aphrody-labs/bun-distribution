#!/usr/bin/env bash
# next-build.sh — build Next standalone pour Azalee.
#
# IMPORTANT — runtime de build = Node (PAS Bun) :
#   Bun (1.3.x ET 1.4-canary) déclenche un bug de PRERENDER de la page synthétique
#   `/_global-error` de Next 16 : `TypeError: null is not an object (evaluating
#   'k.H.useContext')` — dispatcher React null dans le OuterLayoutRouter interne de
#   Next, avant même la 1re page. Le bug est 100% reproductible (vanilla Next 16 +
#   Bun, sans aucun code azalee) et avorte l'export AVANT l'émission du standalone
#   (`.next/standalone/.../server.js` ABSENT) → impossible de déployer.
#   Sous Node (/usr/bin/node, v22+) le prerender passe.
#
#   En contrepartie, le cache SQLite embarqué (`lib/supabase/sqlite-client.ts`)
#   utilisait `bun:sqlite` (indispo sous Node) → fallback Postgres → timeouts >60s
#   sur les milliers de fiches perso. Résolu : `node:sqlite` (`DatabaseSync`,
#   Node >= 22) via `process.getBuiltinModule` côté build.
#
# On valide le succès sur la PRÉSENCE d'un BUILD_ID FRAIS + server.js.
set -uo pipefail

NODE_BIN="${NODE_BIN:-$(command -v node || command -v node.exe || printf /usr/bin/node)}"
# Préférer le Node du PATH (setup-node en CI, /usr/bin/node sur le VPS).
# Bun ne peut pas produire le build Next standalone attendu ici.
if [ ! -x "$NODE_BIN" ]; then
	NODE_BIN="$(command -v node || command -v node.exe || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
	echo "✗ node introuvable (NODE_BIN='$NODE_BIN') — build impossible" >&2
	exit 127
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# Shared Rose Griffon assets come from @rosegriffon/assets (single source); copy
# the files the website serves into public/ before building.
BUN_BIN="${BUN_BIN:-$(command -v bun || printf '%s' "$HOME/.bun/bin/bun")}"
"$BUN_BIN" "$REPO_ROOT/packages/rg-assets/scripts/sync-website-public.ts" --to "$PWD/public" || exit 1
APP_PATH="$(realpath --relative-to="$REPO_ROOT" "$PWD")"
if [[ "$APP_PATH" == .. || "$APP_PATH" == ../* ]]; then
	echo "✗ build lancé hors du workspace Aphrody" >&2
	exit 1
fi
# IECODE archives are local installation inputs; no sibling source is traced.
BUILD_ROOT="$REPO_ROOT"
SERVER_JS=".next/standalone/$(realpath --relative-to="$BUILD_ROOT" "$PWD")/server.js"

# TMPDIR sur disque (PAS le tmpfs /tmp, RAM-backed et souvent plein sur ce VPS) :
# un /tmp saturé fait crasher le sous-process babel-loader (SIGTERM/EDQUOT).
BUILD_TMP="${BUILD_TMP:-$HOME/.azalee-build-tmp}"
mkdir -p "$BUILD_TMP"

BUILD_STAMP="$(mktemp "$BUILD_TMP/next-build.XXXXXX")" || exit 1
trap 'rm -f -- "$BUILD_STAMP"' EXIT
# Node undici ne supporte pas socks5h:// (UnsupportedProxyProtocol sur next/font)
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
	TMPDIR="$BUILD_TMP" \
	NODE_ENV=production NODE_NO_WARNINGS=1 \
	NODE_OPTIONS="--max-old-space-size=8192 ${NODE_OPTIONS:-}" \
	"$NODE_BIN" node_modules/next/dist/bin/next build --turbopack "$@"
rc=$?

# Un code d'échec reste un échec, même si Next a écrit des artefacts partiels.
if [ "$rc" -ne 0 ]; then
	echo "✗ Next build échoué (exit $rc)" >&2
	exit "$rc"
fi
if [ ! -f .next/BUILD_ID ] || [ ! .next/BUILD_ID -nt "$BUILD_STAMP" ]; then
	echo "✗ build échoué — BUILD_ID absent ou périmé" >&2
	exit 1
fi
if [ ! -f "$SERVER_JS" ] || [ ! "$SERVER_JS" -nt "$BUILD_STAMP" ]; then
	echo "✗ build échoué — serveur standalone absent ou périmé ($SERVER_JS)" >&2
	exit 1
fi
exit 0
