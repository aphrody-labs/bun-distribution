#!/usr/bin/env bash
# End-to-end exploitation of the `nie` CLI on the VPS, every independent group in parallel.
#
#   ./run.sh [WORK_DIR]
#
# Groups (concurrent; steps inside a group run in order):
#   re      index -> rtti -> strings -> pdata -> rebuild -> recover (+ Ghidra FID names from the
#           continuous Ghidra service) -> propagate -> coverage, then the knowledge-base consumers
#           mode / seed-ui / atlas
#   vfs     info, locales, vfs stats/formats, textures, uniform-map, video, icons, avatar, vn, and
#           DBXV2 through the nie VFS (NIE_EXTRA_GAMES)
#   engine  play (match + menu), net sim-match
#   models  (after the others) aphrody-nie-model-serve assembles a character GLB live from the
#           CPKs -> nie render PNG/GIF (NIE_E2E_MODELS, default c01000010)
#   lua     lua-audit
#   mod     mod init/add/validate/status in a scratch folder (never `mod install`)
#
# Deliberately not run: anything that rewrites the install or saves (mod install, save edit/park),
# launches or writes the live game (live run/probe, mem write/recette), bypasses anti-cheat
# (launcher eac, mem patch-eac), downloads (steam download) or dumps the whole VFS (viola dump).
# Every step is bounded by `timeout`, logged to logs/<step>.log and recorded in status.tsv;
# SUMMARY.md lists them all at the end.
set -uo pipefail

N=${NIE_BIN:-/home/ubuntu/src/bun-os/target/release/nie}
: "${NIE_GAME_DIR:=/games/SteamLibrary/steamapps/common/INAZUMA ELEVEN Victory Road}"
: "${DBXV2_MERGED:=/home/ubuntu/re/dbxv2-merged}"
: "${GHIDRA_OUT:=/home/ubuntu/re/ghidra/out}"
: "${BUN_OS_ROOT:=/home/ubuntu/src/bun-os}"
export NIE_GAME_DIR
[ -d "$DBXV2_MERGED" ] && export NIE_EXTRA_GAMES="dbxv2=$DBXV2_MERGED"

