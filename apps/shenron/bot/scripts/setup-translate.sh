#!/usr/bin/env bash
# Setup stack de traduction pour la commande /translate.
#
#   - Aphrody AI fournit l'OCR via son API privée.
#   - LibreTranslate (AGPL-3.0) — Docker, bind 127.0.0.1:5000
#
# Idempotent : peut être relancé sans casser l'install existante.
# Usage : sudo bash scripts/setup-translate.sh

set -euo pipefail

LANGS_LT="en,fr,ja,es,de,it"
LT_PORT="${LT_PORT:-5000}"
LT_CONTAINER="${LT_CONTAINER:-libretranslate}"

if [[ $EUID -ne 0 ]]; then
  echo "✗ Lance ce script en root (sudo)." >&2
  exit 1
fi

echo "==> 1/2 Docker (si manquant)"
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker non installé. Installe-le manuellement (https://docs.docker.com/engine/install/ubuntu/) puis relance." >&2
  exit 1
fi

echo
echo "==> 2/2 LibreTranslate (Docker, $LT_CONTAINER, port $LT_PORT)"
if docker ps -a --format '{{.Names}}' | grep -q "^${LT_CONTAINER}$"; then
  echo "→ Container existant, on le redémarre."
  docker start "$LT_CONTAINER" >/dev/null
else
  echo "→ Création du container."
  docker run -d \
    --name "$LT_CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:${LT_PORT}:5000" \
    -e LT_LOAD_ONLY="$LANGS_LT" \
    -e LT_DISABLE_WEB_UI=true \
    libretranslate/libretranslate:latest
fi

echo
echo "→ Attente démarrage LibreTranslate (téléchargement modèles, peut prendre 1-3 min)..."
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${LT_PORT}/languages" >/dev/null 2>&1; then
    echo "✓ LibreTranslate UP sur 127.0.0.1:${LT_PORT}"
    break
  fi
  sleep 2
  [[ $i -eq 90 ]] && { echo "✗ LibreTranslate n'a pas démarré dans les 3 min" >&2; docker logs --tail 30 "$LT_CONTAINER" >&2; exit 1; }
done

echo
echo "✓ Tout est prêt."
echo "Ajoute (ou laisse le défaut) dans le .env du bot :"
echo "    LIBRETRANSLATE_URL=http://127.0.0.1:${LT_PORT}"
echo "L'OCR nécessite APHRODY_SHENRON_API_URL et APHRODY_SHENRON_API_TOKEN dans l'environnement du bot."
