# Starts ONE training job detached from the ssh session (survives a closed window).
# usage: sh -s -- <id> <aphrody binary> <repository directory> <domain or -> <type> <kind> [aphrody train run flags...]
# Never overwrites: an existing job directory or a job already running refuses the start.
set -eu
id=$1
bin=$2
repo=$(expand_home "$3")
domain=$4
type=$5
kind=$6
shift 6
# the flags arrive quoted, so a leading ~/ in a value is expanded here, once, for aphrody
i=0
count=$#
while [ "$i" -lt "$count" ]; do
  arg=$(expand_home "$1")
  shift
  set -- "$@" "$arg"
  i=$((i + 1))
done
dir="$root/$id"
fail() {
  echo "ERR|$1|$2"
  exit "$1"
}
[ -d "$repo" ] || fail 10 "le dossier du dépôt est introuvable sur le serveur"
if ! command -v "$bin" >/dev/null 2>&1 && [ ! -x "$bin" ]; then fail 11 "aphrody est introuvable sur le serveur"; fi
command -v setsid >/dev/null 2>&1 || fail 14 "la commande setsid manque sur le serveur"
if [ -d "$root" ]; then
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    if [ ! -f "$d/exit" ] && alive "$d"; then fail 13 "un entraînement est déjà en cours ($(basename "$d"))"; fi
  done
fi
[ ! -e "$dir" ] || fail 12 "ce numéro d'entraînement existe déjà"
umask 077
mkdir -p "$dir"
printf '{"id":"%s","type":"%s","kind":"%s","started":"%s"}\n' "$id" "$type" "$kind" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$dir/job.json"
cd "$repo"
if [ "$domain" != "-" ]; then
  APHRODY_AGENT_DOMAIN=$domain
  export APHRODY_AGENT_DOMAIN
fi
OMAR_DIR=$dir
export OMAR_DIR
# the inner script is expanded by the inner shell, not here
# shellcheck disable=SC2016
setsid sh -c 'echo $$ > "$OMAR_DIR/pid"; "$@" --out-dir "$OMAR_DIR/out" > "$OMAR_DIR/run.log" 2>&1; echo $? > "$OMAR_DIR/exit"' omar-train "$bin" train run "$@" </dev/null >/dev/null 2>&1 &
n=0
while [ ! -s "$dir/pid" ] && [ "$n" -lt 50 ]; do
  sleep 0.1
  n=$((n + 1))
done
[ -s "$dir/pid" ] || fail 15 "le travail ne s'est pas lancé"
echo "OK|$id|$(cat "$dir/pid")"
