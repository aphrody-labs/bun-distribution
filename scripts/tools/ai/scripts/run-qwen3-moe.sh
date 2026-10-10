#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Run Qwen3-30B-A3B with optional Qwen3-4B speculative decoding.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/run-qwen3-moe.sh [options]

Options:
  --model instruct|coder       Model family (default: instruct)
  --draft-model NAME_OR_PATH   Draft model alias or GGUF path
  --no-draft                  Disable speculative decoding
  --ctx N                     Context size (default: 32768)
  --cpu-moe N                 CPU MoE experts (default: 48; 0 disables offload flags)
  --host ADDRESS              Listen address (default: 127.0.0.1)
  --port N                    Listen port (default: 8080)
  --parallel N                Parallel slots (default: 1)
  --llama-server PATH         llama-server executable (otherwise PATH/runtime lookup)
  --prompt                    Start the server, send one prompt, then stop it
  --user-prompt TEXT          Prompt used with --prompt
  --dry-run                   Print the resolved executable and arguments
  -h, --help                  Show this help

Model root: APHRODY_MODELS_DIR or $APHRODY_HOME/models or ~/.aphrody/models.
EOF
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_value() {
    (($# >= 2)) || fail "missing value for $1"
    [[ -n "$2" ]] || fail "empty value for $1"
}

MODEL=instruct
DRAFT_MODEL=qwen3-4b-instruct
NO_DRAFT=0
CTX=32768
CPU_MOE=48
HOST=127.0.0.1
PORT=8080
PARALLEL=1
LLAMA_SERVER=
PROMPT=0
USER_PROMPT='Explain speculative decoding and MoE hybrid offloading in two concise paragraphs.'
DRY_RUN=0

while (($#)); do
    case "$1" in
        --model)         need_value "$@"; MODEL=$2; shift 2 ;;
        --draft-model)   need_value "$@"; DRAFT_MODEL=$2; shift 2 ;;
        --no-draft)      NO_DRAFT=1; shift ;;
        --ctx)           need_value "$@"; CTX=$2; shift 2 ;;
        --cpu-moe)       need_value "$@"; CPU_MOE=$2; shift 2 ;;
        --host)          need_value "$@"; HOST=$2; shift 2 ;;
        --port)          need_value "$@"; PORT=$2; shift 2 ;;
        --parallel)      need_value "$@"; PARALLEL=$2; shift 2 ;;
        --llama-server)  need_value "$@"; LLAMA_SERVER=$2; shift 2 ;;
        --prompt)        PROMPT=1; shift ;;
        --user-prompt)   need_value "$@"; USER_PROMPT=$2; shift 2 ;;
        --dry-run)       DRY_RUN=1; shift ;;
        -h|--help)       usage; exit 0 ;;
        *) fail "unknown argument: $1 (see --help)" ;;
    esac
done

