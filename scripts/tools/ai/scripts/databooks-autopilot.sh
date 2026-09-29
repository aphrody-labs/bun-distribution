#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Full databooks transcription pipeline, no human in the loop.
#
# Converges to a fixed point: fetch every plate still missing a
# transcription, read it with the vision model, read what came back empty
# with PP-OCR, deposit everything the contract marks depositable, and repeat
# until a pass deposits nothing new. What survives every pass is a page that
# both engines agree carries no readable text — a genuine illustration, not a
# gap this pipeline can close.
#
# Runs unattended by design (CLAUDE.md §0.1): no confirmation prompt, no
# --dry-run. The safety rail is not a human gate here, it is the contract
# itself — `aphrody ocr batch` only ever marks a page `text` when its content
# clears the measured thresholds (drop_noise_blocks, is_page_furniture,
# content_score), and `dbfr push` only ever sends pages stored as `text`.
# A page that is ambiguous lands in `needs-review` and is never sent.
#
# Usage: scripts/databooks-autopilot.sh [lot-root] [max-iterations]
set -uo pipefail

APHRODY="${APHRODY_BIN:-$(cargo metadata --format-version 1 --no-deps 2>/dev/null | jq -r '.target_directory')/debug/aphrody}"
ROOT="${1:-var/ocr-lots}"
MAX_ITER="${2:-6}"
MUTE="$ROOT-mute"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

missing_count() {
	"$APHRODY" ocr dbfr survey --include-hidden --json 2>/dev/null |
		jq -r '.missing // "?"'
}

log "=== autopilot start — missing: $(missing_count) ==="

for iter in $(seq 1 "$MAX_ITER"); do
	log "--- iteration $iter/$MAX_ITER ---"

	log "fetch-all: downloading every plate still missing a transcription"
	"$APHRODY" ocr dbfr fetch-all --dir "$ROOT" --include-hidden --json \
		>"$ROOT/fetch-all-iter$iter.json" 2>"$ROOT/fetch-all-iter$iter.log"
	fetched="$(jq -r '.downloaded // 0' "$ROOT/fetch-all-iter$iter.json" 2>/dev/null || echo 0)"
	log "fetch-all: $fetched new plate(s) downloaded"

	log "VLM pass: reading every lot with dots.ocr (--skip-done resumes)"
	bash scripts/databooks-transcribe-all.sh "$ROOT" >>"$ROOT/autopilot-vlm-iter$iter.log" 2>&1

	log "PP-OCR pass: re-reading what the VLM returned empty"
	bash scripts/databooks-ppocr-pass.sh "$ROOT" "$MUTE" >>"$ROOT/autopilot-ppocr-iter$iter.log" 2>&1

	before="$(cat "$ROOT/.missing-before" 2>/dev/null || echo 999999)"
	after="$(missing_count)"
	echo "$after" >"$ROOT/.missing-before"
	log "iteration $iter done — missing: $after (was $before)"

	if [ "$after" = "$before" ]; then
		log "no progress this iteration — converged, stopping"
		break
	fi
	if [ "$after" = "0" ]; then
		log "corpus fully transcribed"
		break
	fi
done

log "=== autopilot done — missing: $(missing_count) ==="
"$APHRODY" ocr dbfr survey --include-hidden --top 30
exit 0
