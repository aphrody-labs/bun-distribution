#!/bin/sh
set -eu

install_dir="$HOME/steamcmd"
if [ ! -x "$install_dir/steamcmd.sh" ]; then
    mkdir -p "$install_dir"
    cp -a /opt/steamcmd/. "$install_dir/"
fi

exec "$install_dir/steamcmd.sh" "$@"
