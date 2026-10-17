#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Steam client of the VPS gaming host: restart it with download and Remote Play tuning for a
# CPU-only host, inside the gaming slice, on the Xvfb desktop :99. Signs in through the session
# Steam already caches in config.vdf (ConnectCache); never handles credentials.
# Idempotent; run as `ubuntu`.
set -euo pipefail
ROOT=$HOME/.steam
CONFIG=$ROOT/steam/config/config.vdf
ACCOUNT=${STEAM_ACCOUNT:-darksasuke971}
# Steam Play tools per app id; "0" is the default for every Windows title.
COMPAT=${STEAM_COMPAT:-0=proton_experimental 2799860=proton_experimental}

stop_steam() {
  local pid
  pid=$(pgrep -f "^$ROOT/ubuntu12_32/steam " | head -1 || true)
  [ -n "$pid" ] || return 0
  kill -TERM "$pid"
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 2; done
  kill -KILL "$pid" 2>/dev/null || true
  pkill -f "$ROOT/ubuntu12_64/steamwebhelper" || true
  sleep 2
}
stop_steam

# Downloads: more parallel CDN connections and HTTP/1.1 chunk fetches (faster on Valve's CDN).
cat > "$ROOT/steam_dev.cfg" <<'EOF'
@nClientDownloadEnableHTTP2PreferenceDefault 0
@fDownloadRateImprovementToAddAnotherConnection 1.0
EOF

python3 - "$CONFIG" "$ROOT/registry.vdf" "$ACCOUNT" "$COMPAT" <<'PY'
import re, sys, pathlib
config, registry = map(pathlib.Path, sys.argv[1:3])
account = sys.argv[3]
text = config.read_text()
def put(block: str, key: str, value: str, text: str) -> str:
    match = re.search(r'(\n(\t+)"%s"\n\t+\{\n)' % block, text)
    if not match:
        return text
    body_start = match.end()
    indent = match.group(2) + "\t"
    pattern = re.compile(r'\n%s"%s"\t\t"[^"]*"' % (indent, key))
    end = text.index("\n" + match.group(2) + "}", body_start)
    if pattern.search(text, body_start, end):
        return text[:body_start] + pattern.sub('\n%s"%s"\t\t"%s"' % (indent, key, value), text[body_start:end], 1) + text[end:]
    return text[:body_start] + '%s"%s"\t\t"%s"\n' % (indent, key, value) + text[body_start:]
# No background Vulkan shader (Fossilize) compilation: on llvmpipe it only burns the CPU.
text = put("ShaderCacheManager", "EnableShaderBackgroundProcessing", "0", text)
text = put("ShaderCacheManager", "EnablePrecache", "0", text)
# Unthrottled downloads, also while streaming or playing.
text = put("Steam", "DownloadThrottleKbps", "0", text)
text = put("Steam", "AllowDownloadsDuringGameplay", "1", text)
# Steam Play: Proton for every Windows title ("0") and explicit per-app tools (STEAM_COMPAT).
mapping = dict(item.split("=", 1) for item in sys.argv[4].split())
match = re.search(r'\n(\t+)"Steam"\n\t+\{\n', text)
if match and mapping:
    indent = match.group(1) + "\t"
    entries = "".join(
        '%s\t"%s"\n%s\t{\n%s\t\t"name"\t\t"%s"\n%s\t\t"config"\t\t""\n%s\t\t"priority"\t\t"250"\n%s\t}\n'
        % (indent, app, indent, indent, tool, indent, indent, indent)
        for app, tool in mapping.items()
    )
    block = re.search(r'\n%s"CompatToolMapping"\n%s\{\n.*?\n%s\}\n' % (indent, indent, indent), text, re.S)
    new_block = '\n%s"CompatToolMapping"\n%s{\n%s%s}\n' % (indent, indent, entries, indent)
    if block:
        text = text[: block.start()] + new_block + text[block.end():]
    else:
        text = text[: match.end()] + new_block[1:] + text[match.end():]
config.write_text(text)
reg = registry.read_text()
if "AutoLoginUser" not in reg:
    reg = reg.replace('"StartupModeTmpIsValid"', '"AutoLoginUser"\t\t"%s"\n\t\t\t\t\t"RememberPassword"\t\t"1"\n\t\t\t\t\t"StartupModeTmpIsValid"' % account, 1)
    registry.write_text(reg)
PY

# -silent keeps the client UI closed (its software-rendered CEF otherwise costs ~1.5 cores).
cd "$HOME"
PATH=$HOME/build/fakebin:$PATH DISPLAY=:99 STEAM_EXTRA_COMPAT_TOOLS_PATHS=/games/tools/compatibilitytools.d PROTON_USE_NTSYNC=1 \
  setsid nohup systemd-run --user --scope --slice=bun-os-gaming.slice --unit="bun-os-steam-$(date +%s)" -q \
  /usr/games/steam -silent -no-cef-sandbox -cef-disable-gpu >> "$HOME/build/steam-client.log" 2>&1 < /dev/null &
for _ in $(seq 1 60); do tail -3 "$ROOT/steam/logs/connection_log.txt" | grep -q "Logged On" && break; sleep 3; done
tail -1 "$ROOT/steam/logs/connection_log.txt"
