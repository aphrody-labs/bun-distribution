#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Host-side bare mirrors of every submodule of aphrody-dev/bun-os (nested ones included), so Gitea Actions
# checkouts clone them from local disk instead of the network.
#
# Mirrors live under $ROOT/<host>/<path>.git. The runner mounts $ROOT read-only into job containers at the
# same path and points GIT_CONFIG_SYSTEM at $ROOT/jobs.gitconfig, which this script regenerates with one
# `url."file://<mirror>".insteadOf <url>` rule per mirrored URL. A URL without a mirror keeps its network URL.
# Complete mirrors are also borrowed as alternates (see write_reference), so their clones copy nothing;
# depth-1 mirrors are served through upload-pack.
# Entries marked `shallow = true` (and nested submodules) get depth-1 mirrors of their default branch and
# pinned commits; the others get complete mirrors of their branches and tags.
#
# The host GitHub credential (gh CLI) is used by this refresh process only, through a command-line
# credential helper. It is never written to the mirrors or to jobs.gitconfig, nor passed to job containers.
#
# Usage: git-mirrors.sh [sync]                 refresh every mirror, add mirrors for new submodule URLs
#        git-mirrors.sh one <mode> <url> <shas>  (internal: one mirror, run in parallel by sync)
set -euo pipefail

