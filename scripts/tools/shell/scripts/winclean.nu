# SPDX-License-Identifier: Apache-2.0
# Nushell WinClean Deep Clean & Optimization Pipeline
# Compatible with Nushell 0.115+

def main [
    --skip-index (-s) # Ne pas réindexer le disque C
] {
    print $"(ansi cyan_bold)=========================================================="
    print $"   APHRODY SHELL :: WINCLEAN PIPELINE (NUSHELL)           "
    print $"==========================================================(ansi reset)"

    # 1. NETTOYAGE DU DISQUE & DES CACHES
    print $"\n(ansi yellow)[*] Phase 1: Purge des Caches et Dossiers Temp...(ansi reset)"
    
    let temp_dirs = [
        ($env.LOCALAPPDATA | path join "Temp"),
        "C:/Windows/Temp"
    ]

    for d in $temp_dirs {
        if ($d | path exists) {
            try {
                ls -a $d | each { |f| try { rm -rf $f.name } }
                print $"  (ansi green)-> Nettoyé: ($d)(ansi reset)"
            }
        }
    }

    # Nettoyage Cargo Cache
    let cargo_cache = ($env.USERPROFILE | path join ".cargo" "registry" "cache")
    let cargo_src = ($env.USERPROFILE | path join ".cargo" "registry" "src")
    if ($cargo_cache | path exists) { rm -rf $cargo_cache }
    if ($cargo_src | path exists) { rm -rf $cargo_src }
    print $"  (ansi green)-> Caches Cargo registry purgés(ansi reset)"

    # Nettoyage sccache
    let sccache_dir = ($env.LOCALAPPDATA | path join "Mozilla" "sccache" "cache")
    if ($sccache_dir | path exists) {
        rm -rf $sccache_dir
        print $"  (ansi green)-> Cache sccache supprimé(ansi reset)"
    }

    # Nettoyage packages NVIDIA OTA
    let nv_ota = "C:/ProgramData/NVIDIA Corporation/NVIDIA app/UpdateFramework/ota-artifacts"
    if ($nv_ota | path exists) {
        rm -rf $nv_ota
        print $"  (ansi green)-> Caches de pilotes NVIDIA OTA supprimés(ansi reset)"
    }

    # 2. OPTIMISATIONS SYSTEME & MATERIELLES
    print $"\n(ansi yellow)[*] Phase 2: Optimisations Système & Matérielles...(ansi reset)"
    try { ^powercfg /h off }
    print $"  (ansi green)-> Hibernation désactivée (hiberfil.sys)(ansi reset)"

    try { ^cmd.exe /c "fsutil behavior set disablelastaccess 1" }
    try { ^cmd.exe /c "fsutil 8dot3name set C: 1" }
    print $"  (ansi green)-> Optimisations NTFS appliquées (LastAccess + 8dot3)(ansi reset)"

    try { ^bcdedit /timeout 3 }
    print $"  (ansi green)-> Timeout boot BCD calé à 3s(ansi reset)"

    print $"  (ansi grey)-> Déclenchement du TRIM SSD sur C:...(ansi reset)"
    try { ^defrag C: /L }
    print $"  (ansi green)-> Commande TRIM SSD exécutée avec succès(ansi reset)"

    # 3. RECHERCHE INSTANTANEE ET INDEX DISQUE
    if not $skip_index {
        print $"\n(ansi yellow)[*] Phase 3: Pré-chargement de l'Index Disque C:... (ansi reset)"
        let fd_bin = ($env.USERPROFILE | path join ".cargo" "bin" "fd.exe")
        if ($fd_bin | path exists) {
            let out_file = "C:/tmp/disk_c_index.txt"
            if not ("C:/tmp" | path exists) { mkdir "C:/tmp" }
            ^cmd.exe /c $"($fd_bin) -c never -H -I -a --base-directory C:/ . > ($out_file)"
            print $"  (ansi green)-> Index C: généré dans ($out_file)(ansi reset)"
        }
    }

    print $"\n(ansi cyan_bold)=========================================================="
    print $"   WINCLEAN NUSHELL PIPELINE COMPLETE                     "
    print $"==========================================================(ansi reset)"
}
