# SPDX-License-Identifier: MIT
# Bun OS multicall utilities take precedence over the pacman-owned GNU names in /usr/bin.
case ":${PATH}:" in
  *:/usr/lib/bunos-utils/bin:*) ;;
  *) PATH="/usr/lib/bunos-utils/bin:${PATH}" ;;
esac
export PATH
