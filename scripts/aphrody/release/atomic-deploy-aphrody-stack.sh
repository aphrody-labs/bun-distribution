#!/usr/bin/env bash
set -Eeuo pipefail

# Activate one Aphrody stack release: five loopback services (aphrody-site,
# aphrody-web-api, aphrody-a2a, aphrody-ai-http, aphrody-shenron-embed) behind
# the aphrody.com apex vhost. Requires the packaged local smoke attestation
# (SMOKE.json, written by smoke-aphrody-stack-local.py --attest) to match the
# release checksums. Any failure restores the previous units, apex vhost,
# active env files and `current`, and restarts what was running before.
#
#   atomic-deploy-aphrody-stack.sh /home/ubuntu/apps/aphrody/releases/ID
#   atomic-deploy-aphrody-stack.sh --compute-only /home/ubuntu/apps/aphrody/releases/ID
#   atomic-deploy-aphrody-stack.sh --restore BACKUP_DIR
#
# `--compute-only` activates only the Shenron compute roster (aphrody-shenron-embed
# + aphrody-ai-http) on a compute host: no apex vhost/certificate, no site/Web
# env files, no CLI/UI/Web/A2A binaries. The release must carry bin/aphrody-mcp,
# bin/aphrody-embed and bin/aphrody-llama-daemon, and a SMOKE.json
# (schema aphrody-compute-smoke/v1) produced from the real services: complete
# corpus (every chunk vectorised), recall@5 >= 0.8, zero retrieval errors and a
# ready real LLM. LLM mode is managed Qwen+LoRA unless APHRODY_COMPUTE_LLM=gemini-web
# is set explicitly. Secrets are read from /etc/aphrody/aphrody-ai-http.env only.
#
# `--restore` re-applies the backup written by an earlier activation (the
# bundle adapter uses it to undo a successful step). APHRODY_STACK_BACKUP_DIR
# selects where the activation backup goes (default shared/deploy-backups).
usage='usage: atomic-deploy-aphrody-stack.sh [--compute-only] /home/ubuntu/apps/aphrody/releases/ID | --restore BACKUP_DIR'
[[ $# -ge 1 && $# -le 2 ]] || { echo "$usage" >&2; exit 2; }
mode=full
if [[ "$1" = --compute-only ]]; then mode=compute; shift; fi
[[ $# -ge 1 ]] || { echo "$usage" >&2; exit 2; }
root="${APHRODY_RELEASE_ROOT:-/home/ubuntu/apps/aphrody}"
current="$root/current"
env_dir=/etc/aphrody
conf=/etc/nginx/conf.d/aphrody-apex.conf
full_services=(aphrody-web-api aphrody-a2a aphrody-shenron-embed aphrody-ai-http aphrody-site)
compute_services=(aphrody-shenron-embed aphrody-ai-http)
services=("${full_services[@]}")
[[ "$mode" = full ]] || services=("${compute_services[@]}")
e5_dir="$root/shared/models/e5-native"
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }

restore_backup() {
  local backup="$1" service previous state backup_mode name
  # Legacy backups carry no mode: they are full-stack snapshots.
  backup_mode="$(cat "$backup/mode" 2>/dev/null || echo full)"
  case "$backup_mode" in
    full) services=("${full_services[@]}") ;;
    compute) services=("${compute_services[@]}") ;;
    *) echo "unknown backup mode: $backup_mode" >&2; return 2 ;;
  esac
  if [[ -f "$backup/roster" ]]; then
    [[ "$(tr '\n' ' ' < "$backup/roster")" = "${services[*]} " ]] || { echo "backup roster does not match mode $backup_mode" >&2; return 2; }
  fi
  mode="$backup_mode"
  for service in "${services[@]}"; do systemctl stop "$service.service" 2>/dev/null || true; done
  for service in "${services[@]}"; do
    state="$(cat "$backup/$service.enabled" 2>/dev/null || true)"
    case "$state" in enabled|enabled-runtime) ;; *) systemctl disable "$service.service" >/dev/null 2>&1 || true ;; esac
    if [[ -e "$backup/$service.service" ]]; then
      cp -a -- "$backup/$service.service" "/etc/systemd/system/$service.service"
    else
      rm -f -- "/etc/systemd/system/$service.service"
    fi
  done
  if [[ "$mode" = full ]]; then
    if [[ -e "$backup/aphrody-apex.conf" ]]; then cp -a -- "$backup/aphrody-apex.conf" "$conf"; else rm -f -- "$conf"; fi
    for name in aphrody-site aphrody-web-api; do
      if [[ -e "$backup/$name.env" ]]; then cp -a -- "$backup/$name.env" "$env_dir/$name.env"; else rm -f -- "$env_dir/$name.env"; fi
    done
  fi
  previous="$(cat "$backup/previous-release" 2>/dev/null || true)"
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn -- "$previous" "$root/.current.rollback.$$"
    mv -Tf -- "$root/.current.rollback.$$" "$current"
  else
    # First activation: there was no pointer before this release.
    rm -f -- "$current"
  fi
  systemctl daemon-reload || true
  if [[ "$mode" = full ]] && nginx -t; then systemctl reload nginx || true; fi
  for service in "${services[@]}"; do
    state="$(cat "$backup/$service.enabled" 2>/dev/null || true)"
    case "$state" in enabled|enabled-runtime) systemctl enable "$service.service" >/dev/null 2>&1 || true ;; esac
    if [[ "$(cat "$backup/$service.active" 2>/dev/null || true)" = active ]]; then systemctl restart "$service.service" || true; fi
  done
}

