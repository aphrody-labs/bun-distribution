#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
# Run as the WSL owner, after the elevated Windows installer. Binaries must
# already be built; root binaries are copied out of the writable checkout.
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $(id -u) == 0 ]]; then
    printf '%s\n' 'Run as the WSL owner; sudo handles the privileged installation.' >&2
    exit 1
fi
binary_dir=${1:-"$repo_root/target/debug"}
windows_dir=${2:-$(wslpath -u 'C:\ProgramData\Aphrody\Host')}
owner_group=$(id -gn)
case "$owner_group" in *[!a-zA-Z0-9_-]*) exit 1;; esac
# One multi-call binary: aphrody-kernel and aphrody-host-service dispatch on their invocation name.
test -x "$binary_dir/aphrody"
umask 077
stable_dir="$HOME/.local/lib/aphrody/host-bridge"
config_dir="$HOME/.config/aphrody/host-bridge"
mkdir -p "$stable_dir" "$config_dir" "$HOME/.local/bin" "$HOME/.config/systemd/user"
install -m 755 "$binary_dir/aphrody" "$stable_dir/aphrody.new"
mv -f "$stable_dir/aphrody.new" "$stable_dir/aphrody"
for binary in aphrody aphrody-kernel aphrody-host-service; do
    ln -sfn "$stable_dir/aphrody" "$HOME/.local/bin/$binary"
done
for peer in windows desktop; do
    install -m 600 "$windows_dir/linux-$peer.json" "$config_dir/$peer.json"
done
bun "${APHRODY_YOLO_ROOT:-$HOME/src/aphrody}/packages/engine/core/src/units/cli.ts" render --out "$HOME/.config/systemd/user" aphrody-kernel.service 'aphrody-host-bridge@.service'
sudo install -d -o root -g root -m 755 /usr/local/lib/aphrody/host-bridge
sudo install -o root -g root -m 755 "$binary_dir/aphrody" /usr/local/lib/aphrody/host-bridge/aphrody-kernel.new
sudo mv -f /usr/local/lib/aphrody/host-bridge/aphrody-kernel.new /usr/local/lib/aphrody/host-bridge/aphrody-kernel
python3 - "$config_dir/privileged.json" <<'PY'
import json, os, secrets, sys
from pathlib import Path
path = Path(sys.argv[1])
token = json.loads(path.read_text())['token'] if path.exists() else secrets.token_hex(32)
temporary = path.with_suffix('.new')
temporary.write_text(json.dumps({'port': 1, 'peer': 'privileged', 'remoteEndpoint': '/run/aphrody/privileged.sock', 'token': token}))
os.chmod(temporary, 0o600)
os.replace(temporary, path)
PY
sudo python3 - "$config_dir/privileged.json" <<'PY'
import json, os, sys
from pathlib import Path
root = Path('/etc/aphrody/host-bridge')
root.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(root, 0o700)
token = json.loads(Path(sys.argv[1]).read_text())['token']
temporary = root / 'auth.new'
temporary.write_text(json.dumps({'principals': [{'id': 'owner-bridge', 'token': token, 'toolPrefixes': ['*'], 'registerSubsystems': True, 'publishEvents': True}]}))
os.chmod(temporary, 0o600)
os.replace(temporary, root / 'auth.json')
PY
# The checked-in unit describes aphro's workstation; render its socket group
# for the invoking owner when installed on another WSL account.
sed "s/^Group=aphro$/Group=$owner_group/;s/chgrp aphro /chgrp $owner_group /" "${YOLO_ROOT:-$HOME/src/aphrody}/tools/config/host/systemd/aphrody/aphrody-privileged-kernel.service" | sudo tee /etc/systemd/system/aphrody-privileged-kernel.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable aphrody-privileged-kernel.service
sudo systemctl restart aphrody-privileged-kernel.service
sudo loginctl enable-linger "$(id -un)"
systemctl --user daemon-reload
systemctl --user enable aphrody-kernel.service aphrody-host-bridge@windows.service aphrody-host-bridge@desktop.service aphrody-host-bridge@privileged.service
systemctl --user restart aphrody-kernel.service
systemctl --user restart aphrody-host-bridge@windows.service aphrody-host-bridge@desktop.service aphrody-host-bridge@privileged.service
systemctl --user --no-pager --full status aphrody-kernel.service aphrody-host-bridge@windows.service aphrody-host-bridge@desktop.service aphrody-host-bridge@privileged.service
