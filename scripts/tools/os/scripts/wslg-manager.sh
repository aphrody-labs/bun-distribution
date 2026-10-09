#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Aphrody OS Contributors
#
# wslg-manager.sh: Diagnostic, inspection, et orchestration de l'intégration WSLg
# (Windows Subsystem for Linux GUI) pour Aphrody OS et COSMIC Epoch.

set -eo pipefail

C_RESET='\033[0m'
C_CYAN='\033[1;36m'
C_GREEN='\033[1;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[1;31m'
C_BOLD='\033[1m'

log_info()    { printf "${C_CYAN}[INFO]${C_RESET} %s\n" "$*"; }
log_ok()      { printf "${C_GREEN}[OK]${C_RESET} %s\n" "$*"; }
log_warn()    { printf "${C_YELLOW}[WARN]${C_RESET} %s\n" "$*"; }
log_err()     { printf "${C_RED}[ERR]${C_RESET} %s\n" "$*"; }
log_section() { printf "\n${C_BOLD}=== %s ===${C_RESET}\n" "$*"; }

show_help() {
    cat << 'EOF'
Usage: wslg-manager.sh [options] [command]

Commandes :
  status             Affiche le diagnostic complet de l'infrastructure WSLg (défaut)
  gpu                Analyse approfondie de l'accélération matérielle GPU (D3D12, CUDA, Mesa)
  logs               Inspecte les journaux d'événements Weston, PulseAudio et WSLGd
  run <app> [args]   Lance une application Wayland/COSMIC avec l'environnement WSLg optimal
  desktop            Affiche les instructions pour le mode bureau complet (wslg_desktop.rdp)
  json               Exporte l'état complet de WSLg sous forme de document JSON

Options :
  -h, --help         Affiche cette aide
  -v, --verbose      Mode verbeux avec détails des sockets et bibliothèques
EOF
}

check_wslg_mounts() {
    if [[ ! -d "/mnt/wslg" ]]; then
        log_err "/mnt/wslg n'est pas monté ! Ce script doit s'exécuter dans un environnement WSL2 avec WSLg actif."
        exit 1
    fi
}

cmd_status() {
    log_section "1. État Général de WSLg"
    
    if [[ -f "/mnt/wslg/versions.txt" ]]; then
        log_ok "Fichier de version détecté :"
        while IFS= read -r line; do
            [[ -n "$line" ]] && printf "  [version] %s\n" "$line"
        done < "/mnt/wslg/versions.txt"
    else
        log_warn "Fichier /mnt/wslg/versions.txt introuvable."
    fi

    log_section "2. Sockets de Communication Inter-Systèmes"
    
    # Wayland
    WAYLAND_SOCK="/mnt/wslg/runtime-dir/wayland-0"
    if [[ -S "$WAYLAND_SOCK" ]]; then
        log_ok "Socket Wayland actif : $WAYLAND_SOCK"
    else
        log_err "Socket Wayland absent : $WAYLAND_SOCK"
    fi

    # PulseAudio
    PULSE_SOCK="/mnt/wslg/PulseServer"
    if [[ -S "$PULSE_SOCK" ]]; then
        log_ok "Serveur audio PulseAudio actif : $PULSE_SOCK"
    else
        log_warn "Socket PulseAudio absent : $PULSE_SOCK"
    fi

    # X11
    X11_SOCK="/mnt/wslg/.X11-unix/X0"
    if [[ -S "$X11_SOCK" ]]; then
        log_ok "Serveur Xwayland actif : DISPLAY=:0 ($X11_SOCK)"
    else
        log_warn "Socket X11 absent : $X11_SOCK"
    fi

    log_section "3. Accélération Graphique & GPU Passthrough"
    
    # Device node
    if [[ -c "/dev/dxg" ]]; then
        log_ok "Pilote noyau DirectX actif (/dev/dxg présent)"
    else
        log_warn "Périphérique /dev/dxg absent (pilote dxgkrnl inactif ou non chargé)"
    fi

    # D3D12 UMD
    D3D12_LIB="/usr/lib/wsl/lib/libd3d12.so"
    if [[ -f "$D3D12_LIB" ]]; then
        log_ok "Bibliothèque D3D12 mappée : $D3D12_LIB"
    else
        log_warn "Bibliothèque $D3D12_LIB non trouvée sous /usr/lib/wsl/lib"
    fi

    # CUDA
    if command -v nvidia-smi >/dev/null 2>&1; then
        GPU_NAME=$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || echo "Inconnu")
        log_ok "NVIDIA GPU détecté via CUDA UMD : $GPU_NAME"
    fi

    log_section "4. Intégration Desktop & Applications COSMIC"
    if command -v cosmic-session >/dev/null 2>&1; then
        log_ok "Environnement COSMIC Epoch détecté dans /usr/bin"
    else
        log_info "COSMIC Epoch absent : apt install cosmic-session (dépôt apt.pop-os.org, tools/config/os/wsl-build.json) ; sur Aphrody Alpine : apk add aphrody-desktop-cosmic"
    fi
}

