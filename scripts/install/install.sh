#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Aphrody one-click installer (Linux, macOS): thin entry point of `aphrody self install`.
#
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh -s -- --host vps
#   curl -fsSL https://downloads.aphrody.com/install.sh | sh -s -- --target wasm
#
# Downloads the latest release (latest.json), verifies its SHA-256 against the release SHA256SUMS, then hands
# over to `aphrody self install` (layout, PATH, links, manifest, boot). Arguments are passed through.
# Environment: APHRODY_DOWNLOAD_URL (default https://downloads.aphrody.com), APHRODY_RELEASE (immutable id),
# APHRODY_COMPONENTS (anything but `aphrody` runs the full installer, install-full.sh: plugins, MCP).
set -eu

BASE="${APHRODY_DOWNLOAD_URL:-https://downloads.aphrody.com}"
BASE=${BASE%/}
say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Linux) os_part=unknown-linux-gnu ;;
  Darwin) os_part=apple-darwin ;;
  *) die "unsupported OS (Windows: irm $BASE/install.ps1 | iex)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch_part=x86_64 ;;
  aarch64 | arm64) arch_part=aarch64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac
TARGET="$arch_part-$os_part"

if have curl; then fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$1" -o "$2"; }
elif have wget; then fetch() { wget -qO "$2" "$1"; }
else die "curl or wget is required"; fi
if have sha256sum; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif have shasum; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi
have tar || die "tar is required"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

RELEASE_ID="${APHRODY_RELEASE:-}"
if [ -z "$RELEASE_ID" ]; then
  fetch "$BASE/latest.json" "$TMP/latest.json" || die "cannot read $BASE/latest.json"
  RELEASE_ID=$(tr '\n' ' ' <"$TMP/latest.json" | sed -n 's/.*"release"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9][A-Za-z0-9._-]*\)".*/\1/p')
fi
case "$RELEASE_ID" in "" | *[!A-Za-z0-9._-]* | . | ..) die "invalid or missing release ID" ;; esac
[ ${#RELEASE_ID} -le 128 ] || die "release ID is too long"
RELEASE_BASE="$BASE/releases/$RELEASE_ID"

# Components other than the binaries (plugins, MCP declaration, desktop): the full installer of the same release.
if [ -n "${APHRODY_COMPONENTS:-}" ] && [ "$APHRODY_COMPONENTS" != aphrody ]; then
  fetch "$BASE/install-full.sh" "$TMP/install-full.sh" || die "cannot read $BASE/install-full.sh"
  APHRODY_RELEASE="$RELEASE_ID" exec sh "$TMP/install-full.sh"
fi

fetch "$RELEASE_BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "cannot read $RELEASE_BASE/SHA256SUMS"
awk 'NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ || $2 !~ /^[A-Za-z0-9][A-Za-z0-9._-]*$/ { exit 1 }' "$TMP/SHA256SUMS" || die "invalid SHA256SUMS"
NAME=$(awk -v t="$TARGET" '$2 ~ /^aphrody-[0-9]/ && $2 ~ ("-" t "[.]tar[.]gz$") { print $2; exit }' "$TMP/SHA256SUMS")
[ -n "$NAME" ] || die "no aphrody build for $TARGET in release $RELEASE_ID"
fetch "$RELEASE_BASE/files/$NAME" "$TMP/$NAME" || die "cannot download $NAME"
WANT=$(awk -v n="$NAME" '$2 == n { print $1 }' "$TMP/SHA256SUMS")
GOT=$(sha256 "$TMP/$NAME")
[ "$WANT" = "$GOT" ] || die "checksum mismatch for $NAME (expected $WANT, got $GOT)"
say "verified $NAME (release $RELEASE_ID)"

tar -tzf "$TMP/$NAME" | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { exit 1 }' || die "unsafe archive path"
mkdir "$TMP/x"
tar -xzf "$TMP/$NAME" -C "$TMP/x"
[ -x "$TMP/x/aphrody" ] || die "the archive has no aphrody executable"
"$TMP/x/aphrody" --version >/dev/null || die "the downloaded aphrody does not run on this host"
APHRODY_DOWNLOAD_URL="$BASE" "$TMP/x/aphrody" self install --bin "$TMP/x/aphrody" "$@"
