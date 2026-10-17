#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Bun OS gaming host on the VPS: a casefolded ext4 games volume on the fast disk, gamescope,
# the Vulkan SDK, DXVK/vkd3d-proton, GE-Proton, umu, Heroic (legendary, EOS overlay), the Epic
# Games Launcher in a Proton prefix and the Proton EasyAntiCheat/BattlEye runtimes.
# Idempotent; run as the `ubuntu` user (sudo for system steps). Account logins stay manual.
set -euo pipefail

VULKAN_SDK_VERSION=1.4.363.0
GE_PROTON=GE-Proton11-9
DXVK=3.1.1
VKD3D_PROTON=3.0.1
HEROIC=2.22.4
UMU=1.4.4
GAMES_SIZE=180G

GAMES=/games
IMAGE=/var/lib/aphrody-games/games.img
TOOLS=$GAMES/tools
COMPAT=$TOOLS/compatibilitytools.d
fetch() { curl -fL --retry 3 -o "$2" "$1"; }

# Games volume: a sparse loop image on sda (2 GB/s; the btrfs pool on sdb/sdc reads ~15 MB/s),
# ext4 with casefold so Proton prefixes and game trees resolve case-insensitively in the kernel.
if ! findmnt -n "$GAMES" >/dev/null; then
  sudo install -d -m 0755 "${IMAGE%/*}" "$GAMES"
  if [ ! -f "$IMAGE" ]; then
    sudo truncate -s "$GAMES_SIZE" "$IMAGE"
    sudo mkfs.ext4 -q -L aphrody-games -O casefold -E encoding=utf8 -m 0 "$IMAGE"
  fi
  grep -q " $GAMES " /etc/fstab || echo "$IMAGE $GAMES ext4 loop,noatime,lazytime,commit=60,nofail 0 0" | sudo tee -a /etc/fstab >/dev/null
  sudo systemctl daemon-reload
  sudo mount "$GAMES"
fi
sudo chown ubuntu:ubuntu "$GAMES"
for dir in SteamLibrary heroic prefixes; do
  if [ ! -d "$GAMES/$dir" ]; then mkdir "$GAMES/$dir" && chattr +F "$GAMES/$dir"; fi
done
mkdir -p "$COMPAT" "$TOOLS/runtimes" "$TOOLS/downloads"

# System packages: gamescope (headless Wayland session for Steam), 32-bit Vulkan/GL, PipeWire
# (gamescope and Remote Play capture), Xwayland, winetricks helpers.
sudo dpkg --add-architecture i386
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  gamescope xwayland pipewire pipewire-pulse wireplumber dbus-user-session \
  mesa-vulkan-drivers mesa-vulkan-drivers:i386 libvulkan1 libvulkan1:i386 libgl1:i386 libegl1:i386 \
  vulkan-tools mesa-utils cabextract zstd xdotool x11-apps imagemagick xvfb python3

# Vulkan SDK (LunarG) under /opt with a profile hook.
if [ ! -d "/opt/vulkan-sdk/$VULKAN_SDK_VERSION" ]; then
  fetch "https://sdk.lunarg.com/sdk/download/$VULKAN_SDK_VERSION/linux/vulkansdk-linux-x86_64-$VULKAN_SDK_VERSION.tar.xz" "$TOOLS/downloads/vulkan-sdk.tar.xz"
  sudo install -d /opt/vulkan-sdk
  sudo tar -xJf "$TOOLS/downloads/vulkan-sdk.tar.xz" -C /opt/vulkan-sdk
  rm "$TOOLS/downloads/vulkan-sdk.tar.xz"
fi
sudo ln -sfn "/opt/vulkan-sdk/$VULKAN_SDK_VERSION" /opt/vulkan-sdk/current
sudo tee /etc/profile.d/vulkan-sdk.sh >/dev/null <<'EOF'
export VULKAN_SDK=/opt/vulkan-sdk/current/x86_64
export PATH="$VULKAN_SDK/bin:$PATH"
export LD_LIBRARY_PATH="$VULKAN_SDK/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export VK_ADD_LAYER_PATH="$VULKAN_SDK/share/vulkan/explicit_layer.d"
EOF

# Direct3D 8-11 (DXVK) and Direct3D 12 (vkd3d-proton) for prefixes outside Proton.
if [ ! -d "/opt/dxvk/dxvk-$DXVK" ]; then
  sudo install -d /opt/dxvk
  curl -fL "https://github.com/doitsujin/dxvk/releases/download/v$DXVK/dxvk-$DXVK.tar.gz" | sudo tar -xz -C /opt/dxvk
fi
sudo ln -sfn "/opt/dxvk/dxvk-$DXVK" /opt/dxvk/current
if [ ! -d "/opt/vkd3d-proton/vkd3d-proton-$VKD3D_PROTON" ]; then
  sudo install -d /opt/vkd3d-proton
  curl -fL "https://github.com/HansKristian-Work/vkd3d-proton/releases/download/v$VKD3D_PROTON/vkd3d-proton-$VKD3D_PROTON.tar.zst" | sudo tar --zstd -x -C /opt/vkd3d-proton
fi
sudo ln -sfn "/opt/vkd3d-proton/vkd3d-proton-$VKD3D_PROTON" /opt/vkd3d-proton/current