ROOT=${APHRODY_GIT_MIRRORS:-$HOME/build/git-mirrors}
SOURCE=${APHRODY_GIT_MIRRORS_SOURCE:-$HOME/apps/gitea/data/git/repositories/aphrody-dev/bun-os.git}
SOURCE_REF=${APHRODY_GIT_MIRRORS_REF:-refs/heads/os}
SOURCE_URL=${APHRODY_GIT_MIRRORS_SOURCE_URL:-https://github.com/aphrody-dev/bun-os.git}
# .git/modules directories of existing clones that seed new mirrors (reflink copy, then fetch the difference).
SEED_GLOBS=${APHRODY_GIT_MIRRORS_SEEDS:-"$HOME/src/bun-os/.git/modules $HOME/build/gitea-work/*/*/*/.git/modules"}
JOBS=${APHRODY_GIT_MIRRORS_JOBS:-8}
NESTING=${APHRODY_GIT_MIRRORS_NESTING:-3}
MIN_FREE_GB=${APHRODY_GIT_MIRRORS_MIN_FREE_GB:-20}
MAINTAIN_HOURS=${APHRODY_GIT_MIRRORS_MAINTAIN_HOURS:-12}
JOB_CONFIG=${APHRODY_GIT_MIRRORS_JOB_CONFIG:-$ROOT/jobs.gitconfig}
GH=${APHRODY_GH:-$(command -v gh || echo "$HOME/.local/bin/gh")}

export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false
# Ignore the account's global and system Git configuration: no insteadOf rule or helper leaks in.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

g() {
  git -c credential.helper= -c "credential.https://github.com.helper=!$GH auth git-credential" \
    -c safe.directory='*' -c gc.auto=0 -c maintenance.auto=false "$@"
}

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

mirror_dir() {
  local u=$1
  u=${u#https://}; u=${u#http://}
  u=${u%/}; u=${u%.git}
  printf '%s/%s.git\n' "$ROOT" "$u"
}

# Resolve a relative submodule URL against the URL of the repository that declares it.
resolve_url() {
  local base=${1%/} rel=$2
  case $rel in ../*|./*) ;; *) printf '%s\n' "$rel"; return ;; esac
  base=${base%.git}
  while :; do
    case $rel in
      ../*) rel=${rel#../}; base=${base%/*} ;;
      ./*) rel=${rel#./} ;;
      *) break ;;
    esac
  done
  printf '%s/%s\n' "$base" "$rel"
}

# Print "<mode> <url> <sha>" for every submodule declared by <rev> of <gitdir>.
submodules_of() {
  local gitdir=$1 rev=$2 base=$3 nested=$4 blob key name path url mode
  blob=$rev:.gitmodules
  g --git-dir="$gitdir" cat-file -e "$blob" 2>/dev/null || return 0
  local -A shas=()
  local type_ obj_ kind_ path_
  while read -r type_ kind_ obj_ path_; do
    [[ $type_ == 160000 ]] && shas[$path_]=$obj_
  done < <(g --git-dir="$gitdir" ls-tree -r "$rev")
  while read -r key path; do
    name=${key#submodule.}; name=${name%.path}
    url=$(g --git-dir="$gitdir" config --blob "$blob" --get "submodule.$name.url" || true)
    [[ -n $url ]] || continue
    url=$(resolve_url "$base" "$url")
    case $url in https://*|http://*) ;; *) continue ;; esac
    mode=full
    if [[ $nested == 1 || $(g --git-dir="$gitdir" config --blob "$blob" --type=bool --get "submodule.$name.shallow" 2>/dev/null || true) == true ]]; then
      mode=shallow
    fi
    printf '%s %s %s\n' "$mode" "$url" "${shas[$path]:--}"
  done < <(g --git-dir="$gitdir" config --blob "$blob" --get-regexp '^submodule\..*\.path$' || true)
}

build_seed_index() {
  local out=$ROOT/.seed-index.tmp root cfg d u
  : > "$out"
  # shellcheck disable=SC2086
  for root in $SEED_GLOBS; do
    [[ -d $root ]] || continue
    while IFS= read -r cfg; do
      d=${cfg%/config}
      # A complete clone has checked out its index; this skips clones still being written by a running job.
      [[ -f $d/HEAD && -f $d/index && -d $d/objects && ! -f $d/objects/info/alternates ]] || continue
      [[ -n $(git config --file "$cfg" --get extensions.partialclone 2>/dev/null) ]] && continue
      u=$(git config --file "$cfg" --get remote.origin.url 2>/dev/null || true)
      [[ -z $u ]] || printf '%s %s\n' "$(mirror_dir "$u")" "$d" >> "$out"
    done < <(find "$root" -maxdepth 10 \( -name objects -o -name refs -o -name logs -o -name hooks \) -prune \
      -o -name config -type f -print 2>/dev/null)
  done
  sort -u "$out" > "$ROOT/.seed-index"
  rm -f "$out"
}

# Print the git dir of a local clone of <url>: shallow ones first for shallow mirrors, complete ones first
# for full mirrors.
find_seed() {
  local url=$1 mode=$2 want best= d key
  want=$(mirror_dir "$url")
  [[ -f $ROOT/.seed-index ]] || return 0
  while read -r key d; do
    [[ $key == "$want" ]] || continue
    if [[ $mode == shallow && -f $d/shallow ]] || [[ $mode == full && ! -f $d/shallow ]]; then
      printf '%s\n' "$d"; return 0
    fi
    [[ -n $best ]] || best=$d
  done < "$ROOT/.seed-index"
  [[ -n $best ]] && printf '%s\n' "$best"
  return 0
}

create_mirror() {
  local mode=$1 url=$2 dir=$3 tmp head seed free h
  free=$(df --output=avail -k "$ROOT" | tail -1)
  if ((free < MIN_FREE_GB * 1024 * 1024)); then
    log "skip new mirror $url: less than ${MIN_FREE_GB} GB free"; return 1
  fi
  tmp=$dir.tmp.$$
  rm -rf "$tmp"; mkdir -p "${dir%/*}"
  g init -q --bare "$tmp"
  g --git-dir="$tmp" config remote.origin.url "$url"
  if [[ $mode == full ]]; then
    g --git-dir="$tmp" config --add remote.origin.fetch '+refs/heads/*:refs/heads/*'
    g --git-dir="$tmp" config --add remote.origin.fetch '+refs/tags/*:refs/tags/*'
  fi
  g --git-dir="$tmp" config aphrody.mirrorMode "$mode"
  g --git-dir="$tmp" config gc.auto 0
  g --git-dir="$tmp" config uploadpack.allowAnySHA1InWant true
  g --git-dir="$tmp" config uploadpack.allowFilter true
  head=$(g ls-remote --symref "$url" HEAD 2>/dev/null | awk '$1 == "ref:" { print $2; exit }' || true)
  [[ -n $head ]] && g --git-dir="$tmp" symbolic-ref HEAD "$head"
  seed=$(find_seed "$url" "$mode")
  if [[ -n $seed ]]; then
    log "seed $url <- $seed"
    if cp -r --reflink=auto "$seed/objects/." "$tmp/objects/" \
      && { [[ ! -f $seed/shallow ]] || cp "$seed/shallow" "$tmp/shallow"; }; then
      rm -f "$tmp/objects/info/alternates"
      # The seed's refs only serve as negotiation haves for the first fetch (removed in sync_one).
      {
        git --git-dir="$seed" -c safe.directory='*' for-each-ref --format='%(objectname) %(refname)' 2>/dev/null \
          | awk '$2 !~ /^refs\/stash/ { sub(/^refs\//, "", $2); print "update refs/seed/" $2 " " $1 }'
        h=$(git --git-dir="$seed" -c safe.directory='*' rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null || true)
        [[ -z $h ]] || echo "update refs/seed/HEAD $h"
      } | g --git-dir="$tmp" update-ref --stdin 2>/dev/null || log "seed refs rejected for $url"
    else
      log "seed copy failed for $url, fetching everything"
      rm -rf "$tmp/objects" "$tmp/shallow"; mkdir -p "$tmp/objects/pack" "$tmp/objects/info"
    fi
  fi
  mv "$tmp" "$dir"
}

maintain() {
  local dir=$1 mode=$2 stamp=$1/aphrody-maintained
  if [[ -f $stamp && -z $(find "$stamp" -mmin +$((MAINTAIN_HOURS * 60)) 2>/dev/null) ]]; then return 0; fi
  if [[ $mode == full && ! -f $dir/shallow ]]; then
    g --git-dir="$dir" repack -d -q --geometric=2 --write-midx --write-bitmap-index 2>/dev/null \
      || g --git-dir="$dir" repack -d -q --geometric=2 || true
  else
    g --git-dir="$dir" repack -d -q --geometric=2 || true
  fi
  g --git-dir="$dir" prune-packed 2>/dev/null || true
  touch "$stamp"
}

# Create or refresh one mirror. <shas> is a comma separated list of commits that must stay available.
sync_one() {
  local mode=$1 url=$2 shas=$3 dir head sha
  local -a list=() missing=() extra=()
  dir=$(mirror_dir "$url")
  # URL spellings with and without .git share one mirror: serialize them.
  mkdir -p "$ROOT/.locks"
  exec 8> "$ROOT/.locks/$(printf '%s' "$dir" | md5sum | cut -c1-16)"
  flock 8
  [[ -d $dir ]] || create_mirror "$mode" "$url" "$dir" || return 1
  if [[ $mode == full && $(g --git-dir="$dir" config aphrody.mirrorMode) == shallow ]]; then
    g --git-dir="$dir" config aphrody.mirrorMode full
    g --git-dir="$dir" config --replace-all remote.origin.fetch '+refs/heads/*:refs/heads/*'
    g --git-dir="$dir" config --add remote.origin.fetch '+refs/tags/*:refs/tags/*'
  fi
  mode=$(g --git-dir="$dir" config aphrody.mirrorMode || echo "$mode")
  if [[ $mode == full ]]; then
    [[ -f $dir/shallow ]] && extra=(--unshallow)
    g --git-dir="$dir" fetch -q --prune --no-tags "${extra[@]}" origin || { log "fetch failed: $url"; return 1; }
  fi
  IFS=, read -ra list <<< "$shas"
  if [[ $mode == shallow && ( $shas == - || -z $shas ) ]]; then
    head=$(g --git-dir="$dir" config aphrody.upstreamHead || g --git-dir="$dir" symbolic-ref -q HEAD || true)
    [[ -z $head ]] || g --git-dir="$dir" fetch -q --no-tags --depth=1 origin "+$head:$head" || log "head fetch failed: $url"
  fi
  for sha in "${list[@]}"; do
    [[ $sha == - || -z $sha ]] && continue
    g --git-dir="$dir" cat-file -e "$sha^{commit}" 2>/dev/null || missing+=("$sha")
  done
  if ((${#missing[@]})); then
    extra=()
    [[ $mode == shallow || -f $dir/shallow ]] && extra=(--depth=1)
    g --git-dir="$dir" fetch -q --no-tags "${extra[@]}" origin "${missing[@]}" || log "pinned fetch failed: $url ${missing[*]}"
  fi
  for sha in "${list[@]}"; do
    [[ $sha == - || -z $sha ]] && continue
    if g --git-dir="$dir" cat-file -e "$sha^{commit}" 2>/dev/null; then g --git-dir="$dir" update-ref "refs/pinned/$sha" "$sha"; fi
  done
  # A depth-1 mirror serves its newest pinned commit as HEAD: `git clone --depth=1` of a `shallow = true`
  # submodule then receives exactly that commit, and the follow-up `git fetch origin <sha>` (which asks for
  # the full history below it) never runs.
  if [[ $mode == shallow && -n ${list[0]:-} && ${list[0]} != - ]] \
    && g --git-dir="$dir" cat-file -e "${list[0]}^{commit}" 2>/dev/null; then
    head=$(g --git-dir="$dir" symbolic-ref -q HEAD || true)
    if [[ -n $head && $head != refs/heads/aphrody-pinned && -z $(g --git-dir="$dir" config aphrody.upstreamHead || true) ]]; then
      g --git-dir="$dir" config aphrody.upstreamHead "$head"
    fi
    g --git-dir="$dir" update-ref refs/heads/aphrody-pinned "${list[0]}"
    g --git-dir="$dir" symbolic-ref HEAD refs/heads/aphrody-pinned
  fi
  g --git-dir="$dir" for-each-ref --format='delete %(refname)' refs/seed | g --git-dir="$dir" update-ref --stdin
  maintain "$dir" "$mode"
}

# The reference superproject: every repository Git initializes in a job gets $ROOT/.reference/objects as an
# (empty) alternate through init.templateDir, so `submodule.alternateLocation = superproject` makes each
# submodule clone borrow the objects of $ROOT/.reference/modules/<name>, a link to its complete mirror. The
# clone then transfers nothing and copies nothing; its objects stay in the read-only mirror.
write_reference() {
  local names=$1 ref=$ROOT/.reference stamp new name url dir
  [[ -d $ref/objects ]] || g init -q --bare "$ref"
  mkdir -p "$ROOT/.template/objects/info"
  printf '%s/objects\n' "$ref" > "$ROOT/.template/objects/info/alternates"
  stamp=$(date -u +%Y%m%d%H%M%S)
  new=$ROOT/.reference-modules.$stamp
  mkdir -p "$new"
  while read -r name url; do
    dir=$(mirror_dir "$url")
    [[ -d $dir && ! -f $dir/shallow && $(g --git-dir="$dir" config aphrody.mirrorMode) == full ]] || continue
    mkdir -p "$new/$(dirname "$name")"
    ln -sfn "$dir" "$new/$name"
  done < "$names"
  ln -sfn "$new" "$ref/modules.tmp"
  mv -T "$ref/modules.tmp" "$ref/modules"
  find "$ROOT" -maxdepth 1 -name '.reference-modules.*' ! -path "$new" -mmin +720 -exec rm -rf {} + 2>/dev/null || true
  chmod -R a+rX "$ROOT/.template" "$new"
}

write_job_config() {
  local list=$1 out=$JOB_CONFIG.tmp url dir
  {
    echo '# Generated by git-mirrors.sh; job containers read it through GIT_CONFIG_SYSTEM.'
    printf '[protocol "file"]\n\tallow = always\n[safe]\n\tdirectory = *\n'
    printf '[init]\n\ttemplateDir = %s/.template\n' "$ROOT"
    printf '[submodule]\n\talternateLocation = superproject\n\talternateErrorStrategy = info\n'
    while read -r _ url _; do
      dir=$(mirror_dir "$url")
      [[ -d $dir && -n $(g --git-dir="$dir" for-each-ref --count=1 refs/pinned refs/heads) ]] || continue
      printf '[url "file://%s"]\n\tinsteadOf = %s\n' "$dir" "$url"
    done < "$list"
  } > "$out"
  chmod 0644 "$out"
  mv "$out" "$JOB_CONFIG"
}

# Merge "<mode> <url> <shas>" lines by URL: full wins over shallow, commits are joined.
merge_entries() {
  awk '{ m[$2] = (m[$2] == "full" || $1 == "full") ? "full" : "shallow"
         n = split($3, a, ","); for (i = 1; i <= n; i++) if (a[i] != "-" && !(($2, a[i]) in seen)) {
           seen[$2, a[i]] = 1; s[$2] = s[$2] ? s[$2] "," a[i] : a[i] } }
       END { for (u in m) print m[u], u, (s[u] ? s[u] : "-") }' "$@" | sort -k2
}

sync_all() {
  mkdir -p "$ROOT"
  exec 9> "$ROOT/.lock"
  flock -n 9 || { log "another refresh is running"; exit 0; }
  local work=$ROOT/.work level=0 rev dir url shas sha
  local -a list=()
  rm -rf "$work"; mkdir -p "$work"
  build_seed_index
  rev=$(git --git-dir="$SOURCE" -c safe.directory='*' rev-parse "$SOURCE_REF")
  submodules_of "$SOURCE" "$rev" "$SOURCE_URL" 0 > "$work/found0"
  git --git-dir="$SOURCE" -c safe.directory='*' config --blob "$rev:.gitmodules" --get-regexp '^submodule\..*\.url$' \
    | sed -E 's/^submodule\.(.*)\.url /\1 /' > "$work/names"
  : > "$work/done"
  while [[ -s $work/found$level && $level -le $NESTING ]]; do
    # Keep only the URL and commit pairs that no shallower level handled already.
    merge_entries "$work/found$level" \
      | awk 'FILENAME == ARGV[1] { n = split($3, a, ","); for (i = 1; i <= n; i++) done[$2, a[i]] = 1; m[$2] = $1; next }
             { n = split($3, a, ","); keep = ""; for (i = 1; i <= n; i++) if (!(($2, a[i]) in done)) keep = keep ? keep "," a[i] : a[i]
               if (!($2 in m) || keep != "" || ($1 == "full" && m[$2] != "full")) print $1, $2, (keep ? keep : "-") }' \
        "$work/done" - > "$work/todo$level"
    cat "$work/todo$level" >> "$work/done"
    log "level $level: $(wc -l < "$work/todo$level") mirrors"
    # shellcheck disable=SC2016
    xargs -P "$JOBS" -L 1 bash -c 'bash "$0" one "$1" "$2" "$3" || true' "$0" < "$work/todo$level"
    level=$((level + 1))
    : > "$work/found$level"
    while read -r _ url shas; do
      dir=$(mirror_dir "$url")
      [[ -d $dir ]] || continue
      IFS=, read -ra list <<< "$shas"
      for sha in "${list[@]}"; do
        [[ $sha == - ]] && continue
        submodules_of "$dir" "$sha" "$url" 1 >> "$work/found$level" || true
      done
    done < "$work/todo$((level - 1))"
  done
  merge_entries "$work/done" > "$work/final"
  write_reference "$work/names"
  write_job_config "$work/final"
  log "mirrors in use: $(grep -c insteadOf "$JOB_CONFIG") of $(wc -l < "$work/final") URLs"
}

case ${1:-sync} in
  sync) sync_all ;;
  one) shift; sync_one "$@" ;;
  *) echo "usage: $0 [sync]" >&2; exit 2 ;;
esac
