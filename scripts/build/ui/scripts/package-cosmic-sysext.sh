#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# ==============================================================================
# COSMIC Epoch systemd-sysext Packaging, Audit & Deployment Automation
#
# Generates an immutable, read-only SquashFS extension image for COSMIC Epoch,
# verifies shared library dependencies, D-Bus services and systemd units,
# and coordinates live mounting via systemd-sysext overlayfs.
# ==============================================================================

set -euo pipefail

# ANSI Color codes for formatted terminal output
readonly C_RESET='\033[0m'
readonly C_BOLD='\033[1m'
readonly C_RED='\033[31m'
readonly C_GREEN='\033[32m'
readonly C_YELLOW='\033[33m'
readonly C_BLUE='\033[34m'
readonly C_CYAN='\033[36m'

log_info()    { printf "${C_CYAN}${C_BOLD}[INFO]${C_RESET} %s\n" "$*"; }
log_ok()      { printf "${C_GREEN}${C_BOLD}[OK]${C_RESET} %s\n" "$*"; }
log_warn()    { printf "${C_YELLOW}${C_BOLD}[WARN]${C_RESET} %s\n" "$*"; }
log_error()   { printf "${C_RED}${C_BOLD}[ERROR]${C_RESET} %s\n" "$*"; }
log_section() { printf "\n${C_BLUE}${C_BOLD}=== %s ===${C_RESET}\n" "$*"; }

# ------------------------------------------------------------------------------
# Default Configuration
# ------------------------------------------------------------------------------
COSMIC_EPOCH_DIR="${COSMIC_EPOCH_DIR:-$HOME/cosmic-epoch}"
DEFAULT_STAGING_DIR="$COSMIC_EPOCH_DIR/cosmic-sysext"
DEFAULT_IMAGE_NAME="cosmic"
DEFAULT_OUTPUT_DIR="$COSMIC_EPOCH_DIR/dist"
DEFAULT_COMPRESSION="zstd"
DEFAULT_ZSTD_LEVEL="15"
DEFAULT_BLOCK_SIZE="1M"

STAGING_DIR="${STAGING_DIR:-$DEFAULT_STAGING_DIR}"
IMAGE_NAME="${IMAGE_NAME:-$DEFAULT_IMAGE_NAME}"
OUTPUT_DIR="${OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
COMPRESSION="${COMPRESSION:-$DEFAULT_COMPRESSION}"

MODE_AUDIT=true
MODE_BUILD=true
MODE_DEPLOY=false
MODE_UNMERGE=false
MODE_TEST_SESSION=false

# ------------------------------------------------------------------------------
# Help & Usage
# ------------------------------------------------------------------------------
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Automatise la validation, l'empaquetage systemd-sysext et le déploiement de COSMIC Epoch.

Options:
  -s, --staging <DIR>      Chemin racine du staging (défaut: $DEFAULT_STAGING_DIR)
  -n, --name <NAME>        Nom de l'extension (défaut: $DEFAULT_IMAGE_NAME)
  -o, --out-dir <DIR>      Répertoire de destination pour l'image (défaut: $DEFAULT_OUTPUT_DIR)
  -c, --comp <ALGO>        Algorithme de compression SquashFS (zstd, xz, gzip) (défaut: $DEFAULT_COMPRESSION)
      --audit-only         Exécute uniquement l'audit d'intégrité (ldd, dbus, desktop, systemd)
      --build-only         Génère uniquement l'image SquashFS sans déploiement
      --clean              Purger les répertoires intermédiaires target/ et staging pour libérer l'espace disque
      --deploy             Installe l'image dans /var/lib/extensions/ et exécute 'systemd-sysext refresh'
      --unmerge            Démonte l'extension via 'systemd-sysext unmerge'
      --test-session       Affiche la procédure et vérifie l'environnement pour 'cosmic-session'
  -h, --help               Affiche cette aide et quitte

Exemples:
  $(basename "$0")                          # Audit complet et build de l'image
  $(basename "$0") --clean                  # Purge immédiate des targets et répertoires de build
  $(basename "$0") --audit-only             # Audit strict des bibliothèques et unités
  $(basename "$0") --deploy                 # Build et montage à chaud via systemd-sysext
  $(basename "$0") --unmerge                # Restauration de l'arborescence /usr d'origine
EOF
}

