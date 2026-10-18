#!/bin/sh
# Capture an existing authorized X11 desktop; never starts Steam or another desktop.
set -eu
stream_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$stream_dir/../../../../../../.." && pwd)
case "$stream_dir" in *[[:space:]]*) echo 'Sender path must not contain whitespace' >&2; exit 1 ;; esac
: "${GAMESTREAM_DISPLAY:?Set GAMESTREAM_DISPLAY to the existing authorized X display}"
: "${GAMESTREAM_HOST:?Set GAMESTREAM_HOST to the private mesh bind address}"
: "${GAMESTREAM_ICE_ADDRESS:?Set GAMESTREAM_ICE_ADDRESS to the private mesh address}"
export GAMESTREAM_VIDEO_SOURCE=x11
# Desktop audio requires an explicitly selected existing PipeWire sink monitor.
export GAMESTREAM_AUDIO=${GAMESTREAM_AUDIO:-0}
if [ "$GAMESTREAM_AUDIO" = 1 ]; then
  : "${GAMESTREAM_AUDIO_NODE:?Set the existing PipeWire sink node}"
fi
sender_python=${GAMESTREAM_PYTHON:-/usr/bin/python3}
case "$sender_python" in *[[:space:]]*) echo 'Python path must not contain whitespace' >&2; exit 1 ;; esac
"$sender_python" "$stream_dir/sender.py" --check
if [ "${1:-}" = --check ]; then exit 0; fi
[ -w /dev/uinput ] || { echo 'Existing user needs authorized /dev/uinput write access for gamepad input' >&2; exit 1; }
export GAMESTREAM_SENDER="$sender_python $stream_dir/sender.py"
cd "$repo_root"
exec "${BUN_BIN:-bun}" packages/bun-gamestream/src/server.ts