W=${1:-/home/ubuntu/re/nie-e2e/run-$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$W/logs" "$W/var" "$W/out"
cd "$W" || exit 1
EXE="$NIE_GAME_DIR/nie.exe"
DB="$W/var/nie.sqlite"
ATLAS="$W/var/nie-atlas.sqlite"
GHIDRA_CSV="$GHIDRA_OUT/nie-$(sha256sum "$EXE" | cut -c1-12)/functions.csv"
STATUS="$W/status.tsv"
: >"$STATUS"

# step <name> <timeout-seconds> <command...>: run, log, record "name rc seconds".
step() {
  local name=$1 limit=$2 started rc
  shift 2
  started=$(date +%s)
  timeout "$limit" "$@" >"logs/$name.log" 2>&1
  rc=$?
  printf '%s\t%s\t%s\n' "$name" "$rc" "$(($(date +%s) - started))" >>"$STATUS"
  return "$rc"
}

skip() { printf '%s\tskip\t0\t%s\n' "$1" "$2" >>"$STATUS"; }

# First VFS path matching `query` (and extension) from `nie vfs find -j`, or empty.
first_vfs() {
  "$N" vfs find "$1" --ext "$2" -n 1 -j 2>/dev/null | python3 -c '
import json, sys
try:
    hits = json.load(sys.stdin)
except ValueError:
    sys.exit()
if hits:
    hit = hits[0]
    print(hit if isinstance(hit, str) else hit.get("path", ""))'
}

group_re() {
  # Every RE pass needs the binary registered by `nie seed`, which ingests an aphrody-nie-index
  # JSON (refs/iecode-re/research/aphrody-nie-index.json). Without one the chain is skipped
  # rather than failing eight times; the knowledge-base consumers below still run.
  if [ -n "${NIE_SEED_JSON:-}" ] && [ -f "$NIE_SEED_JSON" ]; then
    step re-seed 3600 "$N" seed --json "$NIE_SEED_JSON" --exe "$EXE" --db "$DB"
    step re-index 3600 "$N" index --exe "$EXE" --db "$DB"
    step re-rtti 3600 "$N" rtti --exe "$EXE" --db "$DB"
    step re-strings 3600 "$N" strings --exe "$EXE" --db "$DB"
    step re-pdata 3600 "$N" pdata --exe "$EXE" --db "$DB"
    step re-rebuild 14400 "$N" rebuild --exe "$EXE" --db "$DB"
    if [ -f "$GHIDRA_CSV" ]; then
      step re-recover-ghidra 7200 "$N" recover --exe "$EXE" --db "$DB" --ghidra-csv "$GHIDRA_CSV"
    else
      step re-recover 7200 "$N" recover --exe "$EXE" --db "$DB"
    fi
    step re-propagate 7200 "$N" propagate --db "$DB"
    step re-coverage 600 "$N" coverage --db "$DB"
  else
    skip re-chain "set NIE_SEED_JSON to an aphrody-nie-index.json to run seed..coverage"
  fi
  step mode-index 3600 "$N" mode index --db "$DB"
  step mode-export 600 "$N" mode export --db "$DB" -o out/modes.json
  step seed-ui 7200 "$N" seed-ui --db "$DB" --textures
  step atlas-build 14400 "$N" atlas build --db "$ATLAS" --root "$BUN_OS_ROOT" --kb "$DB" --json
  step atlas-status 300 "$N" atlas status --db "$ATLAS"
  step atlas-gaps 300 "$N" atlas gaps --db "$ATLAS" --limit 50 --json
  step atlas-next 300 "$N" atlas next --db "$ATLAS"
}

group_vfs() {
  step info 900 "$N" info --json &
  step locales 3600 "$N" locales --json &
  step vfs-stats 3600 "$N" vfs stats --top 100 &
  step vfs-formats 14400 "$N" vfs formats --parse -j &
  step textures 14400 "$N" textures --limit 100000000 --manifest out/g4tx-manifest.ndjson &
  step uniform-map 14400 "$N" uniform-map --out out/model-crc-manifest.ndjson &
  step video 14400 "$N" video liste --rapide --json &
  step icons 3600 "$N" icons index -o out/icons-index.json &
  step avatar 3600 "$N" avatar export -o out/avatar-resolved.json &
  step vn 3600 "$N" vn casting --json --limit 1000 &
  if [ -n "${NIE_EXTRA_GAMES:-}" ]; then
    step dbxv2-ls 900 "$N" vfs ls dbxv2/data &
    step dbxv2-stat 900 "$N" vfs stat dbxv2/data/chara/DMG/DMG.bcs &
    step dbxv2-find 1800 "$N" vfs find DMG.bcs -n 50 -j &
  else
    skip dbxv2 "no merged DBXV2 tree at $DBXV2_MERGED"
  fi
  wait
}

group_engine() {
  step play-match 3600 "$N" play --match --match-seconds 90 --out out/match-final.ppm --json
  step play-menu 1800 "$N" play --screen menu --frames 600 --cmd "down,down,enter,back" --out out/menu-final.ppm --json
  step net-sim 3600 "$N" net sim-match --ticks 6000 --seed 42 --json
}

# A character GLB is assembled live from the CPKs by aphrody-nie-model-serve (`nie convert` only
# handles images), then rendered by nie's 3D renderer. Needs the CRC manifest from uniform-map,
# so it runs after the parallel groups.
group_models() {
  local serve=${NIE_MODEL_SERVE:-$(dirname "$N")/aphrody-nie-model-serve} port=18797 code
  if [ ! -x "$serve" ] || [ ! -s out/model-crc-manifest.ndjson ]; then
    skip models "model-serve binary or CRC manifest missing"
    return
  fi
  timeout 1800 "$serve" --port "$port" --crc-manifest out/model-crc-manifest.ndjson \
    --cache-dir out/model-cache >logs/model-serve.log 2>&1 &
  for _ in $(seq 1 90); do
    curl -s -o /dev/null "http://127.0.0.1:$port/" && break
    sleep 2
  done
  for code in ${NIE_E2E_MODELS:-c01000010}; do
    step "glb-$code" 600 curl -sf --max-time 300 -o "out/$code.glb" "http://127.0.0.1:$port/model-full/$code.glb"
    step "png-$code" 1800 "$N" render glb-png "out/$code.glb" -o "out/$code.png"
    step "gif-$code" 3600 "$N" render glb-gif "out/$code.glb" -o "out/$code.gif" --frames 24
  done
  kill %1 2>/dev/null
}

group_lua() {
  step lua-audit 14400 "$N" lua-audit
}

group_mod() {
  local dir=out/mod-e2e table
  step mod-init 300 "$N" mod init --nom nie-e2e --auteur aphrody-dev -d "$dir" --description "nie e2e scratch mod (never installed)"
  table=$(first_vfs gamedata cfg.bin)
  if [ -n "$table" ]; then
    step mod-add 900 "$N" mod add "$table" -d "$dir"
  else
    skip mod-add "no gamedata cfg.bin found"
  fi
  step mod-validate 900 "$N" mod validate -d "$dir"
  step mod-status 900 "$N" mod status -d "$dir"
}

echo "nie e2e: $W (nie=$N, game=$NIE_GAME_DIR, extra=${NIE_EXTRA_GAMES:-none})"
group_re &
group_vfs &
group_engine &
group_lua &
group_mod &
wait
group_models

{
  echo "# nie e2e — $(basename "$W")"
  echo
  echo "nie \`$N\` · game \`$NIE_GAME_DIR\` · extra \`${NIE_EXTRA_GAMES:-none}\`"
  echo
  echo "| step | rc | seconds | note |"
  echo "|---|---|---|---|"
  sort "$STATUS" | awk -F'\t' '{printf "| %s | %s | %s | %s |\n", $1, $2, $3, $4}'
  echo
  awk -F'\t' '$2 == "0" {ok++} $2 != "0" && $2 != "skip" {ko++} $2 == "skip" {sk++}
    END {printf "ok=%d failed=%d skipped=%d\n", ok, ko, sk}' "$STATUS"
} >SUMMARY.md
cat SUMMARY.md
