#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# CPU-only gaming tunables of the VPS (12 Haswell cores, 45 GiB, no GPU), applied without touching
# production services: ntsync for Proton 11, SteamOS/CachyOS sysctls, gamemode, shader caches on
# the fast games volume, and a user slice that caps the gaming session below production.
# Idempotent; run as `ubuntu` (sudo for system files).
set -euo pipefail
GAMES=/games

# ntsync: NT synchronization primitives in the kernel (Wine/Proton 11 use /dev/ntsync).
echo ntsync | sudo tee /etc/modules-load.d/ntsync.conf >/dev/null
echo 'KERNEL=="ntsync", MODE="0666"' | sudo tee /etc/udev/rules.d/70-ntsync.rules >/dev/null
sudo modprobe ntsync
sudo udevadm control --reload
sudo udevadm trigger --name-match=ntsync

# SteamOS/CachyOS gaming sysctls; swappiness and dirty ratios stay owned by the host policy.
sudo tee /etc/sysctl.d/90-bun-os-gaming.conf >/dev/null <<'EOF'
# Games with many mappings (SteamOS value).
vm.max_map_count = 2147483642
# No split-lock slowdown penalty for Windows games doing split-locked atomics.
kernel.split_lock_mitigate = 0
# Fair page lock hand-off off (CachyOS default), lower stalls under memory pressure.
vm.page_lock_unfairness = 1
EOF
# The host build tuning file sorts last and would pin max_map_count back to 1048576.
[ -f /etc/sysctl.d/99-stable-build.conf ] && sudo sed -i '/^vm.max_map_count=/d' /etc/sysctl.d/99-stable-build.conf
sudo sysctl -q --system

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends gamemode

# Shader and pipeline caches on /games (the btrfs /home reads ~15 MB/s); llvmpipe on every core.
mkdir -p "$GAMES/cache/mesa" "$GAMES/cache/dxvk" "$GAMES/cache/vkd3d"
mkdir -p ~/.config/environment.d
cat > ~/.config/environment.d/60-bun-os-gaming-cpu.conf <<EOF
LP_NUM_THREADS=12
MESA_SHADER_CACHE_DIR=$GAMES/cache/mesa
MESA_SHADER_CACHE_MAX_SIZE=16G
DXVK_STATE_CACHE_PATH=$GAMES/cache/dxvk
VKD3D_SHADER_CACHE_PATH=$GAMES/cache/vkd3d
PROTON_USE_NTSYNC=1
EOF

# Gaming slice of the user manager: games use free cores but yield to production under load.
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/bun-os-gaming.slice <<'EOF'
[Unit]
Description=Bun OS gaming sessions

[Slice]
CPUWeight=50
IOWeight=50
MemoryHigh=28G
MemoryMax=32G
EOF
mkdir -p ~/.config/systemd/user/bun-os-gamescope.service.d
cat > ~/.config/systemd/user/bun-os-gamescope.service.d/slice.conf <<'EOF'
[Service]
Slice=bun-os-gaming.slice
EOF
systemctl --user daemon-reload

echo "ntsync: $(ls -l /dev/ntsync)"
