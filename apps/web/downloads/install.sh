#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Aphrody installer. One line:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh
#
# The command-line twin of Aphrody-Setup.exe (Windows, one click): by default (`all`) it installs the single
# `aphrody` multi-call binary (it carries the MCP server: `aphrody-mcp`, and every former standalone CLI name,
# linked by `aphrody self install-path`), yolo, the Claude plugins, and declares the aphrody MCP server and the
# plugins in Claude Code when it is installed. With `all`, a component not published for this platform is
# skipped with a note; a component named explicitly must install. One component only:
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | APHRODY_COMPONENTS="aphrody" sh
#
# Environment:
#   APHRODY_DOWNLOAD_URL  base URL of the download server (default https://downloads.aphrody.com)
#   APHRODY_COMPONENTS    `all` (default) or space separated: aphrody yolo plugin-aphrody plugin-yolo
#                         plugin-shenron mcp
#   APHRODY_PREFIX        install prefix (default ~/.local): binaries in <prefix>/lib/aphrody/<release>,
#                         links in ~/.local/bin, plugins in <prefix>/share/aphrody/plugins
#   YOLO_HOME             yolo home (default ~/.yolo)
#   APHRODY_NO_LINKS=1    do not run `aphrody self install-path`
#
# Every download is verified against SHA256SUMS of the same release before it is used.
set -eu

BASE="${APHRODY_DOWNLOAD_URL:-https://downloads.aphrody.com}"
COMPONENTS="${APHRODY_COMPONENTS:-all}"
ALL=""
if [ "$COMPONENTS" = all ]; then
  ALL=1
  COMPONENTS="aphrody yolo plugin-aphrody plugin-yolo plugin-shenron mcp"
fi
PREFIX="${APHRODY_PREFIX:-$HOME/.local}"

say() { printf '%s\n' "$*"; }
# skip <message>: with `all`, an unpublished component is a note; named explicitly, it is an error.
skip() { if [ -n "$ALL" ]; then say "  skipped: $*"; return 0; fi; die "$*"; }
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
  name=$(file_for aphrody "-${TARGET}[.]tar[.]gz\$")
  [ -n "$name" ] || { skip "no aphrody build for $TARGET in this release"; return 0; }
  download "$name"
  release=${name%-"$TARGET".tar.gz}
  dest="$PREFIX/lib/aphrody/$release"
  mkdir -p "$dest"
  tar -xzf "$TMP/$name" -C "$dest"
  [ -x "$dest/aphrody" ] || die "the archive has no aphrody executable"
  APHRODY_BIN="$dest/aphrody"
  "$dest/aphrody" --version >/dev/null || die "the downloaded aphrody does not run on this host"
  if [ -z "${APHRODY_NO_LINKS:-}" ]; then
    mkdir -p "$HOME/.local/bin"
    "$dest/aphrody" self install-path --bin "$dest/aphrody" || die "aphrody self install-path failed"
  fi
  say "aphrody installed in $dest ($("$dest/aphrody" --version | head -1))"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "add $HOME/.local/bin to PATH" ;; esac
}

install_yolo() {
  name=$(file_for yolo "-${TARGET}[.]tar[.]gz\$")
  [ -n "$name" ] || { skip "no yolo build for $TARGET in this release"; return 0; }
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
  [ -n "$name" ] || { skip "no $component archive in this release"; return 0; }
  download "$name"
  dest="$PREFIX/share/aphrody/plugins/$component"
  rm -rf "$dest.new"
  mkdir -p "$dest.new"
  tar -xzf "$TMP/$name" -C "$dest.new"
  rm -rf "$dest"
  mv "$dest.new" "$dest"
  say "$component installed in $dest"
  PLUGINS="$PLUGINS $component"
}

# The installed plugins as a local Claude Code marketplace (the same one Aphrody-Setup writes), then installed.
register_plugins() {
  [ -n "$PLUGINS" ] || return 0
  root="$PREFIX/share/aphrody/plugins"
  mkdir -p "$root/.claude-plugin"
  {
    printf '{\n  "name": "aphrody-local",\n  "owner": { "name": "aphrody-dev", "email": "contact@aphrody.com" },\n'
    printf '  "description": "Aphrody plugins installed from downloads.aphrody.com",\n  "plugins": ['
    sep=""
    for component in $PLUGINS; do
      printf '%s\n    { "name": "%s", "source": "./%s" }' "$sep" "${component#plugin-}" "$component"
      sep=","
    done
    printf '\n  ]\n}\n'
  } >"$root/.claude-plugin/marketplace.json"
  if ! have claude; then
    say "plugins in $root (Claude Code not found: claude plugin marketplace add $root)"
    return 0
  fi
  claude plugin marketplace add "$root" --scope user >/dev/null || say "  claude refused the marketplace $root"
  for component in $PLUGINS; do
    if claude plugin install "${component#plugin-}@aphrody-local" --scope user >/dev/null; then
      say "  ${component#plugin-} installed in Claude Code"
    else
      say "  claude refused ${component#plugin-}"
    fi
  done
}

# The aphrody MCP server in Claude Code (`aphrody kernel mcp` over stdio, as the plugin and Aphrody-Setup declare it).
install_mcp() {
  bin="${APHRODY_BIN:-$(command -v aphrody || true)}"
  [ -n "$bin" ] || { skip "aphrody is not installed: no MCP server to declare"; return 0; }
  have claude || { skip "Claude Code is not installed: claude mcp add --scope user aphrody -- $bin kernel mcp"; return 0; }
  claude mcp remove aphrody --scope user >/dev/null 2>&1 || true
  claude mcp add --scope user aphrody -- "$bin" kernel mcp >/dev/null || die "claude mcp add failed"
  say "aphrody MCP server declared in Claude Code"
}

PLUGINS=""
APHRODY_BIN=""
for component in $COMPONENTS; do
  say "Installing $component ($TARGET)"
  case "$component" in
    aphrody) install_aphrody ;;
    yolo) install_yolo ;;
    plugin-aphrody | plugin-yolo | plugin-shenron) install_plugin "$component" ;;
    mcp) install_mcp ;;
    *) die "unknown component: $component" ;;
  esac
done
register_plugins
