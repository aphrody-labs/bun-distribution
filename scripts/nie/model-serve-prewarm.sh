#!/usr/bin/env bash
# scripts/nie/model-serve-prewarm.sh
# Production pre-warming pipeline for nie-model-serve (:8790).
# Assembles and caches high-traffic 3D GLB character models and keshin.
# Centralized and orchestrated by aphrody-infra.

set -euo pipefail

HOST="${MODEL_SERVE_HOST:-127.0.0.1}"
PORT="${MODEL_SERVE_PORT:-8790}"
BASE_URL="http://${HOST}:${PORT}"
JSON_MODE=0

for arg in "$@"; do
    case "$arg" in
        --json) JSON_MODE=1 ;;
        --host=*) HOST="${arg#*=}"; BASE_URL="http://${HOST}:${PORT}" ;;
        --port=*) PORT="${arg#*=}"; BASE_URL="http://${HOST}:${PORT}" ;;
    esac
done

# Health check first
if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    if [ "$JSON_MODE" -eq 1 ]; then
        echo "{\"status\":\"error\",\"message\":\"nie-model-serve unreachable at ${BASE_URL}/health\"}"
    else
        echo "✗ nie-model-serve is not responding at ${BASE_URL}/health" >&2
    fi
    exit 1
fi

if [ "$JSON_MODE" -eq 0 ]; then
    echo "=== nie-model-serve Pre-warm Pipeline ==="
    echo "Target: ${BASE_URL}"
fi

# Priority character and asset codes for pre-assembly
TARGETS=(
    "c01000010" # Endou Mamoru / Mark Evans
    "c01000020" # Gouenji Shuuya / Axel Blaze
    "c01000030" # Kidou Yuuto / Jude Sharp
    "c01000040" # Fubuki Shirou / Shawn Froste
    "c01000050" # Kazemaru Ichirouta / Nathan Swift
    "c01000060" # Aphrodi / Byron Love
    "k000010"   # Majin The Hand (Keshin)
    "ka001901"  # Keshin Armed
)

success=0
total=${#TARGETS[@]}
details=()

for code in "${TARGETS[@]}"; do
    url="${BASE_URL}/model-full/${code}.glb"
    if [ "$JSON_MODE" -eq 0 ]; then
        printf "Pre-warming %-12s ... " "${code}.glb"
    fi

    status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")

    if [ "$status" = "200" ]; then
        success=$((success + 1))
        if [ "$JSON_MODE" -eq 0 ]; then
            echo "OK (HTTP 200)"
        fi
        details+=("{\"code\":\"$code\",\"status\":\"ok\"}")
    else
        if [ "$JSON_MODE" -eq 0 ]; then
            echo "FAIL (HTTP $status)"
        fi
        details+=("{\"code\":\"$code\",\"status\":\"fail\",\"http_code\":\"$status\"}")
    fi
done

if [ "$JSON_MODE" -eq 1 ]; then
    details_json=$(IFS=,; echo "${details[*]}")
    echo "{\"status\":\"completed\",\"success\":$success,\"total\":$total,\"target\":\"$BASE_URL\",\"items\":[$details_json]}"
else
    echo "Pre-warming completed: ${success}/${total} assets ready in model cache."
fi
