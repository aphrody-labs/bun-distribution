# Stops ONE job of the kit: polite stop (SIGTERM to its process group), kill only when asked.
# usage: sh -s -- <id> <force 0|1>
id=$1
force=$2
dir="$root/$id"
fail() {
  echo "ERR|$1|$2"
  exit "$1"
}
[ -d "$dir" ] || fail 20 "entraînement inconnu : $id"
alive "$dir" || fail 21 "ce travail n'est pas en cours"
pid=$(cat "$dir/pid")
pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
[ "$pgid" = "$pid" ] || fail 22 "processus inattendu, je ne touche à rien"
: >"$dir/arrete"
if [ "$force" = "1" ]; then kill -s KILL -- "-$pid"; else kill -s TERM -- "-$pid"; fi
n=0
while alive "$dir" && [ "$n" -lt 30 ]; do
  sleep 1
  n=$((n + 1))
done
if alive "$dir"; then echo "STILL|$pid"; else echo "STOPPED|$pid"; fi
