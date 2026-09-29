#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Drive the databooks transcription loop over every lot fetched by
# `aphrody ocr dbfr fetch-all`: read, audit, deposit.
#
# Sequential on purpose. One vision model fills the GPU; running two batches at
# once does not halve the wall clock, it doubles the chance of an out-of-memory
# kill in the middle of a lot.
#
# The audit is a gate, not a report: a lot carrying a blocking defect (control
# tokens, stuck generation, surviving markup) is skipped, and its identifier is
# listed at the end. Depositing degenerate text into a public corpus costs far
# more than reading the lot again.
#
# A lot whose plates average above the size gate skips the vision model
# entirely and is left for the PP-OCR pass instead. Measured cause: databook
# 29's scans average 17 MB/plate against ~1.6 MB everywhere else, and dots.ocr
# took 272 s/plate on them instead of ~9 s — reading it this way would have
# cost 3.5 GPU-hours to learn what PP-OCR answers directly.
#
# Usage:
#   scripts/databooks-transcribe-all.sh [--dry-run] [lot-root]
#
# Environment: DBFR_TOKEN (or SHENRON_ADMIN_TOKEN) must be set for the deposit.
set -uo pipefail

APHRODY="${APHRODY_BIN:-$(cargo metadata --format-version 1 --no-deps 2>/dev/null | jq -r '.target_directory')/debug/aphrody}"
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
	DRY_RUN=1
	shift
fi
ROOT="${1:-var/ocr-lots}"
# KiB/plate above which a lot is skipped for the VLM pass. 4 MiB sits well
# above the ~1.6 MB/plate measured across the corpus and well below the 17 MB
# lot that motivated the gate.
readonly OVERSIZED_KIB=4096

if [ ! -x "$APHRODY" ] && ! command -v "$APHRODY" >/dev/null 2>&1; then
	echo "aphrody binary not found: $APHRODY" >&2
	exit 1
fi

deposited_total=0
skipped_lots=""
failed_lots=""
oversized_lots=""

for dir in "$ROOT"/*/; do
	id="$(basename "$dir")"
	case "$id" in
	'' | *[!0-9]*) continue ;;
	esac
	jsonl="$ROOT/$id.jsonl"
	pages="$(find "$dir" -maxdepth 1 -type f | wc -l | tr -d ' ')"
	[ "$pages" = "0" ] && continue

	bytes="$(du -sb "$dir" 2>/dev/null | cut -f1)"
	avg_kib=$(((${bytes:-0} / pages) / 1024))
	if [ "$avg_kib" -gt "$OVERSIZED_KIB" ]; then
		echo "=== databook $id — $pages plate(s), ${avg_kib} KiB/plate: skipping VLM (PP-OCR pass will read it) ==="
		oversized_lots="$oversized_lots $id"
		continue
	fi

	echo "=== databook $id — $pages plate(s) ==="
	# --skip-done makes a re-run resume instead of re-reading pages that a
	# previous pass already put in the JSONL.
	if ! "$APHRODY" ocr batch "$dir" --out "$jsonl" --model dots-ocr \
		--max-tokens 2048 --raw --skip-done; then
		echo "  batch failed for $id"
		failed_lots="$failed_lots $id"
		continue
	fi

	if ! "$APHRODY" ocr audit "$jsonl" >/dev/null; then
		echo "  audit found a blocking defect — NOT depositing $id"
		skipped_lots="$skipped_lots $id"
		continue
	fi

	"$APHRODY" ocr db ingest "$jsonl" >/dev/null || true

	if [ "$DRY_RUN" = "1" ]; then
		"$APHRODY" ocr dbfr push "$id" --lot "$dir"
		continue
	fi

	response="$("$APHRODY" ocr dbfr push "$id" --lot "$dir" --apply --json)"
	status=$?
	if [ $status -ne 0 ]; then
		echo "  deposit failed for $id"
		failed_lots="$failed_lots $id"
		continue
	fi
	deposited="$(printf '%s' "$response" | jq -r '.plates // 0')"
	deposited_total=$((deposited_total + deposited))
	echo "  deposited $deposited plate(s)"
done

echo
echo "total deposited: $deposited_total plate(s)"
[ -n "$skipped_lots" ] && echo "skipped by the audit:$skipped_lots"
[ -n "$failed_lots" ] && echo "failed:$failed_lots"
[ -n "$oversized_lots" ] && echo "left for PP-OCR (oversized scans):$oversized_lots"
exit 0