if [[ "$1" = --restore ]]; then
  # The mode comes from the backup itself, never from the command line.
  [[ $# -eq 2 && "$mode" = full ]] || { echo "$usage" >&2; exit 2; }
  backup="$(realpath -e -- "$2")"
  [[ "$(cat "$backup/kind" 2>/dev/null || true)" = aphrody-stack && -f "$backup/previous-release" ]] || {
    echo "not an Aphrody stack activation backup: $backup" >&2; exit 2;
  }
  restore_backup "$backup"
  printf 'restored Aphrody stack (%s roster) from %s; current=%s\n' "$mode" "$backup" "$(if [[ -L "$current" ]]; then readlink -f -- "$current"; else echo none; fi)"
  exit 0
fi
[[ $# -eq 1 ]] || { echo "$usage" >&2; exit 2; }

release="$(realpath -e -- "$1")"
[[ "$release" = "$(realpath -m -- "$root/releases")/"* ]] || { echo 'release must be under release root' >&2; exit 2; }
if [[ "$mode" = full ]]; then
  required_files=(bin/{aphrody-site,aphrody-web-api,aphrody,aphrody-mcp,aphrody-embed} lib/{libaphrody_web_ffi.so,libbxc_render.so} ai.json RELEASE_SHA RELEASE_ID SHA256SUMS SMOKE.json nginx/aphrody-apex.conf)
else
  # Compute package: MCP gateway, E5 server and the managed llama daemon only.
  required_files=(bin/{aphrody-mcp,aphrody-embed,aphrody-llama-daemon} RELEASE_SHA RELEASE_ID SHA256SUMS SMOKE.json)
fi
for file in "${required_files[@]}"; do
  [[ -r "$release/$file" ]] || { echo "missing $file" >&2; exit 2; }
done
for command in curl jq python3 sha256sum ss runuser; do command -v "$command" >/dev/null || { echo "missing $command" >&2; exit 2; }; done
for service in "${services[@]}"; do [[ -r "$release/systemd/$service.service" ]] || { echo "missing unit: $service" >&2; exit 2; }; done
(cd "$release" && sha256sum --quiet --check SHA256SUMS)
if [[ "$mode" = compute ]]; then
  # The checksum file must actually cover what compute runs, not just exist.
  for file in bin/aphrody-mcp bin/aphrody-embed bin/aphrody-llama-daemon "${compute_services[@]/#/systemd/}"; do
    target="$file"; [[ "$file" = systemd/* ]] && target="$file.service"
    awk -v target="$target" '$2 == target { found=1 } END { exit !found }' "$release/SHA256SUMS" || { echo "SHA256SUMS does not cover $target" >&2; exit 2; }
  done
  [[ -z "$(find "$release/bin" -mindepth 1 -maxdepth 1 ! -name aphrody-mcp ! -name aphrody-embed ! -name aphrody-llama-daemon -print -quit)" ]] || {
    echo 'compute package must contain only aphrody-mcp, aphrody-embed and aphrody-llama-daemon in bin/' >&2; exit 2;
  }
  for file in aphrody-mcp aphrody-embed aphrody-llama-daemon; do
    [[ -f "$release/bin/$file" && -x "$release/bin/$file" && ! -L "$release/bin/$file" ]] || {
      echo "compute binary must be an executable regular file: $file" >&2; exit 2;
    }
  done
fi
llm_mode="${APHRODY_COMPUTE_LLM:-managed}"
[[ "$mode" = compute ]] && { [[ "$llm_mode" = managed || "$llm_mode" = gemini-web ]] || { echo 'APHRODY_COMPUTE_LLM must be managed or gemini-web' >&2; exit 2; }; }
python3 - "$release" "$mode" "$llm_mode" "${services[@]}" <<'PY' || { echo 'SMOKE.json does not attest this release (full: smoke-aphrody-stack-local.py --attest; compute: attestation from the real services)' >&2; exit 2; }
import hashlib
import math
import json
import pathlib
import sys

release, mode, llm_mode, roster = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4:]
smoke = json.loads((release / 'SMOKE.json').read_text())
bound = (smoke.get('status') == 'ok'
         and smoke.get('releaseId') == (release / 'RELEASE_ID').read_text().strip()
         and smoke.get('sha256sums') == hashlib.sha256((release / 'SHA256SUMS').read_bytes()).hexdigest()
         and sorted(smoke.get('services') or []) == sorted(roster))
if mode == 'full':
    ok = bound and smoke.get('schema') == 'aphrody-stack-smoke/v1' and int(smoke.get('dragonballTools') or 0) > 0
else:
    rag, llm = smoke.get('rag') or {}, smoke.get('llm') or {}
    chunks, vectors = rag.get('chunks'), rag.get('vectors')
    ok = (bound and smoke.get('schema') == 'aphrody-compute-smoke/v1' and smoke.get('mode') == 'compute'
          and smoke.get('source') == 'live-services'
          and type(chunks) is int and chunks > 0 and type(vectors) is int and vectors == chunks
          and rag.get('corpusComplete') is True
          and type(rag.get('recall5')) in (int, float) and math.isfinite(rag['recall5']) and 0.8 <= rag['recall5'] <= 1
          and type(rag.get('retrievalErrors')) is int and rag['retrievalErrors'] == 0
          and llm.get('ready') is True and llm.get('provider') == llm_mode)
sys.exit(0 if ok else 1)
PY
[[ "$mode" = compute ]] || [[ -L "$release/.coord" && "$(readlink -- "$release/.coord")" = /home/ubuntu/apps/aphrody/shared/coord ]] || { echo 'persistent .coord link missing' >&2; exit 2; }
id -u aphrody >/dev/null 2>&1 || { echo 'system user aphrody missing (provision-aphrody-stack-env.sh --fresh-host)' >&2; exit 2; }

# Active site/Web env files are optional (fresh host); staged and AI env are not.
if [[ "$mode" = full ]]; then env_required=(aphrody-site.next aphrody-web-api.next aphrody-ai-http); else env_required=(aphrody-ai-http); fi
for name in "${env_required[@]}"; do
  envfile="$env_dir/$name.env"
  [[ -f "$envfile" && "$(stat -c %a "$envfile")" = 600 ]] || { echo "missing 0600 $envfile" >&2; exit 2; }
done
if [[ "$mode" = full ]]; then
  for name in aphrody-site aphrody-web-api aphrody-a2a; do
    envfile="$env_dir/$name.env"
    [[ ! -e "$envfile" || "$(stat -c %a "$envfile")" = 600 ]] || { echo "$envfile must be 0600" >&2; exit 2; }
  done
  if grep -Eq '^APHRODY_WEB_API_TOKEN=' "$env_dir/aphrody-site.next.env"; then
    echo 'AI backend token variable must not be in site env' >&2; exit 2;
  fi
  for pair in 'aphrody-site.next:APHRODY_WEB_DATABASE_URL' 'aphrody-site.next:APHRODY_SITE_DATABASE_URL' 'aphrody-site.next:APHRODY_SITE_WEB_API_TOKEN' 'aphrody-site.next:APHRODY_BXC_API_TOKEN' 'aphrody-site.next:APHRODY_SITE_WEB_BACKEND_TOKEN' 'aphrody-web-api.next:BXC_API_TOKEN' 'aphrody-web-api.next:APHRODY_WEB_DATABASE_URL'; do
    name="${pair%%:*}"; key="${pair#*:}"
    grep -Eq "^$key=" "$env_dir/$name.env" || { echo "missing $key in $name.env" >&2; exit 2; }
  done
fi
grep -Eq '^APHRODY_MCP_DATABASE_URL=' "$env_dir/aphrody-ai-http.env" || { echo 'missing APHRODY_MCP_DATABASE_URL in aphrody-ai-http.env' >&2; exit 2; }
[[ "$mode" != full ]] || grep -Eq '^APHRODY_SHENRON_API_TOKEN=' "$env_dir/aphrody-ai-http.env" || { echo 'missing APHRODY_SHENRON_API_TOKEN in aphrody-ai-http.env' >&2; exit 2; }
# Canonical APHRODY_AI_* names (tools/aphrody/config/local-ai.json) first, then the legacy
# alias; both present with different values is ambiguous and refused.
ai_value() {
  local file="$env_dir/aphrody-ai-http.env" value='' found='' key candidate
  for key in "$@"; do
    grep -Eq "^$key=" "$file" || continue
    candidate="$(sed -n "s/^$key=//p" "$file" | tail -n 1)"
    if [[ -n "$found" && "$candidate" != "$value" ]]; then
      echo "aphrody-ai-http.env: $found and $key disagree" >&2; return 1
    fi
    [[ -n "$found" ]] || { value="$candidate"; found="$key"; }
  done
  printf '%s' "$value"
}
[[ "$(ai_value APHRODY_AI_EMBED_MODEL APHRODY_SHENRON_EMBED_MODEL)" = Xenova/multilingual-e5-small ]] || { echo 'APHRODY_AI_EMBED_MODEL must be Xenova/multilingual-e5-small (the imported E5 corpus)' >&2; exit 2; }
[[ "$(ai_value APHRODY_AI_EMBED_BASE_URL APHRODY_SHENRON_EMBED_BASE_URL)" = http://127.0.0.1:8794/v1 ]] || { echo 'APHRODY_AI_EMBED_BASE_URL must target the loopback E5 service' >&2; exit 2; }
[[ -n "$(ai_value APHRODY_SHENRON_API_TOKEN APHRODY_AI_HTTP_TOKEN)" ]] || { echo 'Shenron API token is missing or ambiguous' >&2; exit 2; }
if [[ "$mode" = full || "$llm_mode" = gemini-web ]]; then
  [[ "$(ai_value APHRODY_SHENRON_LLM_PROVIDER)" = gemini-web ]] || { echo 'Aphrody AI must route Shenron generation through Gemini Web' >&2; exit 2; }
  [[ "$(ai_value APHRODY_SHENRON_GEMINI_COOKIE_FILE)" = "$root/shared/ai/google-cookies.json" ]] || { echo 'Aphrody AI Gemini Web session path is not configured' >&2; exit 2; }
  gemini_cookie="$root/shared/ai/google-cookies.json"
  [[ -f "$gemini_cookie" && "$(stat -c %a "$gemini_cookie")" = 600 && "$(stat -c %U "$gemini_cookie")" = aphrody ]] || { echo 'Aphrody AI Gemini Web session must be an aphrody-owned 0600 file' >&2; exit 2; }
else
  # Managed Qwen+LoRA: the chat model, adapter and llama runtime must exist for the service user.
  llm_provider="$(ai_value APHRODY_SHENRON_LLM_PROVIDER)" || exit 2
  [[ -z "$llm_provider" || "$llm_provider" = managed ]] || { echo "managed compute refuses APHRODY_SHENRON_LLM_PROVIDER=$llm_provider (set APHRODY_COMPUTE_LLM=gemini-web to select Gemini)" >&2; exit 2; }
  [[ "$(ai_value APHRODY_SHENRON_LLM_FALLBACK)" != gemini-web ]] || { echo 'managed compute must not fall back to Gemini Web' >&2; exit 2; }
  [[ -n "$(ai_value APHRODY_AI_CHAT_MODEL APHRODY_LLM_MODEL APHRODY_SHENRON_LLM_MODEL)" ]] || { echo 'APHRODY_AI_CHAT_MODEL (Qwen) is not configured' >&2; exit 2; }
  lora="$(ai_value APHRODY_SHENRON_CHAT_LORA)" || exit 2
  [[ -n "$lora" && "$lora" = /* ]] && runuser -u aphrody -- test -s "$lora" || { echo 'APHRODY_SHENRON_CHAT_LORA must be an absolute adapter file readable by aphrody' >&2; exit 2; }
  llama_bin="$(ai_value APHRODY_LLAMA_BIN)" || exit 2
  llama_dir="$(ai_value APHRODY_LLAMA_DIR)" || exit 2
  if [[ -n "$llama_bin" ]]; then llama_server="$llama_bin"; elif [[ -n "$llama_dir" ]]; then llama_server="$llama_dir/llama-server"; else llama_server=''; fi
  [[ -n "$llama_server" && "$llama_server" = /* ]] && runuser -u aphrody -- test -x "$llama_server" || { echo 'APHRODY_LLAMA_BIN or APHRODY_LLAMA_DIR must locate an executable llama-server for aphrody' >&2; exit 2; }
fi
if [[ "$mode" = full ]]; then
  web_dsn="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$env_dir/aphrody-site.next.env")"
  legacy_web_dsn="$(sed -n 's/^APHRODY_SITE_DATABASE_URL=//p' "$env_dir/aphrody-site.next.env")"
  web_api_dsn="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$env_dir/aphrody-web-api.next.env")"
  site_public_token="$(sed -n 's/^APHRODY_SITE_WEB_API_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
  legacy_public_token="$(sed -n 's/^APHRODY_BXC_API_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
  site_backend_token="$(sed -n 's/^APHRODY_SITE_WEB_BACKEND_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
  web_backend_token="$(sed -n 's/^BXC_API_TOKEN=//p' "$env_dir/aphrody-web-api.next.env")"
  [[ "$site_public_token" =~ ^[0-9a-f]{64}$ && "$site_public_token" = "$legacy_public_token" ]] || {
    echo 'site public Web token aliases differ or are invalid' >&2; exit 2;
  }
  [[ "$site_backend_token" =~ ^[0-9a-f]{64}$ && "$site_backend_token" = "$web_backend_token" ]] || {
    echo 'site and integrated Web API backend tokens differ or are invalid' >&2; exit 2;
  }
  [[ -n "$web_dsn" && "$web_dsn" = "$legacy_web_dsn" && "$web_dsn" = "$web_api_dsn" ]] || {
    echo 'site and Web API DSNs differ' >&2; exit 2;
  }
  printf '%s' "$web_dsn" | python3 -c 'import sys,urllib.parse; p=urllib.parse.urlsplit(sys.stdin.read()); sys.exit(0 if p.scheme in ("postgres","postgresql") and p.hostname in ("127.0.0.1","localhost") and p.username == "aphrody_web" and p.path == "/aphrody_web" else 1)' || {
    echo 'Web DSN does not target local aphrody_web as aphrody_web' >&2; exit 2;
  }
fi
if [[ "$mode" = full ]]; then
  for dir in "$root/shared/bxc" "$root/shared/bxc/storage" "$root/shared/coord" "$root/shared/a2a" "$root/shared/ai" "$root/shared/ai/models" "$e5_dir"; do [[ -d "$dir" ]] || { echo "missing shared directory: $dir" >&2; exit 2; }; done
  [[ "$(stat -c %U "$root/shared/bxc/storage")" = ubuntu ]] || { echo 'Web storage directory must belong to ubuntu' >&2; exit 2; }
else
  for dir in "$root/shared/ai" "$root/shared/ai/models" "$e5_dir"; do [[ -d "$dir" ]] || { echo "missing shared directory: $dir" >&2; exit 2; }; done
fi
# The E5 service never downloads: the pinned files must be preloaded
# (aphrody-embed install --model-dir) and readable by its service user.
for file in config.json tokenizer.json model.safetensors; do
  runuser -u aphrody -- test -s "$e5_dir/$file" || { echo "E5 weights missing or unreadable: $e5_dir/$file" >&2; exit 2; }
done
# A loopback port that already listens must belong to the unit that will own it.
assert_port_owned() {
  local port="$1" unit="$2" listener unit_pid
  listener="$(ss -H -ltnp "( sport = :$port )" | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1)"
  [[ -z "$listener" ]] && return 0
  unit_pid="$(systemctl show -p MainPID --value "$unit.service")"
  [[ "$unit_pid" =~ ^[1-9][0-9]*$ && "$listener" = "$unit_pid" ]] && grep -Fq "/$unit.service" "/proc/$listener/cgroup" || {
    echo "port $port is owned by another process than $unit" >&2; exit 2;
  }
}
if [[ "$mode" = full ]]; then
  assert_port_owned 3007 aphrody-web-api
  [[ -L "$root/shared/a2a/ai.json" && "$(readlink -- "$root/shared/a2a/ai.json")" = "$root/current/ai.json" ]] || { echo 'A2A manifest link missing' >&2; exit 2; }
  [[ -L "$root/shared/a2a/.coord" && "$(readlink -- "$root/shared/a2a/.coord")" = "$root/shared/coord" ]] || { echo 'A2A mailbox link missing' >&2; exit 2; }
else
  assert_port_owned 8789 aphrody-ai-http
  assert_port_owned 8794 aphrody-shenron-embed
  # Compute activation repoints the shared `current`: refuse to do it under a live full stack.
  for unit in aphrody-site aphrody-web-api aphrody-a2a; do
    ! systemctl is-active --quiet "$unit.service" || { echo "$unit is active: --compute-only is for a compute-only host" >&2; exit 2; }
  done
fi
for dir in "$root/shared/ai" "$root/shared/ai/models"; do
  [[ "$(stat -c %U "$dir")" = aphrody ]] || { echo "AI state directory must belong to aphrody: $dir" >&2; exit 2; }
done

backup="${APHRODY_STACK_BACKUP_DIR:-$root/shared/deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
install -d -m 0700 "$backup"
[[ -z "$(ls -A -- "$backup")" ]] || { echo "backup directory is not empty: $backup" >&2; exit 2; }
previous=""
if [[ -L "$current" ]]; then previous="$(readlink -f -- "$current")"; fi
[[ ! -e "$current" || -L "$current" ]] || { echo "current is not a symlink" >&2; exit 2; }
[[ -z "$previous" || "$previous" = "$(realpath -m -- "$root/releases")/"* ]] || { echo 'current points outside the release root' >&2; exit 2; }
printf 'aphrody-stack\n' > "$backup/kind"
printf '%s\n' "$previous" > "$backup/previous-release"
printf '%s\n' "$release" > "$backup/target-release"
printf '%s\n' "$mode" > "$backup/mode"
printf '%s\n' "${services[@]}" > "$backup/roster"
for service in "${services[@]}"; do
  systemctl is-enabled "$service.service" > "$backup/$service.enabled" 2>/dev/null || true
  systemctl is-active "$service.service" > "$backup/$service.active" 2>/dev/null || true
  if [[ -e "/etc/systemd/system/$service.service" ]]; then
    cp -a -- "/etc/systemd/system/$service.service" "$backup/$service.service"
  fi
done
if [[ "$mode" = full ]]; then
  if [[ -e "$conf" ]]; then cp -a -- "$conf" "$backup/aphrody-apex.conf"; fi
  for name in aphrody-site aphrody-web-api; do
    if [[ -e "$env_dir/$name.env" ]]; then cp -a -- "$env_dir/$name.env" "$backup/$name.env"; fi
  done
fi
activated=no
fixture_pid=''
fixture_dir=''
clean_fixture() {
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  if [[ -n "$fixture_dir" ]]; then rm -rf -- "$fixture_dir"; fi
}
rollback() {
  local status=$?
  trap - EXIT
  clean_fixture
  if [[ "$activated" = yes ]]; then restore_backup "$backup"; fi
  echo "activation failed; rollback attempted; backup=$backup" >&2
  exit "$status"
}
trap rollback EXIT
activated=yes
for service in "${services[@]}"; do install -m 0644 "$release/systemd/$service.service" "/etc/systemd/system/$service.service"; done
if [[ "$mode" = full ]]; then
  install -m 0644 "$release/nginx/aphrody-apex.conf" "$conf"
  install -m 0600 -o root -g root "$env_dir/aphrody-site.next.env" "$env_dir/aphrody-site.env"
  install -m 0600 -o root -g root "$env_dir/aphrody-web-api.next.env" "$env_dir/aphrody-web-api.env"
  nginx -t
fi
systemctl daemon-reload
ln -sfn -- "$release" "$root/.current.new.$$"
mv -Tf -- "$root/.current.new.$$" "$current"
for service in "${services[@]}"; do systemctl restart "$service.service"; done
# systemctl restart can return before a crashing service loses its listener.
sleep 2
for service in "${services[@]}"; do
  systemctl is-active --quiet "$service.service" || { echo "service failed after start: $service" >&2; exit 1; }
done
if [[ "$mode" = full ]]; then
  binary_specs=('aphrody-site:aphrody-site' 'aphrody-web-api:aphrody-web-api' 'aphrody-a2a:aphrody' 'aphrody-shenron-embed:aphrody-embed' 'aphrody-ai-http:aphrody-mcp')
else
  binary_specs=('aphrody-shenron-embed:aphrody-embed' 'aphrody-ai-http:aphrody-mcp')
fi
for spec in "${binary_specs[@]}"; do
  service="${spec%%:*}"
  binary="${spec#*:}"
  main_pid="$(systemctl show -p MainPID --value "$service.service")"
  configured="$(systemctl show -p ExecStart --value "$service.service")"
  expected_exe="$(realpath -e -- "$release/bin/$binary")"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ && "$configured" == *"path=/home/ubuntu/apps/aphrody/current/bin/$binary ;"* ]] || {
    echo "service $service does not start the release binary" >&2; exit 1;
  }
  [[ "$(readlink -e -- "/proc/$main_pid/exe")" = "$expected_exe" ]] || {
    echo "service $service is running an old binary" >&2; exit 1;
  }
  running_sha="$(sha256sum "/proc/$main_pid/exe" | cut -d' ' -f1)"
  release_sha="$(sha256sum "$release/bin/$binary" | cut -d' ' -f1)"
  [[ "$running_sha" = "$release_sha" ]] || {
    echo "service $service executable hash differs from release" >&2; exit 1;
  }
done
if [[ "$mode" = full ]]; then
  web_pid="$(systemctl show -p MainPID --value aphrody-web-api.service)"
  listener_pid="$(ss -H -ltnp '( sport = :3007 )' | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1)"
  [[ "$web_pid" =~ ^[1-9][0-9]*$ && "$listener_pid" = "$web_pid" ]] || {
    echo "Web listener on 3007 is not owned by aphrody-web-api.service" >&2
    exit 1
  }
  grep -Fq '/aphrody-web-api.service' "/proc/$listener_pid/cgroup" || {
    echo "Web listener on 3007 has the wrong cgroup" >&2
    exit 1
  }
fi

probe() {
  local url="$1"
  for _ in $(seq 1 30); do curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "probe failed: $url" >&2; return 1
}
if [[ "$mode" = full ]]; then
  probe http://127.0.0.1:3007/health
  probe http://127.0.0.1:8788/ping
  probe http://127.0.0.1:8789/healthz
  probe http://127.0.0.1:8083/healthz
  probe http://127.0.0.1:8794/health
else
  probe http://127.0.0.1:8789/healthz
  probe http://127.0.0.1:8794/health
fi
# The Dragon Ball tools that replaced shenron-mcp live in aphrody-mcp.
python3 - <<'PY' || { echo 'aphrody-mcp does not list the dragonball.* tools' >&2; exit 1; }
import json
import urllib.request

endpoint = 'http://127.0.0.1:8789/mcp'
headers = {'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json',
           'MCP-Protocol-Version': '2025-06-18'}

def post(message, extra=None):
    request = urllib.request.Request(endpoint, json.dumps(message).encode(), {**headers, **(extra or {})}, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.headers.get('Mcp-Session-Id'), response.read().decode()

def result(text, request_id):
    for line in [l[5:].strip() for l in text.splitlines() if l.startswith('data:')] or [text]:
        if line:
            message = json.loads(line)
            if isinstance(message, dict) and message.get('id') == request_id:
                return message['result']
    raise SystemExit(1)

session, text = post({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
    'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'aphrody-deploy', 'version': '1'}}})
result(text, 1)
extra = {'Mcp-Session-Id': session} if session else {}
post({'jsonrpc': '2.0', 'method': 'notifications/initialized'}, extra)
_, text = post({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}}, extra)
names = [tool['name'] for tool in result(text, 2)['tools']]
raise SystemExit(0 if any(name.startswith('dragonball.') for name in names) else 1)
PY

compute_probes() {
  local token chunks_attested answer_json status
  token="$(ai_value APHRODY_AI_HTTP_TOKEN APHRODY_SHENRON_API_TOKEN)"
  [[ -n "$token" ]] || { echo 'Shenron API token is empty' >&2; return 1; }
  shenron() { # METHOD PATH [JSON]: bearer travels on stdin, never in argv, logs or output
    local method="$1" path="$2" body="${3:-}" args=()
    [[ -z "$body" ]] || args=(-H 'Content-Type: application/json' -d "$body")
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
      curl --config - --noproxy '*' --silent --fail --max-time "${SHENRON_PROBE_TIMEOUT:-600}" -X "$method" "${args[@]}" "http://127.0.0.1:8789/api/v1/shenron$path"
  }
  # The private API must refuse a request without the token.
  status="$(curl --noproxy '*' --silent --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8789/api/v1/shenron/health)" || status=000
  [[ "$status" = 401 ]] || { echo "Shenron API answered HTTP $status without a token" >&2; return 1; }
  # E5 query embedding: real 384-dimension vector from the loopback server.
  curl --noproxy '*' --silent --fail --max-time 30 -H 'Content-Type: application/json' \
    -d '{"model":"Xenova/multilingual-e5-small","input":["query: Son Goku"]}' http://127.0.0.1:8794/v1/embeddings |
    jq -e '(.data[0].embedding | length) == 384' >/dev/null || { echo 'E5 embedding probe failed' >&2; return 1; }
  # Real generation first: the managed daemon starts on first use and health reports it after.
  answer_json="$(shenron POST /llm/chat '{"messages":[{"role":"user","content":"Reponds uniquement: OK"}]}')" || { echo 'Shenron LLM chat probe failed' >&2; return 1; }
  if [[ "$llm_mode" = gemini-web ]]; then
    printf '%s' "$answer_json" | jq -e '(.answer | type == "string" and length > 0) and (.model | startswith("gemini-web/"))' >/dev/null
  else
    printf '%s' "$answer_json" | jq -e '(.answer | type == "string" and length > 0) and ((.model // "") | startswith("gemini-web/") | not) and (.fallback | not)' >/dev/null
  fi || { echo "Shenron LLM answered outside the selected $llm_mode mode" >&2; return 1; }
  shenron GET /health | jq -e '.status == "ok" and .capabilities.rag == true and .capabilities.llm == true' >/dev/null || { echo 'Shenron health: rag/llm not ready' >&2; return 1; }
  chunks_attested="$(jq -r '.rag.chunks' "$release/SMOKE.json")"
  shenron GET /rag/stats | jq -e --argjson attested "$chunks_attested" '.chunks > 0 and .vectors == .chunks and .chunks >= $attested' >/dev/null || { echo 'Shenron corpus is incomplete or smaller than attested' >&2; return 1; }
  shenron GET '/rag/search?q=Son%20Goku&limit=3' | jq -e '(.mode == "hybrid" or .mode == "hybrid+rerank") and (.results | length) > 0' >/dev/null || { echo 'Shenron RAG search is empty or not hybrid' >&2; return 1; }
}
if [[ "$mode" = compute ]]; then compute_probes; fi
if [[ "$mode" = full ]]; then
  nginx -t
  systemctl reload nginx
  apex_probe() {
    local path="$1" status=000
    # nginx reload is asynchronous: an old worker can briefly return 404.
    for _ in $(seq 1 30); do
      status="$(curl --noproxy '*' --silent --show-error --max-time 5 \
        -o /dev/null -w '%{http_code}' --resolve aphrody.com:443:127.0.0.1 \
        "https://aphrody.com$path")" || status=000
      [[ "$status" = 200 ]] && return 0
      sleep 1
    done
    echo "apex probe failed: $path HTTP $status" >&2
    return 1
  }
  for path in /healthz /api/v1/a2a/ping /api/v1/models; do
    apex_probe "$path"
  done
  rankings="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/api/v1/bxc/rankings)"
  printf '%s' "$rankings" | jq -e '(.status == "unavailable" and (.top_ranking_targets | length) == 0) or (.status == "analyzed" and all(.top_ranking_targets[]; .status == "reported_with_provenance"))' >/dev/null || {
    echo 'public rankings contain unverified measurements' >&2; exit 1;
  }
  if [[ "${APHRODY_STACK_EXPECT_EMPTY_RANKINGS:-}" = yes ]]; then
    printf '%s' "$rankings" | jq -e '.status == "unavailable" and (.top_ranking_targets | length) == 0' >/dev/null || {
      echo 'public rankings are not empty after filtering legacy seed data' >&2; exit 1;
    }
  fi
  card="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/.well-known/agent-card.json)"
  printf '%s' "$card" | jq -e 'any(.supportedInterfaces[]; .url == "https://aphrody.com/api/v1/a2a" and .protocolVersion == "1.0")' >/dev/null
  public_manifest="$(curl --noproxy '*' -fsS --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/ai.json | sha256sum | cut -d' ' -f1)"
  expected_manifest="$(sha256sum "$release/ai.json" | cut -d' ' -f1)"
  [[ "$public_manifest" = "$expected_manifest" ]] || { echo 'public ai.json differs from pinned manifest' >&2; exit 1; }
  public_token="$(sed -n 's/^APHRODY_SITE_WEB_API_TOKEN=//p' "$env_dir/aphrody-site.env" | tail -n 1)"
  [[ "$public_token" =~ ^[0-9a-f]{64}$ ]] || { echo 'public Web token must be a 64-character hex value' >&2; exit 1; }
  unauth_status="$(curl --noproxy '*' --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' \
    --resolve aphrody.com:443:127.0.0.1 -H 'Content-Type: application/json' \
    -d '{"url":"http://127.0.0.1:33907/index.html","profile":"static"}' \
    https://aphrody.com/api/v1/web/scrape)"
  [[ "$unauth_status" = 401 ]] || { echo "public Web unauthenticated probe returned HTTP $unauth_status" >&2; exit 1; }
  deny_status="$(printf 'header = "Authorization: Bearer %s"\n' "$public_token" | \
    curl --config - --noproxy '*' --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' \
      --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/api/v1/web/not-allowlisted)"
  [[ "$deny_status" = 404 ]] || { echo "public Web allowlist probe returned HTTP $deny_status" >&2; exit 1; }
  fixture_dir="$(mktemp -d /tmp/aphrody-web-probe.XXXXXXXX)"
  printf '<!doctype html><title>Aphrody Web probe</title><h1>Local fixture</h1>' > "$fixture_dir/index.html"
  python3 -m http.server 33907 --bind 127.0.0.1 --directory "$fixture_dir" > "$fixture_dir/server.log" 2>&1 &
  fixture_pid=$!
  probe http://127.0.0.1:33907/index.html
  probe_status="$(printf 'header = "Authorization: Bearer %s"\n' "$public_token" | \
    curl --config - --noproxy '*' --silent --show-error --max-time 30 -o "$fixture_dir/scrape.json" -w '%{http_code}' \
      --resolve aphrody.com:443:127.0.0.1 -H 'Content-Type: application/json' \
      -d '{"url":"http://127.0.0.1:33907/index.html","profile":"static"}' \
      https://aphrody.com/api/v1/web/scrape)"
  [[ "$probe_status" = 200 ]] && grep -Fq 'Aphrody Web probe' "$fixture_dir/scrape.json" || {
    echo "public Web scrape probe failed: HTTP $probe_status" >&2; exit 1;
  }
  clean_fixture
fi
for service in "${services[@]}"; do systemctl enable "$service.service" >/dev/null; done
[[ "$mode" != full ]] || rm -f -- "$env_dir/aphrody-site.next.env" "$env_dir/aphrody-web-api.next.env"
trap - EXIT
printf 'activated Aphrody stack (%s roster) %s; previous=%s; backup=%s\n' "$mode" "$(cat "$release/RELEASE_ID")" "${previous:-none}" "$backup"
