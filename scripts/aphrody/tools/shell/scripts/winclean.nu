# SPDX-License-Identifier: Apache-2.0
# WinClean maintenance pipeline (Nushell 0.115+, Windows), the single owner since the PowerShell
# twin was retired. System changes go through native executables (reg, sc, fsutil, bcdedit,
# defrag, powercfg) without a console window of their own; the working-set trim is the WinClean
# kernel tool `perf_empty_working_sets`. Elevation: `sudo nu scripts/tools/shell/scripts/winclean.nu`.
# `--dry-run` prints every action without changing anything.

# One native command: printed with --dry-run, otherwise run and reported. Returns success.
def step [dry: bool, label: string, ...argv: string]: nothing -> bool {
    if $dry {
        print $"  (ansi grey)[plan] ($label): ($argv | str join ' ')(ansi reset)"
        return true
    }
    let result = (run-external ...$argv | complete)
    if $result.exit_code == 0 {
        print $"  (ansi green)-> ($label)(ansi reset)"
        true
    } else {
        let reason = ($result.stderr + $result.stdout | str trim | lines | first 1 | str join)
        print $"  (ansi red)x ($label) \(exit ($result.exit_code)\): ($reason)(ansi reset)"
        false
    }
}

def exists-service [name: string]: nothing -> bool {
    (^sc.exe query $name | complete).exit_code == 0
}

def set-dword [dry: bool, key: string, name: string, value: int]: nothing -> bool {
    step $dry $"($key)\\($name)=($value)" reg add $key /v $name /t REG_DWORD /d ($value | into string) /f
}

# Stops (best effort: an already stopped service is fine) and disables an existing service.
def disable-service [dry: bool, name: string]: nothing -> bool {
    if not (exists-service $name) { return true }
    if not $dry { ^sc.exe stop $name | complete | ignore }
    step $dry $"service ($name) désactivé" sc.exe config $name "start=" disabled
}

