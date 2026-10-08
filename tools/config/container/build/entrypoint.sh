#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# aphrody-build entrypoint: shared caches stay writable by every uid of the build group (umask 002
# under setgid volume roots), HOME is a private scratch directory, then the command runs as given.
set -eu
umask 0002
mkdir -p "${HOME:-/tmp/home}"
if [ "$#" -eq 0 ]; then set -- bash; fi
exec "$@"