[[ "$MODEL" == instruct || "$MODEL" == coder ]] || fail "--model must be instruct or coder"
for value_name in CTX PORT PARALLEL; do
    value=${!value_name}
    [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "$value_name must be a positive integer"
done
[[ "$PORT" -le 65535 ]] || fail "PORT must be at most 65535"
[[ "$CPU_MOE" =~ ^[0-9]+$ ]] || fail "CPU_MOE must be a non-negative integer"
CPU_MOE=$((10#$CPU_MOE))

HOME_ROOT=${APHRODY_HOME:-"${HOME:?HOME is not set}/.aphrody"}
STORE_ROOT=${APHRODY_MODELS_DIR:-"$HOME_ROOT/models"}
RUNTIMES_ROOT="$HOME_ROOT/runtimes"

if [[ -n "$LLAMA_SERVER" ]]; then
    if [[ "$LLAMA_SERVER" != */* ]]; then
        LLAMA_SERVER=$(command -v -- "$LLAMA_SERVER" || true)
    fi
else
    LLAMA_SERVER=$(command -v llama-server || true)
    if [[ -z "$LLAMA_SERVER" && -d "$RUNTIMES_ROOT" ]]; then
        while IFS= read -r candidate; do
            if [[ -x "$candidate" ]]; then LLAMA_SERVER=$candidate; break; fi
        done < <(find "$RUNTIMES_ROOT" -maxdepth 5 -type f -name llama-server -print 2>/dev/null | sort)
    fi
fi
[[ -n "$LLAMA_SERVER" && -x "$LLAMA_SERVER" ]] || fail "llama-server not found in PATH or $RUNTIMES_ROOT; pass --llama-server PATH"

case "$MODEL" in
    instruct)
        MODEL_REL='hf/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/eea7b2be5805a5f151f8847ede8e5f9a9284bf77/Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf'
        MODEL_MATCH='*Qwen3*30B*A3B*Instruct*.gguf' ;;
    coder)
        MODEL_REL='hf/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/b17cb02dd882d5b6ab62fc777ad2995f19668350/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf'
        MODEL_MATCH='*Qwen3*Coder*30B*A3B*.gguf' ;;
esac
DRAFT_REL='hf/unsloth/Qwen3-4B-Instruct-2507-GGUF/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'

find_model() {
    local expected=$1 pattern=$2
    local candidate="$STORE_ROOT/$expected"
    if [[ -f "$candidate" ]]; then printf '%s\n' "$candidate"; return 0; fi
    find "$STORE_ROOT" -type f -iname "$pattern" -print -quit 2>/dev/null || true
}

MODEL_PATH=$(find_model "$MODEL_REL" "$MODEL_MATCH")
[[ -n "$MODEL_PATH" && -f "$MODEL_PATH" ]] || fail "model '$MODEL' not found under $STORE_ROOT"

DRAFT_PATH=
if (( ! NO_DRAFT )); then
    if [[ "$DRAFT_MODEL" == */* || "$DRAFT_MODEL" == *.gguf ]]; then
        [[ -f "$DRAFT_MODEL" ]] && DRAFT_PATH=$(realpath "$DRAFT_MODEL")
    elif [[ "$DRAFT_MODEL" == qwen3-4b-instruct ]]; then
        DRAFT_PATH=$(find_model "$DRAFT_REL" '*Qwen3*4B*Instruct*.gguf')
    else
        DRAFT_PATH=$(find "$STORE_ROOT" -type f -iname "*${DRAFT_MODEL}*.gguf" -print -quit 2>/dev/null || true)
    fi
    if [[ -z "$DRAFT_PATH" ]]; then
        printf 'WARNING: draft model %s not found; disabling speculative decoding.\n' "$DRAFT_MODEL" >&2
    fi
fi

HELP_OUTPUT=$("$LLAMA_SERVER" --help 2>&1 || true)
has_flag() { grep -Fq -- "$1" <<<"$HELP_OUTPUT"; }

SERVER_ARGS=(--model "$MODEL_PATH" --host "$HOST" --port "$PORT" --ctx-size "$CTX" --parallel "$PARALLEL" --alias "qwen3-$MODEL")
if [[ -n "$DRAFT_PATH" ]] && { has_flag --model-draft || has_flag ' -md'; }; then
    SERVER_ARGS+=(--model-draft "$DRAFT_PATH")
fi
if has_flag --n-cpu-moe && (( CPU_MOE > 0 )); then
    SERVER_ARGS+=(--fit off --n-gpu-layers 49 --n-cpu-moe "$CPU_MOE")
fi
if has_flag --flash-attn; then
    if grep -Eq -- '--flash-attn[[:space:]]+\[on\|off\|auto\]' <<<"$HELP_OUTPUT"; then
        SERVER_ARGS+=(--flash-attn on)
    else
        SERVER_ARGS+=(--flash-attn)
    fi
fi
if has_flag --cache-type-k; then SERVER_ARGS+=(--cache-type-k q8_0 --cache-type-v q8_0); fi
if has_flag --jinja; then SERVER_ARGS+=(--jinja); fi
SERVER_ARGS+=(--no-webui)

printf 'Aphrody Qwen3 MoE runner\nModel: %s\nFile:  %s\n' "$MODEL" "$MODEL_PATH"
if [[ -n "$DRAFT_PATH" ]]; then printf 'Draft: %s\n' "$DRAFT_PATH"; else printf 'Draft: disabled\n'; fi
printf 'Host:  http://%s:%s\nArgs:' "$HOST" "$PORT"
printf ' %q' "$LLAMA_SERVER" "${SERVER_ARGS[@]}"
printf '\n'
(( DRY_RUN )) && exit 0

if (( ! PROMPT )); then
    exec "$LLAMA_SERVER" "${SERVER_ARGS[@]}"
fi

command -v curl >/dev/null || fail 'curl is required for --prompt'
command -v jq >/dev/null || fail 'jq is required for --prompt'
"$LLAMA_SERVER" "${SERVER_ARGS[@]}" &
SERVER_PID=$!
cleanup() {
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

READY=0
for ((attempt=0; attempt<60; attempt++)); do
    kill -0 "$SERVER_PID" 2>/dev/null || fail 'llama-server exited before becoming ready'
    if curl --silent --show-error --fail --max-time 2 "http://$HOST:$PORT/v1/models" >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done
(( READY )) || fail 'llama-server did not become ready within 60 seconds'

PAYLOAD=$(jq -n --arg model "qwen3-$MODEL" --arg prompt "$USER_PROMPT" \
    '{model:$model,messages:[{role:"system",content:"You are Aphrody system engine. Be concise and accurate."},{role:"user",content:$prompt}],temperature:0.6,stream:false}')
RESULT=$(curl --silent --show-error --fail --max-time 600 \
    -H 'Content-Type: application/json; charset=utf-8' \
    -d "$PAYLOAD" "http://$HOST:$PORT/v1/chat/completions") || fail 'completion request failed'
jq -er '.choices[0].message.content' <<<"$RESULT"
if jq -e '.usage' >/dev/null <<<"$RESULT"; then
    jq -r '"Tokens prompt: \(.usage.prompt_tokens // 0), completion: \(.usage.completion_tokens // 0), total: \(.usage.total_tokens // 0)"' <<<"$RESULT"
fi