def main [
    --skip-index (-s) # Ne pas réindexer le disque C
    --dry-run (-n) # Afficher les actions sans rien modifier
] {
    if not $dry_run and not (is-admin) {
        error make { msg: "WinClean modifie HKLM, les services et le BCD : relancer élevé (sudo nu scripts/tools/shell/scripts/winclean.nu) ou avec --dry-run." }
    }
    let dry = $dry_run
    mut ok = []

    print $"(ansi cyan_bold)=========================================================="
    print "   APHRODY SHELL :: WINCLEAN PIPELINE (NUSHELL)"
    print $"==========================================================(ansi reset)"

    # 1. STOCKAGE. Les caches Rust (registre Cargo, sccache) restent chauds : les purger force
    # des builds à froid qui saturent le poste pendant la recompilation du monorepo.
    print $"\n(ansi yellow)[*] Phase 1: Purge des dossiers Temp et artefacts OTA...(ansi reset)"
    let cutoff = ((date now) - 1day)
    for dir in [$env.TEMP, ($env.SystemRoot | path join "Temp")] {
        if ($dir | path exists) {
            # Entrées de plus d'un jour seulement : les fichiers des processus actifs restent.
            let stale = (try { ls --all $dir | where modified < $cutoff } catch { [] })
            if $dry {
                print $"  (ansi grey)[plan] ($stale | length) entrées anciennes dans ($dir)(ansi reset)"
            } else {
                for entry in $stale { try { rm --recursive --force $entry.name } }
                print $"  (ansi green)-> Temp purgé : ($dir)(ansi reset)"
            }
        }
    }
    print $"  (ansi grey)-> Caches Cargo et sccache conservés(ansi reset)"
    let nv_ota = "C:/ProgramData/NVIDIA Corporation/NVIDIA app/UpdateFramework/ota-artifacts"
    if ($nv_ota | path exists) {
        if $dry { print $"  (ansi grey)[plan] supprimer ($nv_ota)(ansi reset)" } else {
            rm --recursive --force $nv_ota
            print $"  (ansi green)-> Paquets de pilotes NVIDIA OTA supprimés(ansi reset)"
        }
    }
    $ok = ($ok | append (step $dry "Hibernation désactivée (hiberfil.sys)" powercfg /h off))

    # 2. SYSTÈME, NTFS, BOOT
    print $"\n(ansi yellow)[*] Phase 2: NTFS, mémoire, boot et TRIM...(ansi reset)"
    $ok = ($ok | append (step $dry "NTFS : last-access désactivé" fsutil behavior set disablelastaccess 1))
    $ok = ($ok | append (step $dry "NTFS : noms 8.3 désactivés sur C:" fsutil 8dot3name set C: 1))
    let memory = 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'
    $ok = ($ok | append (set-dword $dry $memory DisablePagingExecutive 1))
    $ok = ($ok | append (set-dword $dry $memory LargeSystemCache 0))
    $ok = ($ok | append (set-dword $dry 'HKLM\SYSTEM\CurrentControlSet\Control\PriorityControl' Win32PrioritySeparation 38))
    $ok = ($ok | append (step $dry "Boot : délai BCD à 3 s" bcdedit /timeout 3))
    $ok = ($ok | append (step $dry "TRIM SSD sur C:" defrag C: /L))

    # 3. DÉMARRAGE ET SERVICES PARASITES
    print $"\n(ansi yellow)[*] Phase 3: Démarrage automatique et télémétrie...(ansi reset)"
    let run_key = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
    for app in ["EADM", "Discord", "NVIDIA Broadcast"] {
        if (^reg query $run_key /v $app | complete).exit_code == 0 {
            $ok = ($ok | append (step $dry $"Run HKCU retiré : ($app)" reg delete $run_key /v $app /f))
        }
    }
    let parasites = [
        IntelTelemetryAgent SystemUsageReportSvc_QUEENCREEK IntelCollectorService
        ESRV_SVC_QUEENCREEK DSAService DSAUpdateService IpOverUsbSvc
    ]
    for service in $parasites { $ok = ($ok | append (disable-service $dry $service)) }

    # 4. MISES À JOUR AUTOMATIQUES
    print $"\n(ansi yellow)[*] Phase 4: Mises à jour automatiques...(ansi reset)"
    let updaters = [
        wuauserv edgeupdate edgeupdatem gupdate gupdatem
        GoogleUpdaterInternalService156.0.8067.0 GoogleUpdaterService156.0.8067.0
        battlenet_helpersvc "Denuvo Anti-Cheat Update Service" LGHUBUpdaterService
    ]
    for service in $updaters { $ok = ($ok | append (disable-service $dry $service)) }
    let wu = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
    $ok = ($ok | append (set-dword $dry $wu NoAutoUpdate 1))
    $ok = ($ok | append (set-dword $dry $wu AUOptions 2))
    $ok = ($ok | append (set-dword $dry 'HKLM\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization' DODownloadMode 0))

    # 5. RECHERCHE ET INDEX DISQUE
    if not $skip_index {
        print $"\n(ansi yellow)[*] Phase 5: Windows Search et index de C:...(ansi reset)"
        $ok = ($ok | append (step $dry "Windows Search automatique" sc.exe config wsearch "start=" auto))
        if not $dry { ^sc.exe start wsearch | complete | ignore }
        $ok = ($ok | append (set-dword $dry 'HKLM\SOFTWARE\Microsoft\Windows Search\Gathering Manager' DisableBackOff 1))
        $ok = ($ok | append (set-dword $dry 'HKLM\SOFTWARE\Microsoft\Windows Search' EnableEnhancedSearch 1))
        let fd_bin = ($env.USERPROFILE | path join ".cargo" "bin" "fd.exe")
        if ($fd_bin | path exists) {
            let out_file = "C:/tmp/disk_c_index.txt"
            if $dry { print $"  (ansi grey)[plan] index de C: dans ($out_file)(ansi reset)" } else {
                mkdir ($out_file | path dirname)
                ^$fd_bin -c never -H -I -a --base-directory 'C:\' . | save --force $out_file
                print $"  (ansi green)-> Index C: généré dans ($out_file)(ansi reset)"
            }
        }
    }

    # Mémoire : outil natif du catalogue WinClean, servi par le noyau Aphrody.
    if $dry {
        print $"  (ansi grey)[plan] aphrody kernel call perf_empty_working_sets(ansi reset)"
    } else {
        let trim = (^aphrody kernel call perf_empty_working_sets | complete)
        if $trim.exit_code == 0 {
            print $"\n(ansi green)[+] Working sets réduits \(perf_empty_working_sets\).(ansi reset)"
        } else {
            print $"\n(ansi yellow)[!] Working sets non réduits : noyau Aphrody non servi \(aphrody kernel serve\).(ansi reset)"
        }
    }

    let failed = ($ok | where {|it| not $it } | length)
    print $"\n(ansi cyan_bold)=========================================================="
    if $failed == 0 {
        print "   WINCLEAN PIPELINE TERMINÉ"
        print $"==========================================================(ansi reset)"
    } else {
        print $"   WINCLEAN : ($failed) étape\(s\) en échec"
        print $"==========================================================(ansi reset)"
        exit 1
    }
}
