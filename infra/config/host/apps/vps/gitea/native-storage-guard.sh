#!/bin/sh
set -eu

repository_root=/data/git/repositories/aphrody-labs-native
data_device=$(stat -c '%d' /data)
repository_device=$(stat -c '%d' "$repository_root")
repository_owner=$(stat -c '%u:%g' "$repository_root")

if [ "$data_device" = "$repository_device" ]; then
  echo "Gitea native repository storage mount is absent" >&2
  exit 70
fi

if [ "$repository_owner" != "1000:1000" ]; then
  echo "Gitea native repository storage ownership is invalid" >&2
  exit 71
fi

exec /usr/bin/entrypoint "$@"
