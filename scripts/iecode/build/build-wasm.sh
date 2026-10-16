#!/usr/bin/env bash
# Reproducible WebAssembly build for the NIE WASM library adapter.
#
# Étapes (best practices wasm-bindgen) :
#   1. cargo build --release --target wasm32-unknown-unknown
#   2. wasm-bindgen --target web            (glue ESM + .d.ts)
#   3. wasm-opt -O3                          (taille -~15 % + vitesse runtime)
#   4. patch Turbopack : `new URL(..., import.meta.url)` -> throw (force module_or_path)
#   5. publication in the canonical nie-web WASM surface
#
# La version du CLI wasm-bindgen DOIT égaler le pin du lockfile (cf. Cargo.lock).
set -euo pipefail

# Derived portable paths: ROOT is the repository root.
ROOT="${NIE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PKG="$ROOT/crates/nie/aphrody-nie-wasm/pkg"
WASM="$ROOT/target/wasm32-unknown-unknown/release/aphrody_nie_wasm.wasm"

cd "$ROOT"

# 0. Garde-fou : versions alignées.
pin="$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\([^"]*\)"$/\1/p;}' Cargo.lock)"
cli="$(wasm-bindgen --version)"
cli="${cli#wasm-bindgen }"
[ "$pin" = "$cli" ] || { echo "ERREUR: wasm-bindgen CLI $cli != pin $pin"; exit 1; }

echo "[1/5] cargo build release wasm32…"
cargo build --locked -p aphrody-nie-wasm --target wasm32-unknown-unknown --release

echo "[2/5] wasm-bindgen --target web…"
wasm-bindgen "$WASM" --out-dir "$PKG" --target web

echo "[3/5] wasm-opt -O3…"
before=$(stat -c%s "$PKG/aphrody_nie_wasm_bg.wasm")
wasm-opt -O3 "$PKG/aphrody_nie_wasm_bg.wasm" -o "$PKG/aphrody_nie_wasm_bg.wasm"
after=$(stat -c%s "$PKG/aphrody_nie_wasm_bg.wasm")
echo "      $before -> $after octets ($(( (before-after)*100/before )) % en moins)"

echo "[4/5] patch Turbopack…"
sed -i "s|module_or_path = new URL('aphrody_nie_wasm_bg.wasm', import.meta.url);|throw new Error(\"aphrody-nie-wasm: module_or_path requis\");|" "$PKG/aphrody_nie_wasm.js"

echo "[5/5] NIE library bindings generated in $PKG"

echo "OK — NIE WASM bindings generated ($after bytes); consuming hosts are qualified separately."
