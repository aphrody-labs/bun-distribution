#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Déploie la synchronisation Discord sur le hub vps (idempotent) : code dans ~/apps/discord-sync, unités du
# catalogue, retrait de l'ancien veilleur aphrody-omar-watch. Usage (racine du dépôt) : install.sh [--plan] [host]
# Aucun secret : /etc/aphrody-discord.env existe déjà sur l'hôte et n'est ni lu ni copié.
set -euo pipefail
plan=0; [ "${1:-}" = "--plan" ] && { plan=1; shift; }
host=${1:-vps}
dest='~/apps/discord-sync'
src=scripts/tools/infra/discord-sync
files=("$src/api.ts" "$src/collect.ts" "$src/protocol.ts" "$src/sync.ts" "$src/cli.ts" "$src/fiche.ts" packages/engine/core/src/host/net-facts.ts)
units=(infra/config/host/systemd/aphrody/aphrody-discord-sync.service infra/config/host/systemd/aphrody/aphrody-discord-sync.timer)
echo "plan: $host:$dest <- ${files[*]}"
echo "plan: unités ${units[*]} -> /etc/systemd/system, enable --now aphrody-discord-sync.timer"
echo "plan: retrait aphrody-omar-watch (timer, service, /usr/local/libexec/aphrody-omar-watch, /var/lib/aphrody-omar-watch)"
[ "$plan" = 1 ] && exit 0
tar -c "${files[@]}" infra/config/host/discord-sync.json | ssh "$host" "sudo -n rm -rf $dest.new && sudo -n mkdir -p $dest.new && sudo -n tar -x --no-same-owner --no-same-permissions -C $dest.new && sudo -n cp $dest.new/infra/config/host/discord-sync.json $dest.new/discord-sync.json && sudo -n chown -R root:root $dest.new && sudo -n chmod -R go+rX,go-w $dest.new && sudo -n rm -rf $dest.old && { [ ! -d $dest ] || sudo -n mv $dest $dest.old; } && sudo -n mv $dest.new $dest && sudo -n rm -rf $dest.old"
for u in "${units[@]}"; do ssh "$host" "sudo -n tee /etc/systemd/system/$(basename "$u") >/dev/null" < "$u"; done
ssh "$host" 'sudo -n systemctl daemon-reload && sudo -n systemctl enable --now aphrody-discord-sync.timer && systemctl is-enabled aphrody-discord-sync.timer && systemctl is-active aphrody-discord-sync.timer'