cmd_gpu() {
    log_section "Inspection Détaillée de l'Accélération Matérielle"
    
    log_info "Recherche des modules et pilotes sous /usr/lib/wsl/lib :"
    if [[ -d "/usr/lib/wsl/lib" ]]; then
        ls -lh /usr/lib/wsl/lib | grep -E "lib(d3d12|cuda|dxcore|nvidia)" || true
    fi

    log_info "Périphérique noyau DirectX Graphics (/dev/dxg) :"
    ls -l /dev/dxg 2>/dev/null || echo "Non disponible"

    log_info "Interrogation de la carte graphique hôte via nvidia-smi :"
    if command -v nvidia-smi >/dev/null 2>&1; then
        nvidia-smi
    else
        log_info "nvidia-smi non disponible dans le PATH utilisateur."
    fi

    log_info "Interrogation de Vulkan via vulkaninfo :"
    if command -v vulkaninfo >/dev/null 2>&1; then
        vulkaninfo --summary 2>/dev/null | grep -E -A 10 "Devices:|GPU0:" || true
    fi
}

cmd_logs() {
    log_section "Derniers événements Weston (/mnt/wslg/weston.log)"
    if [[ -f "/mnt/wslg/weston.log" ]]; then
        tail -n 35 "/mnt/wslg/weston.log"
    else
        log_err "Journal Weston introuvable."
    fi

    log_section "Derniers événements PulseAudio (/mnt/wslg/pulseaudio.log)"
    if [[ -f "/mnt/wslg/pulseaudio.log" ]]; then
        tail -n 15 "/mnt/wslg/pulseaudio.log"
    fi

    if [[ -f "/mnt/wslg/stderr.log" && -s "/mnt/wslg/stderr.log" ]]; then
        log_section "Erreurs WSLg stderr (/mnt/wslg/stderr.log)"
        cat "/mnt/wslg/stderr.log"
    fi
}

cmd_run() {
    if [[ $# -eq 0 ]]; then
        log_err "Spécifiez une commande ou un exécutable à lancer. Exemple: $0 run cosmic-term"
        exit 1
    fi

    local target_app="$1"
    shift

    # Configuration optimisée des variables d'environnement Wayland & WSLg
    export WAYLAND_DISPLAY="wayland-0"
    export DISPLAY=":0"
    export PULSE_SERVER="unix:/mnt/wslg/PulseServer"
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    export GDK_BACKEND="wayland,x11"
    export QT_QPA_PLATFORM="wayland;xcb"
    export MOZ_ENABLE_WAYLAND="1"
    export MESA_D3D12_DEFAULT_ADAPTER_NAME="NVIDIA"
    export LIBGL_ALWAYS_SOFTWARE="0"

    log_info "Lancement de '$target_app' avec l'environnement Wayland/WSLg..."
    exec "$target_app" "$@"
}

cmd_desktop() {
    log_section "Mode Bureau Complet WSLg (Full Desktop Mode)"
    cat << 'EOF'
WSLg propose deux modes d'intégration RDP avec Windows :

1. Mode RAIL/VAIL (Par défaut - Fenêtres individuelles) :
   - Profil RDP : C:\Program Files\WSL\wslg.rdp (remoteapplicationmode:i:1)
   - Chaque application Wayland/X11 devient une fenêtre Windows native (HWND).
   - Idéal pour exécuter cosmic-term, cosmic-files, cosmic-edit de façon transparente.

2. Mode Bureau Complet (Session COSMIC / Wayland intégrée) :
   - Profil RDP : C:\Program Files\WSL\wslg_desktop.rdp (sans remoteapplicationmode)
   - Ouvre une session Bureau distant Windows complète contenant l'ensemble de l'écran.
   - Pour lancer COSMIC Desktop complet dans une fenêtre de bureau dédiée :
     mstsc.exe "C:\Program Files\WSL\wslg_desktop.rdp"
EOF
}

cmd_json() {
    check_wslg_mounts
    
    local wslg_version="unknown"
    local azure_linux="unknown"
    if [[ -f "/mnt/wslg/versions.txt" ]]; then
        wslg_version=$(grep -i "WSLg" /mnt/wslg/versions.txt | head -n 1 | tr -d '"\r' || echo "unknown")
        azure_linux=$(grep -i "Azure Linux" /mnt/wslg/versions.txt | head -n 1 | tr -d '"\r' || echo "unknown")
    fi

    local wayland_active=false
    [[ -S "/mnt/wslg/runtime-dir/wayland-0" ]] && wayland_active=true

    local pulse_active=false
    [[ -S "/mnt/wslg/PulseServer" ]] && pulse_active=true

    local dxg_present=false
    [[ -c "/dev/dxg" ]] && dxg_present=true

    local d3d12_present=false
    [[ -f "/usr/lib/wsl/lib/libd3d12.so" ]] && d3d12_present=true

    cat << EOF
{
  "wslg": {
    "version": "$wslg_version",
    "systemDistro": "$azure_linux",
    "sockets": {
      "wayland": $wayland_active,
      "pulseaudio": $pulse_active,
      "x11": true
    },
    "gpu": {
      "dxgDriver": $dxg_present,
      "d3d12Library": $d3d12_present
    }
  }
}
EOF
}

# --- Point d'Entrée Principal ---
check_wslg_mounts

ACTION="${1:-status}"
shift || true

case "$ACTION" in
    status) cmd_status ;;
    gpu)    cmd_gpu ;;
    logs)   cmd_logs ;;
    run)    cmd_run "$@" ;;
    desktop) cmd_desktop ;;
    json)   cmd_json ;;
    -h|--help) show_help ;;
    *)
        log_err "Action inconnue: $ACTION"
        show_help
        exit 1
        ;;
esac
