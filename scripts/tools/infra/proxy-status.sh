#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Report the VPS SOCKS egress proxy state. Moved from aphrody/scripts/ (host ops
# belong to aphrody-infra). Addresses come from the environment, never from docs:
#   PROXY_LISTEN  local listener advertised to apps   (default 127.0.0.1:1080)
#   PROXY_EXIT    SOCKS5 exit reached through the tunnel (required for the exit probe)
set -uo pipefail
PROXY_LISTEN="${PROXY_LISTEN:-127.0.0.1:1080}"
PROXY_EXIT="${PROXY_EXIT:-}"
echo "========================================="
echo "        STATUT PROXY VPS (IE - US EXIT)"
echo "========================================="
if systemctl is-active --quiet mullvad-socks; then
  echo "• Service mullvad-socks    : ACTIF"
else
  echo "• Service mullvad-socks    : INACTIF"
fi
if systemctl is-active --quiet mullvad-wg-proxy; then
  echo "• Service mullvad-wg-proxy : ACTIF (${PROXY_LISTEN} -> ${PROXY_EXIT:-<PROXY_EXIT unset>})"
else
  echo "• Service mullvad-wg-proxy : INACTIF"
fi
echo "• Variable HTTP_PROXY      : ${HTTP_PROXY:-<non défini>}"
echo "• Fichier /etc/environment :"
grep -E 'PROXY' /etc/environment || echo "  (aucun proxy dans /etc/environment)"

echo -n "• Sortie SOCKS5 (Mullvad)   : "
IP_INFO=$(curl -s --max-time 5 --socks5 "${PROXY_EXIT:-$PROXY_LISTEN}" https://ipinfo.io/json 2>/dev/null || true)
if [ -n "$IP_INFO" ]; then
  IP=$(echo "$IP_INFO" | grep -oP '"ip": "\K[^"]+' || echo "inconnu")
  COUNTRY=$(echo "$IP_INFO" | grep -oP '"country": "\K[^"]+' || echo "inconnu")
  CITY=$(echo "$IP_INFO" | grep -oP '"city": "\K[^"]+' || echo "")
  echo "OK -> IP: $IP ($CITY, $COUNTRY)"
else
  echo "ERREUR ou non joignable"
fi

echo -n "• Test connectivité Google  : "
if curl -I --connect-timeout 4 https://google.com >/dev/null 2>&1; then
  echo "OK (Direct Internet joignable)"
else
  echo "ERREUR"
fi
echo "========================================="
