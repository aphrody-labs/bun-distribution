#!/usr/bin/env bash
# MAJ en place de l'install IEVR depuis Steam (depot 2799861), via aphrody-nie-steam.
#
# Sépare l'auth courte du téléchargement relançable. Le refresh token reste dans
# le magasin NIE protégé; la longue synchronisation tourne dans une session tmux.
set -euo pipefail
umask 077

REPO="${NIE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BIN="$REPO/target/release/aphrody-nie-steam"
ENV_FILE="${NIE_STEAM_ENV_FILE:-$HOME/.config/nie/steam.env}"
if [[ -f "$ENV_FILE" ]]; then
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(STEAM_PASSWORD|STEAM_GUARD_CODE)[[:space:]]*=' "$ENV_FILE"; then
    echo "erreur: ne stockez pas de mot de passe ni de code Guard dans $ENV_FILE" >&2
    exit 1
  fi
  [[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || {
    echo "erreur: $ENV_FILE doit rester en mode 0600" >&2
    exit 1
  }
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

DEST="${IEVR_GAME_DIR:-${NIE_GAME_DIR:-$HOME/.local/share/Steam/iecode/inazuma}}"
APPID="${NIE_STEAM_APP_ID:-2799860}"
DEPOT="${NIE_STEAM_DEPOT:-2799861}"
TOKEN_STORE="${NIE_STEAM_TOKEN_STORE:-${STEAM_TOKEN_STORE:-$HOME/.local/share/nie/steam-tokens.json}}"
MAX_DOWNLOADS="${NIE_STEAM_MAX_DOWNLOADS:-16}"
SESSION="${NIE_STEAM_TMUX_SESSION:-ievr-download}"
LOG="${STEAM_UPDATE_LOG:-$HOME/steam-update-$(date +%Y%m%d-%H%M%S).log}"

[[ -x "$BIN" ]] || { echo "erreur: $BIN absent (cargo build --release -p aphrody-nie-steam)"; exit 1; }
[[ -d "$DEST" ]] || { echo "erreur: dossier install $DEST absent"; exit 1; }
[[ "$APPID" == "2799860" && "$DEPOT" == "2799861" ]] || {
  echo "erreur: ce script est réservé à l'app IEVR 2799860 et au depot 2799861" >&2
  exit 1
}
[[ "$MAX_DOWNLOADS" =~ ^[1-9][0-9]*$ ]] && (( MAX_DOWNLOADS <= 128 )) || {
  echo "erreur: NIE_STEAM_MAX_DOWNLOADS doit être compris entre 1 et 128" >&2
  exit 1
}
command -v tmux >/dev/null || { echo "erreur: tmux est requis" >&2; exit 1; }

# Steam indique 75 GB d'espace libre. Refuser avant l'authentification ou toute
# écriture si le système de fichiers cible ne peut pas contenir l'installation.
REQUIRED_FREE_BYTES=75000000000
FREE_BYTES="$(df -B1 --output=avail -- "$DEST" | awk 'NR == 2 { print $1 }')"
[[ "$FREE_BYTES" =~ ^[0-9]+$ ]] || { echo "erreur: espace libre illisible pour $DEST" >&2; exit 1; }
if (( FREE_BYTES < REQUIRED_FREE_BYTES )); then
  printf 'erreur: %s dispose de %s octets libres; IEVR exige au moins %s.\n' \
    "$DEST" "$FREE_BYTES" "$REQUIRED_FREE_BYTES" >&2
  exit 1
fi
: "${STEAM_USER:?definissez STEAM_USER dans la session protegee}"

TOKEN_DIR="$(dirname "$TOKEN_STORE")"
install -d -m 0700 "$TOKEN_DIR"
chmod 0700 "$TOKEN_DIR"
TMUX_SOCKET="$TOKEN_DIR/steam-update.sock"
if [[ -e "$TMUX_SOCKET" && ! -S "$TMUX_SOCKET" ]]; then
  echo "erreur: le chemin du socket tmux existe mais n'est pas un socket" >&2
  exit 1
fi
if [[ -e "$TOKEN_STORE" && "$(stat -c '%a' "$TOKEN_STORE")" != "600" ]]; then
  echo "erreur: le magasin NIE $TOKEN_STORE doit rester en mode 0600" >&2
  exit 1
fi
if [[ -S "$TMUX_SOCKET" ]] && tmux -S "$TMUX_SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  echo "erreur: la session tmux $SESSION existe déjà; inspectez-la avant de relancer" >&2
  exit 1
fi

echo "== 1/2 auth =="
# La commande lit STEAM_PASSWORD / STEAM_GUARD_CODE dans l'environnement, jamais
# dans argv. Elle crée le refresh token uniquement dans TOKEN_STORE.
if "$BIN" --token-store "$TOKEN_STORE" -u "$STEAM_USER" --depot "$DEPOT" list "$APPID"; then
  echo "auth ok — token mis en cache"
else
  echo "erreur: auth/list a échoué (identifiants ? Guard expiré ? accès depot ?)"
  exit 1
fi

echo "== 2/2 sync persistante dans tmux =="
# Ne transmet aucun secret d'auth au serveur tmux ou au processus de transfert.
unset STEAM_PASSWORD STEAM_GUARD_CODE
tmux -S "$TMUX_SOCKET" set-environment -g -u STEAM_PASSWORD 2>/dev/null || true
tmux -S "$TMUX_SOCKET" set-environment -g -u STEAM_GUARD_CODE 2>/dev/null || true
printf -v sync_command '%q ' "$BIN" --token-store "$TOKEN_STORE" -u "$STEAM_USER" \
  --depot "$DEPOT" sync -o "$DEST" --max-downloads "$MAX_DOWNLOADS"
printf -v log_quoted '%q' "$LOG"
printf -v run_command '%q ' bash -lc "exec ${sync_command}>${log_quoted} 2>&1"
tmux -S "$TMUX_SOCKET" new-session -d -s "$SESSION" "$run_command"
printf 'session=%s log=%s max_downloads=%s\n' "$SESSION" "$LOG" "$MAX_DOWNLOADS"
printf 'surveille: tmux -S %q attach -t %q | tail -f %q | df -h %q\n' \
  "$TMUX_SOCKET" "$SESSION" "$LOG" "$DEST"
