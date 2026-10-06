# Shared by every remote script (prepended by src/lib/remote.ts). POSIX sh only.
root="$HOME/.aphrody/omar-train"
# alive <job dir>: the job's wrapper process is running (its command line carries the "omar-train" marker,
# so a recycled pid of another program is never mistaken for it).
alive() {
  [ -f "$1/pid" ] || return 1
  p=$(cat "$1/pid" 2>/dev/null) || return 1
  [ -n "$p" ] || return 1
  ps -p "$p" -o args= 2>/dev/null | grep -q omar-train
}
# expand_home <path>: leading ~/ becomes $HOME/ (the path itself arrives quoted, so the shell never expands it).
expand_home() {
  # matching the literal "~/" prefix on purpose
  # shellcheck disable=SC2088
  case "$1" in
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}
