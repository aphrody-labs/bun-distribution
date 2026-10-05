#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Aphrody installer. One line:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh
#
# Installs the single `aphrody` multi-call binary (it carries the MCP server: `aphrody-mcp`, and every
# former standalone CLI name, linked by `aphrody self install-path`). Other components on request:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | APHRODY_COMPONENTS="aphrody yolo plugin-yolo" sh
#
# Environment:
#   APHRODY_DOWNLOAD_URL  base URL of the download server (default https://downloads.aphrody.com)
#   APHRODY_COMPONENTS    space separated: aphrody yolo plugin-aphrody plugin-yolo plugin-shenron
#                         (default: aphrody)
#   APHRODY_PREFIX        install prefix (default ~/.local): binaries in <prefix>/lib/aphrody/<release>,
#                         links in ~/.local/bin, plugins in <prefix>/share/aphrody/plugins
#   YOLO_HOME             yolo home (default ~/.yolo)
#   APHRODY_NO_LINKS=1    do not run `aphrody self install-path`
#
# Every download is verified against SHA256SUMS of the same release before it is used.
set -eu

BASE="${APHRODY_DOWNLOAD_URL:-https://downloads.aphrody.com}"
COMPONENTS="${APHRODY_COMPONENTS:-aphrody}"
PREFIX="${APHRODY_PREFIX:-$HOME/.local}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) os_part=unknown-linux-gnu ;;
  Darwin) os_part=apple-darwin ;;
  *) die "unsupported OS: $os (Windows: irm $BASE/install.ps1 | iex)" ;;
esac
case "$arch" in
  x86_64 | amd64) arch_part=x86_64 ;;
  aarch64 | arm64) arch_part=aarch64 ;;
  *) die "unsupported architecture: $arch" ;;
esac
TARGET="$arch_part-$os_part"

if have curl; then fetch() { curl -fsSL "$1" -o "$2"; }
elif have wget; then fetch() { wget -qO "$2" "$1"; }
else die "curl or wget is required"; fi
if have sha256sum; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif have shasum; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi
have tar || die "tar is required"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "cannot read $BASE/SHA256SUMS"

# file_for <prefix> <suffix-pattern>: the release file `<prefix>-*<suffix>` listed in SHA256SUMS
file_for() { awk -v p="$1" -v s="$2" '{ n=$2; if (index(n, p "-") == 1 && n ~ s) print n }' "$TMP/SHA256SUMS" | head -1; }

download() { # file -> $TMP/file, verified
  name="$1"
  fetch "$BASE/files/$name" "$TMP/$name" || die "cannot download $BASE/files/$name"
  want=$(awk -v n="$name" '$2 == n { print $1 }' "$TMP/SHA256SUMS")
  [ -n "$want" ] || die "$name is not listed in SHA256SUMS"
  got=$(sha256 "$TMP/$name")
  [ "$want" = "$got" ] || die "checksum mismatch for $name (expected $want, got $got)"
  say "  verified $name"
}

install_aphrody() {
  name=$(file_for aphrody "-$TARGET[.]tar[.]gz\$")
  [ -n "$name" ] || die "no aphrody build for $TARGET in this release"
  download "$name"
  release=${name%-"$TARGET".tar.gz}
  dest="$PREFIX/lib/aphrody/$release"
  mkdir -p "$dest"
  tar -xzf "$TMP/$name" -C "$dest"
  [ -x "$dest/aphrody" ] || die "the archive has no aphrody executable"
  "$dest/aphrody" --version >/dev/null || die "the downloaded aphrody does not run on this host"
  if [ -z "${APHRODY_NO_LINKS:-}" ]; then
    mkdir -p "$HOME/.local/bin"
    "$dest/aphrody" self install-path --bin "$dest/aphrody" || die "aphrody self install-path failed"
  fi
  say "aphrody installed in $dest ($("$dest/aphrody" --version | head -1))"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "add $HOME/.local/bin to PATH" ;; esac
}

install_yolo() {
  name=$(file_for yolo "-$TARGET[.]tar[.]gz\$")
  [ -n "$name" ] || die "no yolo build for $TARGET in this release"
  download "$name"
  installer="$TMP/install-yolo.sh"
  fetch "$BASE/install-yolo.sh" "$installer" || die "cannot download install-yolo.sh"
  # The yolo installer reads SHA256SUMS and the archive from a local release directory.
  mkdir -p "$TMP/yolo-release"
  cp "$TMP/SHA256SUMS" "$TMP/$name" "$TMP/yolo-release/"
  YOLO_RELEASE_DIR="$TMP/yolo-release" YOLO_NO_CRATES=1 sh "$installer"
}

install_plugin() {
  component="$1"
  name=$(file_for "$component" "[.]tar[.]gz\$")
  [ -n "$name" ] || die "no $component archive in this release"
  download "$name"
  dest="$PREFIX/share/aphrody/plugins/$component"
  rm -rf "$dest.new"
  mkdir -p "$dest.new"
  tar -xzf "$TMP/$name" -C "$dest.new"
  rm -rf "$dest"
  mv "$dest.new" "$dest"
  say "$component installed in $dest (claude --plugin-dir $dest)"
}

for component in $COMPONENTS; do
  say "Installing $component ($TARGET)"
  case "$component" in
    aphrody) install_aphrody ;;
    yolo) install_yolo ;;
    plugin-aphrody | plugin-yolo | plugin-shenron) install_plugin "$component" ;;
    *) die "unknown component: $component" ;;
  esac
done
