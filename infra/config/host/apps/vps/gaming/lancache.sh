#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Steam LAN cache of the VPS: packages/bun-steam/src/lancache.ts as a user service (port 8099),
# lancache.steamcontent.com pinned to an unused private address and nft-redirected to it, so the
# Steam client and steamcmd download depot chunks through the Bun proxy (cache on /games).
# Copy lancache.ts to ~/apps/bun-steam/ first. Idempotent; run as `ubuntu`.
set -euo pipefail
mkdir -p ~/apps/bun-steam /games/cache/steam-lancache
cat > ~/.config/systemd/user/bun-os-lancache.service <<'UNIT'
[Unit]
Description=Bun OS Steam LAN cache (Bun proxy for lancache.steamcontent.com)

[Service]
ExecStart=/home/ubuntu/.local/bin/bun /home/ubuntu/apps/bun-steam/lancache.ts serve --hostname 0.0.0.0 --port 8099 --root /games/cache/steam-lancache
Restart=on-failure
Slice=bun-os-gaming.slice

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now bun-os-lancache.service
# Steam uses a LAN cache when lancache.steamcontent.com resolves to a private address: point it at
# an unused private address and redirect port 80 there to the Bun proxy (nginx owns *:80).
grep -q "lancache.steamcontent.com" /etc/hosts || echo "10.255.77.77 lancache.steamcontent.com" | sudo tee -a /etc/hosts >/dev/null
sudo mkdir -p /etc/nftables.d
sudo tee /etc/nftables.d/bun-os-lancache.nft >/dev/null <<'NFT'
table ip bun_os_lancache {
  chain output {
    type nat hook output priority -100;
    ip daddr 10.255.77.77 tcp dport 80 redirect to :8099
  }
  chain prerouting {
    type nat hook prerouting priority -100;
    iifname "wg1" ip daddr 10.255.77.77 tcp dport 80 dnat to 10.200.77.1:8099
  }
}
NFT
sudo nft delete table ip bun_os_lancache 2>/dev/null || true
sudo nft -f /etc/nftables.d/bun-os-lancache.nft
cat <<'UNIT' | sudo tee /etc/systemd/system/bun-os-lancache-nft.service >/dev/null
[Unit]
Description=Bun OS Steam LAN cache redirect
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/nftables.d/bun-os-lancache.nft
ExecStop=/usr/sbin/nft delete table ip bun_os_lancache

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable bun-os-lancache-nft.service >/dev/null 2>&1
sleep 1
systemctl --user is-active bun-os-lancache.service
getent hosts lancache.steamcontent.com
