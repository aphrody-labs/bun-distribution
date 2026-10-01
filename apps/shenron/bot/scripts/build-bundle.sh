#!/usr/bin/env bash
# Bundle le bot (serveur + dashboard) vers dist/.
#
# Piège Bun bundler : `import dashboardHtml from "../../dashboard.html"` traite
# dashboard.html comme un *entry point HTML*. Bun RÉÉCRIT alors le fichier
# SOURCE dashboard.html sur place, en remplaçant les <link>/<script> qui
# pointent vers les sources (`./src/dashboard/{styles.compiled.css,main.tsx}`)
# par les chemins hashés générés (`./bot/dashboard-<hash>.{css,js}`).
#
# Conséquence : le build n'est pas idempotent. Au 2e run, dashboard.html pointe
# vers des assets hashés inexistants à la résolution → "Could not resolve" →
# build rouge. (C'est précisément comme ça que le fichier committé s'est
# retrouvé cassé.)
#
# Ce wrapper sauvegarde la forme SOURCE du HTML avant le bundle puis la restaure
# après, rendant `bun run build` rejouable à l'infini sans corrompre la source.
set -uo pipefail

cd "$(dirname "$0")/.."

HTML=dashboard.html
BACKUP="$(mktemp)"
cp "$HTML" "$BACKUP"
# Restaure toujours la source, même si le bundle échoue (trap EXIT).
trap 'cp "$BACKUP" "$HTML"; rm -f "$BACKUP"' EXIT

# Stage canonical Noto Color Emoji font from obscura-render if not present
CANONICAL_EMOJI="../../crates/web/obscura-render/assets/noto-color-emoji.ttf"
TARGET_EMOJI="assets/fonts/NotoColorEmoji.ttf"
if [ -f "$CANONICAL_EMOJI" ]; then
	mkdir -p assets/fonts
	if [ ! -f "$TARGET_EMOJI" ] || [ "$CANONICAL_EMOJI" -nt "$TARGET_EMOJI" ]; then
		cp "$CANONICAL_EMOJI" "$TARGET_EMOJI"
	fi
fi

BUN_BIN="${BUN_BIN:-$(command -v bun)}"
if [ -z "$BUN_BIN" ] || ! [ -x "$BUN_BIN" ]; then
	echo "✗ bun is required" >&2
	exit 1
fi
"$BUN_BIN" build src/index.ts --target=bun --outdir=dist
