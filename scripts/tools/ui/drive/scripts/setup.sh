#!/usr/bin/env bash

set -euo pipefail

if [ "${CI:-}" = "true" ]; then
  set -x
fi

err() {
  for _line in "$@"; do
    echo "$_line" >&2
  done
  exit 1
}

has() {
  for prog in "$@"; do
    if ! command -v "$prog" 1>/dev/null 2>&1; then
      return 1
    fi
  done
}

sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    env sudo "$@"
  fi
}

script_failure() {
  if [ -n "${1:-}" ]; then
    _line="on line $1"
  else
    _line="(unknown)"
  fi
  err "An error occurred $_line." "Setup failed."
}

trap 'script_failure ${LINENO:-}' ERR

case "${OSTYPE:-}" in
  'msys' | 'mingw' | 'cygwin')
    err 'Bash for windows is not supported, please interact with this repo from Powershell or CMD'
    ;;
esac

if [ "${CI:-}" != "true" ]; then
  echo 'Spacedrive Development Environment Setup'
  echo 'To set up your machine for Spacedrive development, this script will install some required dependencies with your system package manager'
  echo
  echo 'Press Enter to continue'
  read -r

  if ! has bun; then
    err 'bun was not found.' \
      "Ensure the 'bun' command is in your \$PATH." \
      'You must use bun for this project; yarn, npm, and pnpm are not allowed.' \
      'https://bun.sh/docs/installation'
  fi

  if ! has rustc cargo; then
    err 'Rust was not found.' \
      "Ensure the 'rustc' and 'cargo' binaries are in your \$PATH." \
      'https://rustup.rs'
  fi

  echo
fi

# Install system deps
case "$(uname)" in
  "Darwin")
    if [ "$(uname -m)" = 'x86_64' ] && ! [ "${CI:-}" = "true" ]; then
      brew install nasm cmake
    elif ! [ "${CI:-}" = "true" ]; then
      brew install cmake
    fi

    ;;
  "Linux")
    # https://github.com/tauri-apps/tauri-docs/blob/dev/docs/guides/getting-started/prerequisites.md#setting-up-linux
    if has apt-get; then
      echo "Detected apt!"
      echo "Installing dependencies with apt..."

      # Tauri dependencies
      # (one desktop runtime: CEF + tauri-winit + GTK 4; no WebKitGTK, no GTK 3)
      set -- build-essential curl wget file openssl libssl-dev libgtk-4-dev librsvg2-dev \
        libxdo-dev libdbus-1-dev libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libgbm1 libxkbcommon-dev libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 \
        libcairo2 libasound2-dev xdg-desktop-portal

      # C/C++ build dependencies, required to build some *-sys crates
      set -- "$@" llvm-dev libclang-dev clang nasm perl cmake

      # React dependencies
      set -- "$@" libvips42

      sudo apt-get -y update
      sudo apt-get -y install "$@"
    elif has pacman; then
      echo "Detected pacman!"
      echo "Installing dependencies with pacman..."

      # Tauri dependencies
      set -- base-devel curl wget file openssl gtk4 librsvg nss nspr at-spi2-core cups libdrm mesa \
        libxkbcommon libxcomposite libxdamage libxfixes libxrandr pango cairo alsa-lib xdotool dbus \
        xdg-desktop-portal

      # C/C++ build dependencies, required to build some *-sys crates
      set -- "$@" clang nasm perl cmake

      # React dependencies
      set -- "$@" libvips

      sudo pacman -Sy --needed "$@"
    elif has dnf; then
      echo "Detected dnf!"
      echo "Installing dependencies with dnf..."

      # For Enterprise Linux, you also need "Development Tools" instead of "C Development Tools and Libraries"
      if ! { sudo dnf group install "C Development Tools and Libraries" || sudo dnf group install "Development Tools"; }; then
        err 'We were unable to install the "C Development Tools and Libraries"/"Development Tools" package.' \
          'Please open an issue if you feel that this is incorrect.' \
          'https://github.com/spacedriveapp/spacedrive/issues'
      fi

      # Tauri dependencies
      set -- openssl gtk4-devel openssl-devel curl wget file librsvg2-devel libxdo-devel dbus-devel \
        nss nspr atk at-spi2-atk cups-libs libdrm mesa-libgbm libxkbcommon libXcomposite libXdamage \
        libXfixes libXrandr pango cairo alsa-lib xdg-desktop-portal

      # C/C++ build dependencies, required to build some *-sys crates
      set -- "$@" clang clang-devel nasm perl-core cmake

      # React dependencies
      set -- "$@" vips

      sudo dnf install "$@"
    elif has apk; then
      echo "Detected apk!"
      echo "Installing dependencies with apk..."
      echo "Alpine suport is experimental" >&2

      # Tauri dependencies
      set -- build-base curl wget file openssl-dev gtk4.0-dev librsvg-dev \
        nss nspr xdotool-dev dbus-dev xdg-desktop-portal

      # C/C++ build dependencies, required to build some *-sys crates
      set -- "$@" llvm16-dev clang16 nasm perl cmake

      # React dependencies
      set -- "$@" vips

      sudo apk add "$@"
    elif has eopkg; then
      echo "Detected eopkg!"
      echo "Installing dependencies with eopkg..."
      echo "Solus support is experimental" >&2

      # Tauri dependencies
      set -- curl wget file openssl openssl-devel libgtk-4-devel librsvg-devel \
        nss nspr xdotool-devel dbus-devel xdg-desktop-portal

      # C/C++ build dependencies, required to build some *-sys crates
      set -- "$@" llvm-devel llvm-clang-devel llvm-clang nasm perl cmake

      # React dependencies
      set -- "$@" libvips

      sudo eopkg it -c system.devel -y
      sudo eopkg it "$@" -y
    else
      if has lsb_release; then
        _distro="'$(lsb_release -s -d)' "
      fi
      err "Your Linux distro ${_distro:-}is not supported by this script." \
        'We would welcome a PR or some help adding your OS to this script:' \
        'https://github.com/spacedriveapp/spacedrive/issues'
    fi
    ;;
  *)
    err "Your OS ($(uname)) is not supported by this script." \
      'We would welcome a PR or some help adding your OS to this script.' \
      'https://github.com/spacedriveapp/spacedrive/issues'
    ;;
esac

if [ "${CI:-}" != "true" ]; then
  echo "Installing Rust tools..."

  _tools="cargo-watch"
  echo "$_tools" | xargs cargo install
fi

echo 'Your machine has been setup for Spacedrive development!'
