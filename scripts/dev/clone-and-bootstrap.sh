#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
destination="${1:-$PWD/aphrody}"
if [[ -e "$destination" ]]; then echo "destination already exists: $destination" >&2; exit 2; fi
git clone https://github.com/aphrody-labs/aphrody.git "$destination"
bash "$destination/scripts/dev/bootstrap.sh" "${@:2}"
