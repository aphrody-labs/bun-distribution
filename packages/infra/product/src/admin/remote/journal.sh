# Shows the end of a job's log. Read-only.
# usage: sh -s -- <id or -> <lines> <follow 0|1>
id=$1
lines=$2
follow=$3
if [ "$id" = "-" ]; then
  [ -d "$root" ] || { echo "ERR|20|aucun entraînement lancé avec ce kit"; exit 20; }
  # job ids are validated ([a-z0-9-]) when created
  # shellcheck disable=SC2012
  id=$(ls -1 "$root" 2>/dev/null | tail -n 1)
fi
dir="$root/$id"
[ -d "$dir" ] || { echo "ERR|20|entraînement inconnu : $id"; exit 20; }
[ -f "$dir/run.log" ] || { echo "ERR|21|pas encore de journal pour $id"; exit 21; }
echo "JOURNAL|$id"
if [ "$follow" = "1" ]; then
  exec tail -n "$lines" -f "$dir/run.log"
fi
tail -n "$lines" "$dir/run.log"