# ------------------------------------------------------------------------------
# CLI Arguments Parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        -s|--staging)
            STAGING_DIR="$2"; shift 2 ;;
        -n|--name)
            IMAGE_NAME="$2"; shift 2 ;;
        -o|--out-dir)
            OUTPUT_DIR="$2"; shift 2 ;;
        -c|--comp)
            COMPRESSION="$2"; shift 2 ;;
        --audit-only)
            MODE_AUDIT=true; MODE_BUILD=false; MODE_DEPLOY=false; shift ;;
        --build-only)
            MODE_AUDIT=false; MODE_BUILD=true; MODE_DEPLOY=false; shift ;;
        --clean)
            log_section "Nettoyage des artefacts de compilation intermédiaires"
            log_info "Suppression des répertoires target/ et staging non compressé..."
            rm -rf "$COSMIC_EPOCH_DIR"/*/target "$STAGING_DIR" 2>/dev/null || true
            log_ok "Nettoyage terminé."
            exit 0 ;;
        --deploy)
            MODE_DEPLOY=true; shift ;;
        --unmerge)
            MODE_UNMERGE=true; MODE_AUDIT=false; MODE_BUILD=false; shift ;;
        --test-session)
            MODE_TEST_SESSION=true; shift ;;
        -h|--help)
            show_help; exit 0 ;;
        *)
            log_error "Option inconnue : $1"
            show_help
            exit 1 ;;
    esac
done

# ------------------------------------------------------------------------------
# Action: Unmerge if requested
# ------------------------------------------------------------------------------
if [[ "$MODE_UNMERGE" == "true" ]]; then
    log_section "Démontage de l'extension systemd-sysext"
    if [[ $EUID -ne 0 ]]; then
        log_info "Élévation de privilèges requise pour systemd-sysext unmerge..."
        sudo systemd-sysext unmerge
    else
        systemd-sysext unmerge
    fi
    log_ok "Extension démontée. L'arborescence /usr de base est restaurée."
    exit 0
fi

# ------------------------------------------------------------------------------
# Validation des Prérequis Hôte
# ------------------------------------------------------------------------------
log_section "1. Vérification de l'environnement hôte"

if [[ ! -d "$STAGING_DIR" ]]; then
    log_error "Le répertoire de staging n'existe pas : $STAGING_DIR"
    exit 1
fi

if [[ ! -d "$STAGING_DIR/usr" ]]; then
    log_error "L'arborescence $STAGING_DIR/usr est introuvable."
    exit 1
fi

log_ok "Staging directory détecté : $STAGING_DIR"

# Vérification des outils nécessaires
MISSING_TOOLS=()
for tool in mksquashfs ldd systemd-sysext; do
    if ! command -v "$tool" &>/dev/null; then
        MISSING_TOOLS+=("$tool")
    fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
    log_error "Outils manquants sur l'hôte : ${MISSING_TOOLS[*]}"
    log_info "Installez-les via : sudo apt-get update && sudo apt-get install -y squashfs-tools systemd"
    exit 1
fi
log_ok "Tous les outils essentiels sont installés (mksquashfs, ldd, systemd-sysext)."

# Extraction des métadonnées de l'OS hôte
HOST_OS_RELEASE="/etc/os-release"
if [[ ! -f "$HOST_OS_RELEASE" ]]; then
    log_error "Fichier $HOST_OS_RELEASE introuvable sur le système hôte."
    exit 1
fi

# shellcheck disable=SC1090
source "$HOST_OS_RELEASE"
HOST_ID="${ID:-ubuntu}"
HOST_VERSION_ID="${VERSION_ID:-24.04}"
HOST_SYSEXT_LEVEL="${SYSEXT_LEVEL:-}"

# Normalisation de l'architecture pour systemd (x86-64 avec trait d'union)
RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
    x86_64)  HOST_ARCH="x86-64" ;;
    aarch64) HOST_ARCH="arm64" ;;
    arm*)    HOST_ARCH="arm" ;;
    *)       HOST_ARCH="$RAW_ARCH" ;;
esac

log_info "OS Hôte détecté : ID=$HOST_ID, VERSION_ID=$HOST_VERSION_ID, ARCH=$HOST_ARCH (systemd)"

# ------------------------------------------------------------------------------
# Stage 1: Audit d'Intégrité & Dépendances
# ------------------------------------------------------------------------------
if [[ "$MODE_AUDIT" == "true" ]]; then
    log_section "2. Audit d'intégrité et dépendances dynamiques"

    TOTAL_BINARIES=0
    TOTAL_MISSING=0
    MISSING_REPORT=()

    # 1. Audit des binaires ELF dans usr/bin, usr/libexec et plugins pop-launcher
    log_info "Analyse des dépendances dynamiques (ldd) sur les exécutables..."
    
    SEARCH_PATHS=(
        "$STAGING_DIR/usr/bin"
        "$STAGING_DIR/usr/libexec"
        "$STAGING_DIR/usr/lib/pop-launcher/plugins"
    )

    for search_dir in "${SEARCH_PATHS[@]}"; do
        if [[ ! -d "$search_dir" ]]; then continue; fi

        while IFS= read -r -d '' binary; do
            if [[ -f "$binary" && -x "$binary" && ! -L "$binary" ]]; then
                # Vérifier s'il s'agit bien d'un binaire ELF
                if file "$binary" | grep -q "ELF"; then
                    TOTAL_BINARIES=$((TOTAL_BINARIES + 1))
                    missing_libs=$(ldd "$binary" 2>&1 | grep "not found" || true)
                    if [[ -n "$missing_libs" ]]; then
                        TOTAL_MISSING=$((TOTAL_MISSING + 1))
                        MISSING_REPORT+=("Binaire: $binary\n$missing_libs")
                    fi
                fi
            fi
        done < <(find "$search_dir" -maxdepth 2 -type f -print0)
    done

    log_info "Total binaires ELF analysés : $TOTAL_BINARIES"
    if [[ $TOTAL_MISSING -eq 0 ]]; then
        log_ok "Aucune bibliothèque dynamique manquante sur le système hôte (0 missing .so)."
    else
        log_warn "Attention : $TOTAL_MISSING binaire(s) présentent des bibliothèques manquantes :"
        for report in "${MISSING_REPORT[@]}"; do
            printf "${C_YELLOW}%b${C_RESET}\n" "$report"
        done
    fi

    # 2. Audit des services D-Bus
    log_info "Vérification des fichiers de services D-Bus..."
    DBUS_DIR="$STAGING_DIR/usr/share/dbus-1/services"
    DBUS_COUNT=0
    DBUS_INVALID=0
    if [[ -d "$DBUS_DIR" ]]; then
        for sfile in "$DBUS_DIR"/*.service; do
            [[ -e "$sfile" ]] || break
            DBUS_COUNT=$((DBUS_COUNT + 1))
            exec_line=$(grep -E "^Exec=" "$sfile" | cut -d'=' -f2 | awk '{print $1}' || true)
            # Remplacement du préfixe /usr par le staging pour le test d'existence locale
            local_bin="${exec_line/#\/usr/$STAGING_DIR\/usr}"
            if [[ ! -f "$local_bin" && ! -x "$local_bin" && ! -L "$local_bin" ]]; then
                log_warn "Service D-Bus $sfile : binaire cible introuvable ($exec_line)"
                DBUS_INVALID=$((DBUS_INVALID + 1))
            fi
        done
        log_ok "$DBUS_COUNT services D-Bus inspectés ($DBUS_INVALID avertissement(s))."
    else
        log_warn "Répertoire D-Bus non trouvé : $DBUS_DIR"
    fi

    # 3. Audit des fichiers .desktop
    log_info "Vérification des entrées Desktop et sessions Wayland..."
    WAYLAND_SESSION_FILE="$STAGING_DIR/usr/share/wayland-sessions/cosmic.desktop"
    if [[ -f "$WAYLAND_SESSION_FILE" ]]; then
        log_ok "Entrée de session Wayland valide : $WAYLAND_SESSION_FILE"
        exec_target=$(grep -E "^Exec=" "$WAYLAND_SESSION_FILE" | cut -d'=' -f2)
        local_exec="${exec_target/#\/usr/$STAGING_DIR\/usr}"
        if [[ -x "$local_exec" ]]; then
            log_ok "Exécutable de session Wayland vérifié : $exec_target"
        else
            log_warn "L'exécutable de session Wayland n'est pas exécutable : $local_exec"
        fi
    else
        log_warn "Entrée wayland-sessions/cosmic.desktop manquante !"
    fi

    # 4. Audit des unités Systemd user
    log_info "Vérification des unités systemd user..."
    SYSTEMD_USER_DIR="$STAGING_DIR/usr/lib/systemd/user"
    if [[ -f "$SYSTEMD_USER_DIR/cosmic-session.target" ]]; then
        log_ok "Cible systemd user présente : $SYSTEMD_USER_DIR/cosmic-session.target"
    else
        log_warn "Unité $SYSTEMD_USER_DIR/cosmic-session.target manquante !"
    fi

    # 5. Audit des règles Polkit
    log_info "Vérification des règles et actions Polkit..."
    POLKIT_RULES_DIR="$STAGING_DIR/usr/share/polkit-1/rules.d"
    POLKIT_ACTIONS_DIR="$STAGING_DIR/usr/share/polkit-1/actions"
    if [[ -d "$POLKIT_RULES_DIR" ]]; then
        rules_count=$(find "$POLKIT_RULES_DIR" -type f | wc -l)
        log_ok "$rules_count règle(s) Polkit trouvée(s) dans $POLKIT_RULES_DIR"
    fi
    if [[ -d "$POLKIT_ACTIONS_DIR" ]]; then
        actions_count=$(find "$POLKIT_ACTIONS_DIR" -type f | wc -l)
        log_ok "$actions_count action(s) Polkit trouvée(s) dans $POLKIT_ACTIONS_DIR"
    fi
fi

# ------------------------------------------------------------------------------
# Stage 2: Préparation de l'identification extension-release
# ------------------------------------------------------------------------------
if [[ "$MODE_BUILD" == "true" ]]; then
    log_section "3. Génération des métadonnées extension-release"

    EXT_REL_DIR="$STAGING_DIR/usr/lib/extension-release.d"
    mkdir -p "$EXT_REL_DIR"

    TARGET_RELEASE_FILE="$EXT_REL_DIR/extension-release.${IMAGE_NAME}"

    log_info "Génération du fichier de compatibilité : $TARGET_RELEASE_FILE"

    {
        echo "ID=${HOST_ID}"
        if [[ -n "$HOST_SYSEXT_LEVEL" ]]; then
            echo "SYSEXT_LEVEL=${HOST_SYSEXT_LEVEL}"
        else
            echo "VERSION_ID=\"${HOST_VERSION_ID}\""
        fi
        echo "ARCHITECTURE=${HOST_ARCH}"
        echo "NAME=\"COSMIC Epoch Desktop Environment\""
        echo "SYSEXT_SCOPE=\"system\""
    } > "$TARGET_RELEASE_FILE"

    # Symlink pour compatibilité alternative si l'image est nommée différemment
    ln -sf "extension-release.${IMAGE_NAME}" "$EXT_REL_DIR/extension-release.cosmic-sysext"

    log_ok "extension-release créé et vérifié :"
    sed 's/^/  [release] /' "$TARGET_RELEASE_FILE"

    # --------------------------------------------------------------------------
    # Stage 3: Normalisation des permissions de fichiers
    # --------------------------------------------------------------------------
    log_section "4. Normalisation des permissions et attributs POSIX"

    log_info "Application des permissions standard (0755 dossiers/binaires, 0644 fichiers)..."
    
    # 1. Tous répertoires en 0755
    find "$STAGING_DIR/usr" -type d -exec chmod 755 {} +

    # 2. Tous fichiers réguliers en 0644 par défaut
    find "$STAGING_DIR/usr" -type f -exec chmod 644 {} +

    # 3. Binaires et scripts exécutables en 0755
    if [[ -d "$STAGING_DIR/usr/bin" ]]; then
        find "$STAGING_DIR/usr/bin" -type f -exec chmod 755 {} +
    fi
    if [[ -d "$STAGING_DIR/usr/libexec" ]]; then
        find "$STAGING_DIR/usr/libexec" -type f -exec chmod 755 {} +
    fi
    if [[ -d "$STAGING_DIR/usr/lib/pop-launcher/plugins" ]]; then
        find "$STAGING_DIR/usr/lib/pop-launcher/plugins" -type f -exec chmod 755 {} +
    fi

    # 4. Règles Polkit : fichiers en 0644, dossier rules.d en 0700 pour conformité polkitd
    if [[ -d "$STAGING_DIR/usr/share/polkit-1/rules.d" ]]; then
        chmod 700 "$STAGING_DIR/usr/share/polkit-1/rules.d"
        find "$STAGING_DIR/usr/share/polkit-1/rules.d" -type f -exec chmod 644 {} +
    fi

    log_ok "Permissions POSIX normalisées avec succès."

    # --------------------------------------------------------------------------
    # Stage 4: Empaquetage SquashFS Optimisé
    # --------------------------------------------------------------------------
    log_section "5. Construction de l'image SquashFS"

    mkdir -p "$OUTPUT_DIR"
    OUTPUT_IMAGE="$OUTPUT_DIR/${IMAGE_NAME}.raw"

    log_info "Compression : $COMPRESSION (niveau $DEFAULT_ZSTD_LEVEL, block-size $DEFAULT_BLOCK_SIZE)"
    log_info "Destination : $OUTPUT_IMAGE"

    MKSQUASHFS_ARGS=(
        "$STAGING_DIR"
        "$OUTPUT_IMAGE"
        -noappend
        -all-root
        -reproducible
        -b "$DEFAULT_BLOCK_SIZE"
        -wildcards
        -e "etc"
    )

    if [[ "$COMPRESSION" == "zstd" ]]; then
        MKSQUASHFS_ARGS+=(-comp zstd -Xcompression-level "$DEFAULT_ZSTD_LEVEL")
    elif [[ "$COMPRESSION" == "xz" ]]; then
        MKSQUASHFS_ARGS+=(-comp xz)
    elif [[ "$COMPRESSION" == "gzip" ]]; then
        MKSQUASHFS_ARGS+=(-comp gzip)
    fi

    log_info "Exécution de mksquashfs..."
    mksquashfs "${MKSQUASHFS_ARGS[@]}"

    IMAGE_SIZE_HUMAN=$(du -h "$OUTPUT_IMAGE" | cut -f1)
    IMAGE_SHA256=$(sha256sum "$OUTPUT_IMAGE" | cut -d' ' -f1)

    log_ok "Image systemd-sysext générée avec succès !"
    echo "------------------------------------------------------------------"
    echo "  Fichier     : $OUTPUT_IMAGE"
    echo "  Taille      : $IMAGE_SIZE_HUMAN"
    echo "  SHA256      : $IMAGE_SHA256"
    echo "  Format      : SquashFS ($COMPRESSION)"
    echo "------------------------------------------------------------------"
fi

# ------------------------------------------------------------------------------
# Stage 5: Déploiement et Test à Chaud (systemd-sysext)
# ------------------------------------------------------------------------------
if [[ "$MODE_DEPLOY" == "true" ]]; then
    log_section "6. Déploiement à chaud via systemd-sysext"

    EXT_SYS_DIR="/var/lib/extensions"
    DEPLOY_TARGET="$EXT_SYS_DIR/${IMAGE_NAME}.raw"

    # Vérification de la propagation de montage (WSL2 / conteneurs montent souvent / en private)
    ROOT_PROP=$(findmnt -n -o PROPAGATION / 2>/dev/null || echo "unknown")
    if [[ "$ROOT_PROP" == *"private"* ]]; then
        log_info "Mount propagation de / est 'private'. Passage en 'shared' pour propager l'overlay systemd-sysext..."
        if [[ $EUID -ne 0 ]]; then
            sudo mount --make-rshared /
        else
            mount --make-rshared /
        fi
    fi

    log_info "Liaison atomique (hardlink) de l'image vers $DEPLOY_TARGET..."
    if [[ $EUID -ne 0 ]]; then
        sudo mkdir -p "$EXT_SYS_DIR"
        sudo ln -f "$OUTPUT_IMAGE" "$DEPLOY_TARGET"
        sudo chmod 644 "$DEPLOY_TARGET"
        log_info "Activation du rafraîchissement d'extensions..."
        sudo systemd-sysext merge
        log_info "Statut du système d'extensions :"
        sudo systemd-sysext status
    else
        mkdir -p "$EXT_SYS_DIR"
        ln -f "$OUTPUT_IMAGE" "$DEPLOY_TARGET"
        chmod 644 "$DEPLOY_TARGET"
        systemd-sysext merge
        systemd-sysext status
    fi

    log_ok "Extension active ! Vérification des binaires dans /usr/bin :"
    which cosmic-session cosmic-comp cosmic-panel pop-launcher || true
fi

# ------------------------------------------------------------------------------
# Stage 6: Procédure de Test de Session Wayland
# ------------------------------------------------------------------------------
if [[ "$MODE_TEST_SESSION" == "true" || "$MODE_DEPLOY" == "true" ]]; then
    log_section "7. Procédure de validation de session Wayland (cosmic-session)"

    cat << 'EOF'
Pour lancer et tester la session COSMIC Epoch sans risque pour l'OS hôte :

1. Recharger les définitions d'unités de l'utilisateur :
   systemctl --user daemon-reload

2. Vérifier l'accès à la session Wayland :
   cat /usr/share/wayland-sessions/cosmic.desktop

3. Lancement interactif (depuis un TTY ou sous WSL avec WSLg) :
   export XDG_CURRENT_DESKTOP="COSMIC"
   export XDG_SESSION_DESKTOP="COSMIC"
   export XDG_SESSION_TYPE="wayland"
   /usr/bin/start-cosmic

4. Pour démonter proprement et revenir à l'OS hôte vierge :
   sudo systemd-sysext unmerge
EOF
fi

log_section "Fin d'exécution"
log_ok "Automatisation terminée."
