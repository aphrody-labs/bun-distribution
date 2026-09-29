#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Second pass: read with PP-OCR the plates the vision model returned empty.
#
# # Why a second engine rather than a second try
#
# dots.ocr returns an empty turn on a page of sparse captions — measured on
# databook 28, where every plate came back textless while carrying its year
# header, its figure captions and its folio. Re-running the same model on the
# same plate cannot fix that; a detector-plus-CTC engine reads them.
#
# The plates are copied into a separate tree rather than read in place. Two
# reasons: the corpus keys a record by its path, so a copy keeps the PP-OCR
# reading beside the VLM one instead of overwriting it, and `push --lot` can
# then target exactly the second pass.
#
# A plate whose only text is its folio stays `no-text` — the engine flags it as
# page furniture, and a page number is not a transcription.
#
# Usage: scripts/databooks-ppocr-pass.sh [--dry-run] [lot-root] [mute-root]
set -uo pipefail

APHRODY="${APHRODY_BIN:-$(cargo metadata --format-version 1 --no-deps 2>/dev/null | jq -r '.target_directory')/debug/aphrody}"
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
	DRY_RUN=1
	shift
fi
ROOT="${1:-var/ocr-lots}"
MUTE="${2:-var/ocr-mute}"

mkdir -p "$MUTE"
deposited_total=0
read_total=0

for src in "$ROOT"/*/; do
	id="$(basename "$src")"
	case "$id" in
	'' | *[!0-9]*) continue ;;
	esac
	jsonl="$ROOT/$id.jsonl"

	if [ -f "$jsonl" ]; then
		# Plates the VLM pass returned empty, by basename.
		mapfile -t mutes < <(grep '"kind":"none"' "$jsonl" |
			sed -E 's|.*"image":"([^"]+)".*|\1|' |
			sed -E 's|.*[\\/]||')
	else
		# No JSONL at all: this lot was skipped by the VLM pass (oversized
		# scans — see the size gate in databooks-transcribe-all.sh). Every one
		# of its plates is a candidate here.
		mapfile -t mutes < <(find "$src" -maxdepth 1 -type f -exec basename {} \;)
	fi
	[ "${#mutes[@]}" -eq 0 ] && continue

	dst="$MUTE/$id"
	mkdir -p "$dst"
	copied=0
	for name in "${mutes[@]}"; do
		[ -f "$src/$name" ] || continue
		[ -f "$dst/$name" ] && continue
		cp "$src/$name" "$dst/$name" && copied=$((copied + 1))
	done
	present="$(find "$dst" -maxdepth 1 -type f | wc -l | tr -d ' ')"
	[ "$present" = "0" ] && continue

	echo "=== databook $id — ${#mutes[@]} mute plate(s), $copied newly copied ==="
	if ! "$APHRODY" ocr batch "$dst" --engine ppocr --out "$MUTE/$id.jsonl" --skip-done; then
		echo "  PP-OCR batch failed for $id"
		continue
	fi
	read_total=$((read_total + present))

	if [ "$DRY_RUN" = "1" ]; then
		"$APHRODY" ocr dbfr push "$id" --lot "$dst"
		continue
	fi
	response="$("$APHRODY" ocr dbfr push "$id" --lot "$dst" --apply --json)" || {
		echo "  deposit failed for $id"
		continue
	}
	deposited="$(printf '%s' "$response" | jq -r '.plates // 0')"
	deposited_total=$((deposited_total + deposited))
	echo "  deposited $deposited plate(s)"
done

echo
echo "PP-OCR pass: $read_total plate(s) read, $deposited_total deposited"
exit 0