# GE-Proton, found by Steam through STEAM_EXTRA_COMPAT_TOOLS_PATHS and by Heroic/umu by path.
if [ ! -d "$COMPAT/$GE_PROTON" ]; then
  curl -fL "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/$GE_PROTON/$GE_PROTON-x86_64.tar.gz" | tar -xz -C "$COMPAT"
  mv "$COMPAT/$GE_PROTON-x86_64" "$COMPAT/$GE_PROTON"
fi
for old in "$COMPAT"/GE-Proton*; do [ "${old##*/}" = "$GE_PROTON" ] || rm -rf "$old"; done
mkdir -p ~/.config/environment.d
cat > ~/.config/environment.d/50-bun-os-gaming.conf <<EOF
STEAM_EXTRA_COMPAT_TOOLS_PATHS=$COMPAT
PROTONPATH=$COMPAT/$GE_PROTON
PROTON_EAC_RUNTIME=$TOOLS/runtimes/eac
PROTON_BATTLEYE_RUNTIME=$TOOLS/runtimes/battleye
VULKAN_SDK=/opt/vulkan-sdk/current/x86_64
EOF

# umu (Proton outside Steam with the Steam Runtime container).
if ! command -v umu-run >/dev/null || [ "$(umu-run --version 2>/dev/null | grep -o '[0-9.]*' | head -1)" != "$UMU" ]; then
  fetch "https://github.com/Open-Wine-Components/umu-launcher/releases/download/$UMU/python3-umu-launcher_$UMU-1_amd64_ubuntu-resolute.deb" "$TOOLS/downloads/python3-umu.deb"
  fetch "https://github.com/Open-Wine-Components/umu-launcher/releases/download/$UMU/umu-launcher_$UMU-1_all_ubuntu-resolute.deb" "$TOOLS/downloads/umu.deb"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$TOOLS/downloads/python3-umu.deb" "$TOOLS/downloads/umu.deb"
  rm "$TOOLS/downloads/python3-umu.deb" "$TOOLS/downloads/umu.deb"
fi

# Heroic (Epic, GOG, Amazon) with its bundled legendary on the PATH.
if [ "$(dpkg-query -W -f '${Version}' heroic 2>/dev/null)" != "$HEROIC" ]; then
  fetch "https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/releases/download/v$HEROIC/Heroic-$HEROIC-linux-amd64.deb" "$TOOLS/downloads/heroic.deb"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$TOOLS/downloads/heroic.deb"
  rm "$TOOLS/downloads/heroic.deb"
fi
sudo ln -sfn /opt/Heroic/resources/app.asar.unpacked/build/bin/x64/linux/legendary /usr/local/bin/legendary
mkdir -p ~/.config/legendary
[ -f ~/.config/legendary/config.ini ] || cat > ~/.config/legendary/config.ini <<EOF
[Legendary]
install_dir = $GAMES/heroic
disable_update_check = true

[default.env]
STEAM_COMPAT_DATA_PATH = $GAMES/prefixes/legendary
PROTON_EAC_RUNTIME = $TOOLS/runtimes/eac
PROTON_BATTLEYE_RUNTIME = $TOOLS/runtimes/battleye

[default]
wine_executable = $COMPAT/$GE_PROTON/files/bin/wine
wine_prefix = $GAMES/prefixes/legendary/pfx
EOF

# Proton EasyAntiCheat and BattlEye runtimes for Heroic/umu (Steam apps 1826330 and 1161040 need
# a signed-in account, so outside Steam they come from the Lutris runtime index Heroic uses).
for name in eac battleye; do
  if [ ! -f "$TOOLS/runtimes/$name/.complete" ]; then
    url=$(curl -fsS https://lutris.net/api/runtimes | python3 -c "import json,sys; print(next(r['url'] for r in json.load(sys.stdin) if r['name']=='${name}_runtime'))")
    rm -rf "$TOOLS/runtimes/$name" && mkdir -p "$TOOLS/runtimes/$name"
    curl -fL "$url" | tar -xJ -C "$TOOLS/runtimes/$name" --strip-components=1
    touch "$TOOLS/runtimes/$name/.complete"
  fi
done

# Epic Games Launcher in its own Proton prefix (EOS services and overlay come with it).
EPIC_PREFIX=$GAMES/prefixes/epic
if [ ! -f "$EPIC_PREFIX/drive_c/Program Files/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe" ]; then
  [ -f "$TOOLS/downloads/EpicInstaller.msi" ] ||
    fetch "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi" "$TOOLS/downloads/EpicInstaller.msi"
  mkdir -p "$EPIC_PREFIX"
  WINEPREFIX="$EPIC_PREFIX" GAMEID=umu-epicgameslauncher STORE=egs PROTONPATH="$COMPAT/$GE_PROTON" \
    xvfb-run -a umu-run msiexec /i "Z:${TOOLS//\//\\}\\downloads\\EpicInstaller.msi" /qn
  rm "$TOOLS/downloads/EpicInstaller.msi"
fi

# Headless gamescope session running Steam Big Picture (not enabled: one Steam client per user).
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/bun-os-gamescope.service <<'EOF'
[Unit]
Description=Bun OS gaming session (gamescope headless + Steam Big Picture)
After=pipewire.service

[Service]
ExecStart=/usr/games/gamescope --backend headless -W 1920 -H 1080 -r 60 --steam -- /usr/games/steam -gamepadui -no-cef-sandbox
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload

echo "games volume: $(df -h "$GAMES" | awk 'NR==2 {print $2" total, "$4" free"}')"
