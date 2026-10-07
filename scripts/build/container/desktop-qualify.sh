#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Qualify the build/runtime dependency boundary without launching a browser.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
image_prefix=${APHRODY_DESKTOP_IMAGE_PREFIX:-aphrody-desktop-check}
cache_dir=${SCCACHE_DIR:-$HOME/.cache/sccache}
mkdir -p "$cache_dir"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
# The builder's uid 1000 must be able to write into this disposable mount.
chmod 0777 "$stage"
docker build -f "$root/tools/config/container/desktop/Dockerfile" --target builder -t "$image_prefix:builder" "$root"
docker build -f "$root/tools/config/container/desktop/Dockerfile" --target runtime -t "$image_prefix:runtime" "$root"
rust_version=$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$root/rust-toolchain.toml")
bun_version=$(sed -nE 's/.*"packageManager": "bun@([^"]+)".*/\1/p' "$root/package.json")
cat > "$stage/dependencies.c" <<'EOF'
#include <dlfcn.h>
#include <gtk/gtk.h>
#include <stdio.h>
int main(void) {
  if (gtk_get_major_version() != 4) return 1;
  const char *libraries[] = {
    "libgtk-4.so.1", "libnss3.so", "libnspr4.so", "libasound.so.2",
    "libcups.so.2", "libdrm.so.2", "libgbm.so.1", "libX11.so.6",
    "libxcb.so.1", "libXcomposite.so.1", "libXdamage.so.1", "libXext.so.6",
    "libXfixes.so.3", "libxkbcommon.so.0", "libXrandr.so.2",
    "libXrender.so.1", "libXss.so.1", "libXtst.so.6", "libssl.so.3"
  };
  for (unsigned int i = 0; i < sizeof(libraries) / sizeof(libraries[0]); ++i) {
    void *handle = dlopen(libraries[i], RTLD_NOW | RTLD_LOCAL);
    if (!handle) { fprintf(stderr, "%s: %s\n", libraries[i], dlerror()); return 1; }
    if (dlclose(handle)) return 1;
    puts(libraries[i]);
  }
  return 0;
}
EOF
docker run --rm --cap-drop ALL --security-opt no-new-privileges \
  -e EXPECTED_RUST="$rust_version" -e EXPECTED_BUN="$bun_version" \
  -v "$cache_dir:/home/builder/.cache/sccache" \
  -v "$stage:/proof" "$image_prefix:builder" sh -ec '
    test "$(id -u)" = 1000
    test "$APHRODY_CLOUD" = 1
    test "$RUSTC_WRAPPER" = sccache
    rustc --version | grep -F "rustc $EXPECTED_RUST "
    cargo clippy --version
    rustfmt --version
    test "$(bun --version)" = "$EXPECTED_BUN"
    sccache --version
    pkg-config --modversion gtk4 nss alsa libdrm gbm x11 xkbcommon
    cc -Wall -Wextra -Werror /proof/dependencies.c -ldl $(pkg-config --cflags --libs gtk4) -o /proof/dependencies
    printf "fn main() { println!(\"rust-toolchain-ok\"); }\n" > /proof/main.rs
    sccache rustc /proof/main.rs -o /proof/rust-proof
    /proof/rust-proof
  '
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$stage:/proof:ro" "$image_prefix:runtime" sh -ec '
    test "$(id -u)" = 1000
    ! command -v rustc
    ! command -v bun
    ! command -v cc
    ! dpkg-query -W libwebkit2gtk-4.1-0 >/dev/null 2>&1
    /proof/dependencies
    /proof/rust-proof
  '
docker image inspect --format '{{.Id}} {{.Size}}' "$image_prefix:builder" "$image_prefix:runtime"
printf "Desktop build and runtime dependencies qualified; CEF payload and app rendering remain separate gates.\n"
