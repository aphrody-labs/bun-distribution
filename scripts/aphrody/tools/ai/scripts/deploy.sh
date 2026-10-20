#!/usr/bin/env bash
# ============================================================================
#  aphrody — auto-deploy (bash, Linux)
#  Remplace l'ancien `cargo xtask deploy` (crate aphrody-xtask supprimée le
#  2026-05-21). Build release de tous les binaires du workspace puis copie
#  ceux qui matchent les préfixes vers ~/.local/bin (convention d'install).
#
#  Usage :
#    ./scripts/deploy.sh                        # build + install (aphrody,aphrody-google,mrx,notebooklm)
#    ./scripts/deploy.sh --remote workspace     # choose the clean source remote explicitly
#    ./scripts/deploy.sh --no-build             # copie seulement (build déjà fait)
#    ./scripts/deploy.sh --prefixes aphrody     # restreindre aux bins aphrody*
#    ./scripts/deploy.sh --target x86_64-unknown-linux-gnu
#    ./scripts/deploy.sh --dest /opt/bin --dry-run
#    ./scripts/deploy.sh --include-gui          # + copie aphrody-gui (app desktop)
#  Linux implementation; the former PowerShell installer was retired.
#
#  Note GUI : l'app desktop (apps/desktop) est un workspace SELF-ROOTED exclu du
#  workspace core, donc `cargo build --release` ne la construit PAS. --include-gui
#  copie le binaire `aphrody-gui` déjà bâti (copy-only) depuis
#  apps/desktop/src-tauri/target/[<triple>/]{release,debug} à côté d'aphrody,
#  pour que le resolver sibling de `aphrody gui` le trouve une fois déployé.
#  Construire la GUI en PRODUCTION d'abord (charge les assets bundlés, sinon le
#  binaire cherche le serveur dev http://localhost:1420) :
#    cd apps/desktop && bun install && bun run tauri build
#  (ou, binaire seul sans Node : scripts/aphrody/build/rust/cargo-serial.sh build
#   --manifest-path apps/desktop/src-tauri/Cargo.toml --release --features custom-protocol)
# ============================================================================
set -euo pipefail

NO_BUILD=0
PREFIXES="aphrody,aphrody-google,mrx,notebooklm"
DEST=""
TARGET=""
DRY_RUN=0
INCLUDE_GUI=0
REMOTE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --no-build)    NO_BUILD=1; shift ;;
        --prefixes)    PREFIXES="$2"; shift 2 ;;
        --dest)        DEST="$2"; shift 2 ;;
        --target)      TARGET="$2"; shift 2 ;;
        --remote)      REMOTE="$2"; shift 2 ;;
        --remote=*)    REMOTE="${1#*=}"; shift ;;
        --include-gui) INCLUDE_GUI=1; shift ;;
        --dry-run)     DRY_RUN=1; shift ;;
        -h|--help)     sed -n '2,27p' "$0"; exit 0 ;;
        *) echo "Argument inconnu : $1" >&2; exit 2 ;;
    esac
done

# --- Racine repo (le script vit dans scripts/) ------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Répertoire cible réel ---------------------------------------------------
# `../.cargo/config.toml` (superproject) route ce workspace vers un target-dir
# partagé entre dépôts frères ; ne jamais supposer `$REPO_ROOT/target`. Résolu
# via `cargo metadata`, seule source de vérité (respecte aussi un
# CARGO_TARGET_DIR ou --config posé en env pour cet appel).
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps 2>/dev/null | jq -r '.target_directory')"
if [ -z "$TARGET_DIR" ] || [ "$TARGET_DIR" = "null" ]; then
    echo "ERROR: impossible de résoudre target_directory via cargo metadata" >&2
    exit 1
fi

