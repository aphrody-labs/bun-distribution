# Read-only probe of one host: what the doctor needs in a single round trip.
# usage: sh -s -- <aphrody binary> <repository directory>
bin=$1
repo=$(expand_home "$2")
echo "user|$(id -un 2>/dev/null)"
echo "cpu|$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"
echo "load|$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)"
echo "mem|$(awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{print t "|" a}' /proc/meminfo 2>/dev/null)"
echo "disk|$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4 "|" $2}')"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null |
    while IFS= read -r line; do echo "gpu|$line"; done
else
  echo "gpu|aucun"
fi
if command -v "$bin" >/dev/null 2>&1 || [ -x "$bin" ]; then
  echo "aphrody|$("$bin" --version 2>&1 | head -n 1)"
  if [ -d "$repo" ]; then
    echo "repo|oui"
    if command -v timeout >/dev/null 2>&1; then
      echo "train|$(cd "$repo" && timeout 30 "$bin" train status 2>&1 | tr '\n' ' ')"
    else
      echo "train|$(cd "$repo" && "$bin" train status 2>&1 | tr '\n' ' ')"
    fi
  else
    echo "repo|non"
  fi
else
  echo "aphrody|absent"
fi
running=0
if [ -d "$root" ]; then
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    if [ ! -f "$d/exit" ] && alive "$d"; then running=$((running + 1)); fi
  done
fi
echo "jobs|$running"
