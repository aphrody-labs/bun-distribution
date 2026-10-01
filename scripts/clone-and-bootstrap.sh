#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
destination="${1:-$PWD/aphrody}"
if [[ -e "$destination" ]]; then echo "destination already exists: $destination" >&2; exit 2; fi
git clone https://github.com/aphrody-labs/aphrody.git "$destination"
git clone https://github.com/aphrody-labs/aphrody-py.git "$(dirname "$destination")/aphrody-py"
# IECODE is a pinned twin checkout (config/sibling-checkouts.json), never a published package.
git clone "$(sed -nE 's/.*"repository": *"([^"]+)".*/\1/p' "$destination/config/sibling-checkouts.json" | head -1)" "$(dirname "$destination")/iecode"
bash "$destination/scripts/bootstrap.sh" "${@:2}"