# Deployment provenance gate: install only from a clean main checkout whose
# HEAD equals the selected remote's main. Prefer origin when configured,
# otherwise workspace; never select legacy remotes implicitly.
if [[ -z "$REMOTE" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    REMOTE=origin
  elif git remote get-url workspace >/dev/null 2>&1; then
    REMOTE=workspace
  else
    echo 'ERROR: no origin or workspace remote is configured; pass --remote <name>' >&2
    exit 2
  fi
fi
[[ "$REMOTE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  echo "ERROR: invalid remote name: $REMOTE" >&2; exit 2;
}
git remote get-url "$REMOTE" >/dev/null 2>&1 || {
  echo "ERROR: remote '$REMOTE' is not configured" >&2; exit 2;
}
if ! git fetch "$REMOTE" main --quiet; then
  echo "ERROR: unable to fetch main from remote '$REMOTE'" >&2
  exit 1
fi
branch="$(git branch --show-current)"
if [[ "$branch" != main ]]; then
  echo "ERROR: deployment refused: branch is '$branch', expected main" >&2
  exit 1
fi
head_sha="$(git rev-parse HEAD)"
remote_ref="refs/remotes/$REMOTE/main"
if ! remote_main_sha="$(git rev-parse --verify "$remote_ref^{commit}" 2>/dev/null)"; then
  echo "ERROR: $REMOTE/main is unavailable after fetch" >&2
  exit 1
fi
if [[ "$head_sha" != "$remote_main_sha" ]]; then
  echo "ERROR: deployment refused: HEAD $head_sha does not match $REMOTE/main $remote_main_sha" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "ERROR: deployment refused: tracked or untracked files are dirty" >&2
  exit 1
fi
echo "[deploy] provenance $REMOTE/main=$remote_main_sha"

# --- Préfixes ---------------------------------------------------------------
IFS=',' read -r -a PREFIX_ARR <<< "$PREFIXES"
[ "${#PREFIX_ARR[@]}" -gt 0 ] || { echo "--prefixes vide" >&2; exit 2; }

# --- Destination ------------------------------------------------------------
if [ -z "$DEST" ]; then
    DEST="${HOME:-.}/.local/bin"
fi

# --- Build ------------------------------------------------------------------
if [ "$NO_BUILD" -eq 0 ]; then
    BUILD_ARGS=(build --release --locked)
    [ -n "$TARGET" ] && BUILD_ARGS+=(--target "$TARGET")
    echo "[deploy] cargo ${BUILD_ARGS[*]}"
    if [ "$DRY_RUN" -eq 0 ]; then
        "$REPO_ROOT/scripts/aphrody/build/rust/cargo-serial.sh" "${BUILD_ARGS[@]}"
    fi
fi

# --- Répertoire(s) des artefacts -------------------------------------------
# Sans --target explicite, `.cargo/config.toml` peut forcer un `build.target`
# : les binaires atterrissent alors dans target/<triple>/release et non
# target/release. On cherche dans tous les candidats plausibles.
matches_prefix() {
    local name="$1"
    for p in "${PREFIX_ARR[@]}"; do
        case "$name" in "$p"*) return 0 ;; esac
    done
    return 1
}

CANDIDATE_DIRS=()
if [ -n "$TARGET" ]; then
    CANDIDATE_DIRS+=("$TARGET_DIR/$TARGET/release")
else
    # Prefer explicit target layouts.  A plain <target-dir>/release directory
    # can coexist with an older host build and must not shadow a fresh build.
    for d in "$TARGET_DIR"/*/release; do
        [ -d "$d" ] && CANDIDATE_DIRS+=("$d")
    done
    CANDIDATE_DIRS+=("$TARGET_DIR/release")
fi

# --- Découverte : exécutables top-level matchant un préfixe -----------------
BINS=()
RELEASE_DIR=""
for dir in "${CANDIDATE_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    mapfile -t found < <(
        find "$dir" -maxdepth 1 -type f -perm -u+x ! -name '*.d' ! -name '*.so' 2>/dev/null \
            | while read -r f; do
                base="$(basename "$f")"
                if matches_prefix "$base"; then echo "$f"; fi
            done | sort -u
    )
    if [ "${#found[@]}" -gt 0 ]; then BINS=("${found[@]}"); RELEASE_DIR="$dir"; break; fi
done
[ "${#BINS[@]}" -gt 0 ] || { echo "Aucun binaire exécutable matchant $PREFIXES dans : ${CANDIDATE_DIRS[*]} (build manqué ?)" >&2; exit 1; }
echo "[deploy] artefacts depuis $RELEASE_DIR"

# --- GUI desktop (opt-in) : binaire hors-workspace, build séparé ------------
# `aphrody-gui` est produit par le cargo self-rooted de apps/desktop/src-tauri
# (target propre), jamais par le build core. On l'ajoute au lot de copie pour
# qu'il atterrisse à côté d'aphrody (le resolver sibling de `aphrody gui` le
# trouve alors en prod). Copy-only : aucun build déclenché ici.
if [ "$INCLUDE_GUI" -eq 1 ]; then
    gui_root="$(cd "$REPO_ROOT/apps/desktop/src-tauri" && cargo metadata --format-version 1 --no-deps 2>/dev/null | jq -r '.target_directory')"
    if [ -z "$gui_root" ] || [ "$gui_root" = "null" ]; then
        echo "ERROR: impossible de résoudre target_directory pour apps/desktop/src-tauri" >&2
        exit 1
    fi
    # Candidate <profile> dirs in priority order (release before debug),
    # honouring both the plain layout (target/<profile>) and a forced
    # build.target layout (target/<triple>/<profile>).
    GUI_DIRS=()
    if [ -n "$TARGET" ]; then
        GUI_DIRS+=("$gui_root/$TARGET/release" "$gui_root/$TARGET/debug")
    else
        gui_triples=()
        if [ -d "$gui_root" ]; then
            for d in "$gui_root"/*/; do
                base="$(basename "$d")"
                case "$base" in release|debug) continue ;; esac
                [ -d "$d" ] && gui_triples+=("${d%/}")
            done
        fi
        for prof in release debug; do
            GUI_DIRS+=("$gui_root/$prof")
            if [ "${#gui_triples[@]}" -gt 0 ]; then
                for t in "${gui_triples[@]}"; do GUI_DIRS+=("$t/$prof"); done
            fi
        done
    fi
    gui_bin=""
    for gd in "${GUI_DIRS[@]}"; do
        if [ -f "$gd/aphrody-gui" ]; then gui_bin="$gd/aphrody-gui"; break; fi
    done
    if [ -n "$gui_bin" ]; then
        BINS+=("$gui_bin")
        echo "[deploy] +GUI : $gui_bin"
    else
        echo "[warn] --include-gui demandé mais aphrody-gui introuvable dans : ${GUI_DIRS[*]}" >&2
        echo "       Build production : cd apps/desktop && bun install && bun run tauri build" >&2
    fi
fi

[ "$DRY_RUN" -eq 0 ] && mkdir -p "$DEST"

# --- Copie ------------------------------------------------------------------
deployed=0
for src in "${BINS[@]}"; do
    base="$(basename "$src")"
    dst="$DEST/$base"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "[dry-run] $src -> $dst"
        continue
    fi
    # install(1) gère le remplacement même si le binaire tourne (unlink+create).
    if install -m 0755 "$src" "$dst" 2>/dev/null || cp -f "$src" "$dst"; then
        size=$(stat -c%s "$dst" 2>/dev/null || stat -f%z "$dst" 2>/dev/null || echo "?")
        printf "  [ok] %-28s (%s bytes)\n" "$base" "$size"
        deployed=$((deployed+1))
    else
        echo "  [fail] $base" >&2
    fi
done

[ "$DRY_RUN" -eq 0 ] && echo "=== aphrody deploy : $deployed binaire(s) installé(s) -> $DEST ==="

# --- Check PATH -------------------------------------------------------------
case ":$PATH:" in
    *":$DEST:"*) : ;;
    *) echo "[warn] $DEST n'est pas dans le PATH. Ajoute :  export PATH=\"\$PATH:$DEST\"" ;;
esac
