#!/usr/bin/env bash
# optimize-assets.sh — pipeline 2026 d'optimisation maximale des assets DB.
#
# Sources : apps/bot/public/db/  (617 fichiers DBZ téléchargés Phase 2)
# Outputs :
#   - original  : optimisé in-place (pngquant + oxipng / mozjpeg via sharp / gifsicle / svgo)
#   - .webp     : variante WebP qualité 80, m=6, lossless si <50% gain
#   - .avif     : variante AVIF speed 6 q=50 (meilleure compression)
#
# Tools chain (best 2026):
#   PNG  : pngquant --quality=70-85 → oxipng -o 4 --strip safe  (lossy quality + lossless)
#   JPEG : sharp + mozjpeg q=82, progressive=true              (best JPEG encoder)
#   GIF  : gifsicle -O3 --lossy=80                              (animations préservées)
#   SVG  : svgo --multipass                                     (DOM clean + paths simplifiés)
#   ANY  : cwebp -q 80 -m 6 -af -mt -progressive               (WebP universal)
#   ANY  : avifenc --speed 6 --min 25 --max 35 --jobs all      (AVIF: -50% vs JPEG)
#
# Idempotent : skip si .webp + .avif déjà présents et fichier original inchangé.
# Logs : reports/optimize-YYYYMMDD-HHMMSS.log avec ratios per-file.

set -uo pipefail
shopt -s nullglob globstar

ROOT="${1:-apps/bot/public/db}"
[ -d "$ROOT" ] || { echo "FATAL: $ROOT introuvable" >&2; exit 1; }

REPORT="reports/optimize-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$REPORT")"
exec > >(tee -a "$REPORT") 2>&1

JOBS="${JOBS:-$(nproc)}"
echo "=== optimize-assets.sh — $(date -Iseconds) ==="
echo "ROOT=$ROOT  JOBS=$JOBS"
echo "Initial size: $(du -sh "$ROOT" | cut -f1)"

ORIG_BYTES=$(du -sb "$ROOT" | cut -f1)
declare -A STATS=( [png_in]=0 [png_out]=0 [jpg_in]=0 [jpg_out]=0 [webp_made]=0 [avif_made]=0 [gif_in]=0 [gif_out]=0 [svg_in]=0 [svg_out]=0 [skip]=0 [err]=0 )

bytes_of() { stat -c%s "$1" 2>/dev/null || echo 0; }

# ---- PNG ---- (pngquant lossy → oxipng lossless)
optimize_png() {
  local f="$1"
  local before; before=$(bytes_of "$f")
  pngquant --quality=70-90 --skip-if-larger --strip --speed 1 --output "$f" --force "$f" 2>/dev/null || true
  oxipng -o 4 --strip safe --quiet "$f" 2>/dev/null || true
  local after; after=$(bytes_of "$f")
  echo "  PNG  $f : ${before}B → ${after}B ($((100 * (before - after) / (before + 1)))%)"
}

# ---- JPEG ---- batch via sharp (mozjpeg q=82) → optimize-jpeg-batch.ts
# fait UNE FOIS en début de pipeline (≈10× plus rapide qu'1 fichier à la fois)
optimize_jpeg() { :; } # no-op, batch fait en amont

# ---- GIF ----
optimize_gif() {
  local f="$1"
  local before; before=$(bytes_of "$f")
  gifsicle -O3 --lossy=80 --batch "$f" 2>/dev/null || true
  local after; after=$(bytes_of "$f")
  echo "  GIF  $f : ${before}B → ${after}B"
}

# ---- SVG ----
optimize_svg() {
  local f="$1"
  local before; before=$(bytes_of "$f")
  svgo --multipass --quiet "$f" 2>/dev/null || true
  local after; after=$(bytes_of "$f")
  echo "  SVG  $f : ${before}B → ${after}B"
}

# ---- WebP variant ----
make_webp() {
  local f="$1"
  local webp="${f%.*}.webp"
  [ -f "$webp" ] && [ "$webp" -nt "$f" ] && return
  cwebp -q 80 -m 6 -af -mt -quiet "$f" -o "$webp" 2>/dev/null && echo "  → webp $(basename "$webp") $(bytes_of "$webp")B"
}

# ---- AVIF variant ----
make_avif() {
  local f="$1"
  local avif="${f%.*}.avif"
  [ -f "$avif" ] && [ "$avif" -nt "$f" ] && return
  avifenc --speed 6 --min 25 --max 35 --jobs all "$f" "$avif" >/dev/null 2>&1 && echo "  → avif $(basename "$avif") $(bytes_of "$avif")B"
}

process_file() {
  local f="$1"
  case "${f,,}" in
    *.png)  optimize_png  "$f"; make_webp "$f"; make_avif "$f" ;;
    *.jpg|*.jpeg) optimize_jpeg "$f"; make_webp "$f"; make_avif "$f" ;;
    *.webp) ;; # already webp, skip cross-encode
    *.avif) ;;
    *.gif)  optimize_gif  "$f" ;;
    *.svg)  optimize_svg  "$f" ;;
    *) ;;
  esac
}
export -f process_file optimize_png optimize_jpeg optimize_gif optimize_svg make_webp make_avif bytes_of

echo
echo "=== JPEG batch (sharp + mozjpeg) ==="
JOBS="$JOBS" bun run "$(dirname "$0")/optimize-jpeg-batch.ts" "$ROOT"

echo
echo "=== pipeline parallèle ==="
find "$ROOT" -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.svg" \) -print0 \
  | xargs -0 -n 1 -P "$JOBS" -I {} bash -c 'process_file "$@"' _ {}

FINAL_BYTES=$(du -sb "$ROOT" | cut -f1)
SAVED=$((ORIG_BYTES - FINAL_BYTES))
RATIO=$((100 * SAVED / (ORIG_BYTES + 1)))

echo
echo "=== résumé ==="
echo "  Avant   : $(numfmt --to=iec --suffix=B $ORIG_BYTES)"
echo "  Après   : $(numfmt --to=iec --suffix=B $FINAL_BYTES)"
echo "  Économisé : $(numfmt --to=iec --suffix=B $SAVED) (-${RATIO}%)"
echo "  Total fichiers : $(find "$ROOT" -type f | wc -l)"
echo "  WebP variants  : $(find "$ROOT" -name "*.webp" -newer "$REPORT" 2>/dev/null | wc -l)"
echo "  AVIF variants  : $(find "$ROOT" -name "*.avif" -newer "$REPORT" 2>/dev/null | wc -l)"
echo "  Report : $REPORT"
