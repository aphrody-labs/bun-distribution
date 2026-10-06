# Lists the kit's training jobs on this host. Read-only.
echo "HOTE|$(hostname 2>/dev/null)"
[ -d "$root" ] || exit 0
for dir in "$root"/*/; do
  [ -d "$dir" ] || continue
  id=$(basename "$dir")
  type=$(sed -n 's/.*"type":"\([^"]*\)".*/\1/p' "$dir/job.json" 2>/dev/null | head -n 1)
  started=$(sed -n 's/.*"started":"\([^"]*\)".*/\1/p' "$dir/job.json" 2>/dev/null | head -n 1)
  state=interrompu
  if [ -f "$dir/exit" ]; then
    if [ "$(cat "$dir/exit")" = "0" ]; then state=termine; else state=echec; fi
  elif alive "$dir"; then
    state=en-cours
  elif [ -f "$dir/arrete" ]; then
    state=arrete
  fi
  last=""
  if [ -f "$dir/out/events.jsonl" ]; then
    last=$(tail -n 1 "$dir/out/events.jsonl" 2>/dev/null | cut -c1-300)
  elif [ -f "$dir/run.log" ]; then
    last=$(tail -n 1 "$dir/run.log" 2>/dev/null | cut -c1-300)
  fi
  printf 'JOB|%s|%s|%s|%s|%s\n' "$id" "$type" "$state" "$started" "$last" | tr -d '\r'
done
