#!/usr/bin/env bash
set -euo pipefail

TARGET_COUNTRY="${1:-us}"
ENV_FILE="/etc/wireguard/mullvad-relay.env"

echo "[Mullvad-Relay] Recherche d'un relais actif pour : $TARGET_COUNTRY..."

RELAY_INFO=$(python3 - "$TARGET_COUNTRY" << 'PYEOF'
import urllib.request, json, sys

target = sys.argv[1].lower() if len(sys.argv) > 1 else "us"
try:
    req = urllib.request.Request("https://api.mullvad.net/www/relays/all/", headers={"User-Agent": "aphrody-vps/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        relays = json.loads(resp.read().decode())
    
    candidates = [
        r for r in relays
        if r.get("active") and r.get("type") == "wireguard" and (
            r.get("country_code", "").lower() == target or
            r.get("hostname", "").lower().startswith(target)
        )
    ]
    if not candidates:
        sys.exit(1)
    
    chosen = candidates[0]
    print(f"{chosen['hostname']}|{chosen['ipv4_addr_in']}:51820|{chosen['pubkey']}|{chosen['country_name']}|{chosen['city_name']}")
except Exception:
    sys.exit(2)
PYEOF
) || true

if [ -z "$RELAY_INFO" ]; then
    echo "[Mullvad-Relay] Erreur API ou pays introuvable. Utilisation du fallback US (us-atl-wg-001)..."
    HOSTNAME="us-atl-wg-001"
    ENDPOINT="45.134.140.130:51820"
    PUBKEY="nvyBkaEXHwyPBAm8spGB0TFzf2W5wPAl8EEuJ0t+bzs="
    LOCATION="USA, Atlanta"
else
    IFS="|" read -r HOSTNAME ENDPOINT PUBKEY CNAME CITY <<< "$RELAY_INFO"
    LOCATION="$CNAME, $CITY"
fi

echo "[Mullvad-Relay] Basculement vers $HOSTNAME ($LOCATION) @ $ENDPOINT..."

# Sauvegarder la configuration pour mullvad-netns-setup.sh
sudo tee "$ENV_FILE" > /dev/null << ENVEOF
HOSTNAME="$HOSTNAME"
ENDPOINT="$ENDPOINT"
PEER_PUBKEY="$PUBKEY"
LOCATION="$LOCATION"
ENVEOF

# Appliquer au netns si le périphérique existe
if ip netns list | grep -qw mullvad; then
    OLD_PEER=$(sudo ip netns exec mullvad wg show wg-mullvad peers 2>/dev/null | head -n 1 || true)
    if [ -n "$OLD_PEER" ] && [ "$OLD_PEER" != "$PUBKEY" ]; then
        sudo ip netns exec mullvad wg set wg-mullvad peer "$OLD_PEER" remove 2>/dev/null || true
    fi
    sudo ip netns exec mullvad wg set wg-mullvad peer "$PUBKEY" endpoint "$ENDPOINT" allowed-ips 0.0.0.0/0 persistent-keepalive 25
    echo "[Mullvad-Relay] Relay WireGuard mis à jour avec succès dans le netns."
fi

# Vérifier la sortie SOCKS5
echo -n "[Mullvad-Relay] Test de sortie via SOCKS5 (10.200.1.2:1080)... "
IP_INFO=$(curl -s --max-time 6 --socks5 10.200.1.2:1080 https://ipinfo.io/json 2>/dev/null || true)
if [ -n "$IP_INFO" ]; then
    IP=$(echo "$IP_INFO" | grep -oP '"ip": "\K[^"]+' || echo "inconnu")
    COUNTRY=$(echo "$IP_INFO" | grep -oP '"country": "\K[^"]+' || echo "inconnu")
    CITY_RES=$(echo "$IP_INFO" | grep -oP '"city": "\K[^"]+' || echo "")
    echo "OK -> IP: $IP ($CITY_RES, $COUNTRY)"
else
    echo "Note : SOCKS5 en cours d'établissement..."
fi
