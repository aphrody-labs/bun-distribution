#!/usr/bin/env bash
# db.sh — helper terminal pour la base Dragon Ball dragonballfr.com (API publique,
# lecture seule). Enveloppe curl + jq pour les usages courants. Aucune auth.
#
#   bash db.sh ask "comment Goku devient super saiyan"
#   bash db.sh char "Vegeta"
#   bash db.sh list sagas
#   bash db.sh get characters 1
#
# Env : DB_API (base, défaut https://bot.dragonballfr.com), DB_LIMIT (nb résultats).
set -euo pipefail

API="${DB_API:-https://bot.dragonballfr.com}"
LIMIT="${DB_LIMIT:-5}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "outil requis manquant : $1" >&2; exit 1; }; }
need curl; need jq

api() { curl -fsS -m 25 "$API$1"; }
urlenc() { jq -rn --arg s "$*" '$s|@uri'; }

cmd="${1:-help}"; shift || true

case "$cmd" in
  ask)
    [ "$#" -gt 0 ] || { echo "usage: db.sh ask <question>" >&2; exit 2; }
    api "/api/public/rag/search?q=$(urlenc "$@")&limit=$LIMIT" | jq -r '
      "mode de récupération : \(.mode)\n",
      (.results[] | "• [\(.kind)] \(.title)\n  \(.url)\n  \((.snippet // "") | gsub("\\s+"; " ") | .[0:220])\n")'
    ;;
  search)
    [ "$#" -gt 0 ] || { echo "usage: db.sh search <termes>" >&2; exit 2; }
    api "/api/public/wiki/search?q=$(urlenc "$@")&limit=$((LIMIT > 5 ? LIMIT : 15))" | jq
    ;;
  char)
    [ "$#" -gt 0 ] || { echo "usage: db.sh char <nom>" >&2; exit 2; }
    # wiki/search renvoie un objet catégorisé {q, characters, planets, sagas, …}.
    # On met en avant les personnages ; sinon on montre tout le résultat.
    api "/api/public/wiki/search?q=$(urlenc "$@")&limit=10" \
      | jq 'if (.characters | length) > 0 then { q, characters } else . end'
    ;;
  list)
    cat="${1:-}"; [ -n "$cat" ] || { echo "usage: db.sh list <catégorie> [limit]" >&2; exit 2; }
    api "/api/public/wiki/$cat?limit=${2:-50}" | jq
    ;;
  get)
    cat="${1:-}"; id="${2:-}"
    [ -n "$cat" ] && [ -n "$id" ] || { echo "usage: db.sh get <catégorie> <id|slug>" >&2; exit 2; }
    api "/api/public/wiki/$cat/$(urlenc "$id")" | jq
    ;;
  stats)    api "/api/public/stats" | jq ;;
  personas) api "/api/public/personas" | jq ;;
  raw)
    [ -n "${1:-}" ] || { echo "usage: db.sh raw <chemin> (ex: /api/public/news)" >&2; exit 2; }
    api "$1" | jq
    ;;
  *)
    cat <<EOF
db.sh — base Dragon Ball (API : $API)

  ask <question>       recherche RAG hybride (réponses sourcées, langage naturel)
  search <termes>      recherche plein-texte du wiki
  char <nom>           cherche un personnage / entité par nom
  list <cat> [limit]   liste une catégorie
  get <cat> <id|slug>  ouvre une fiche
  stats | personas     stats du serveur Discord / les 6 personas du bot
  raw <chemin>         GET brut (ex: db.sh raw /api/public/news)

Catégories : characters, planets, races, techniques, transformations,
             sagas, episodes, movies, games
Env : DB_API (base), DB_LIMIT (nb de résultats).
EOF
    ;;
esac
