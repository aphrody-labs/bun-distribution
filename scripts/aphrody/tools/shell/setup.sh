#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Source this file to initialize Bash, or run it to install a profile hook.

_aphrody_shell_file="${BASH_SOURCE[0]}"
_aphrody_shell_file="$(cd -- "$(dirname -- "$_aphrody_shell_file")" && pwd -P)/$(basename -- "$_aphrody_shell_file")"
_aphrody_shell_root="$(cd -- "$(dirname -- "$_aphrody_shell_file")/../../.." && pwd -P)"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  profile="${BASH_PROFILE:-$HOME/.bashrc}"
  mkdir -p "$(dirname -- "$profile")"
  touch "$profile"
  if ! grep -Fq '# >>> aphrody global environment >>>' "$profile"; then
    {
      printf '\n# >>> aphrody global environment >>>\n'
      printf 'source %q\n' "$_aphrody_shell_file"
      printf '# <<< aphrody global environment <<<\n'
    } >> "$profile"
  fi
  login_profile=""
  for candidate in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [[ -f "$candidate" ]]; then login_profile="$candidate"; break; fi
  done
  if [[ -z "$login_profile" ]]; then login_profile="$HOME/.bash_profile"; touch "$login_profile"; fi
  if ! grep -Fq '# >>> aphrody bash login >>>' "$login_profile" && ! grep -Eq '(^|[[:space:]])(source|\.)[[:space:]].*\.bashrc' "$login_profile"; then
    {
      printf '\n# >>> aphrody bash login >>>\n'
      printf 'source %q\n' "$HOME/.bashrc"
      printf '# <<< aphrody bash login <<<\n'
    } >> "$login_profile"
  fi
  printf 'Installed Bash environment hook in %s. Open a new shell or source %s.\n' "$profile" "$_aphrody_shell_file"
  exit 0
fi

export APHRODY_ROOT="${APHRODY_ROOT:-$_aphrody_shell_root}"
export APHRODY_HOME="${APHRODY_HOME:-$HOME/.aphrody}"
export APHRODY_AGENT_DOMAIN="${APHRODY_AGENT_DOMAIN:-aphrody}"
export APHRODY_WORKSPACE="${APHRODY_WORKSPACE:-$APHRODY_HOME/workspaces/$APHRODY_AGENT_DOMAIN}"
export APHRODY_SOURCE_ROOT="${APHRODY_SOURCE_ROOT:-$APHRODY_ROOT/.cache/upstream}"
export APHRODY_PY_ROOT="${APHRODY_PY_ROOT:-$APHRODY_ROOT/py}"
export IECODE_ROOT="${IECODE_ROOT:-$APHRODY_ROOT}"

export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}"
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
for _aphrody_bin in "$CARGO_HOME/bin" "$BUN_INSTALL/bin" "$HOME/.local/bin"; do
  case ":$PATH:" in *":$_aphrody_bin:"*) ;; *) PATH="$_aphrody_bin:$PATH" ;; esac
done
export PATH
unset _aphrody_bin _aphrody_shell_file _aphrody_shell_root login_profile candidate
