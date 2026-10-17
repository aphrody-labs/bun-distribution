#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Newest Mesa for the GPU-less VPS, built for its Haswell cores (x86-64-v3): llvmpipe (GL/GLES/EGL),
# lavapipe (Vulkan) and zink, in /opt/mesa-bunos/<version> beside Ubuntu's Mesa. Gaming sessions
# select it through ~/.config/environment.d; the system Mesa stays the default.
set -euo pipefail

MESA=26.3.0-rc1
PREFIX=/opt/mesa-bunos/$MESA
SRC=/games/build/mesa-$MESA
JOBS=${JOBS:-6}

if [ ! -f "$PREFIX/.complete" ]; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get build-dep -y -qq mesa
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends meson ninja-build glslang-tools python3-mako python3-yaml python3-ply
  mkdir -p "${SRC%/*}"
  [ -d "$SRC" ] || curl -fL "https://archive.mesa3d.org/mesa-$MESA.tar.xz" | tar -xJ -C "${SRC%/*}"
  cd "$SRC"
  CFLAGS="-O3 -march=haswell -mtune=haswell -pipe" CXXFLAGS="-O3 -march=haswell -mtune=haswell -pipe" \
    meson setup build --wipe --prefix "$PREFIX" --libdir lib --buildtype release -Db_lto=true -Db_ndebug=true \
      -Dgallium-drivers=llvmpipe,zink -Dvulkan-drivers=swrast -Dplatforms=x11,wayland \
      -Dglx=dri -Degl=enabled -Dgbm=enabled -Dglvnd=enabled -Dllvm=enabled -Dshared-llvm=enabled \
      -Dvideo-codecs=all -Dvulkan-layers=device-select,overlay -Dtools= -Dbuild-tests=false
  nice -n 15 ninja -C build -j "$JOBS"
  sudo ninja -C build install
  sudo touch "$PREFIX/.complete"
  rm -rf "$SRC"
fi
sudo ln -sfn "$PREFIX" /opt/mesa-bunos/current
for old in /opt/mesa-bunos/*/; do
  case "$old" in "$PREFIX/" | /opt/mesa-bunos/current/) ;; *) sudo rm -rf "$old" ;; esac
done

# 64-bit Vulkan from this build, 32-bit (Proton's i386 side) from Ubuntu's lavapipe.
mkdir -p ~/.config/environment.d
cat > ~/.config/environment.d/70-bun-os-mesa.conf <<'EOF'
LD_LIBRARY_PATH=/opt/mesa-bunos/current/lib
LIBGL_DRIVERS_PATH=/opt/mesa-bunos/current/lib/dri
__EGL_VENDOR_LIBRARY_FILENAMES=/opt/mesa-bunos/current/share/glvnd/egl_vendor.d/50_mesa.json
VK_DRIVER_FILES=/opt/mesa-bunos/current/share/vulkan/icd.d/lvp_icd.x86_64.json:/usr/share/vulkan/icd.d/lvp_icd.i686.json
EOF
VK_DRIVER_FILES=/opt/mesa-bunos/current/share/vulkan/icd.d/lvp_icd.x86_64.json vulkaninfo --summary | grep -E "driverInfo|apiVersion|deviceName"
LD_LIBRARY_PATH=/opt/mesa-bunos/current/lib xvfb-run -a glxinfo -B | grep -E "OpenGL (renderer|core profile version)"
