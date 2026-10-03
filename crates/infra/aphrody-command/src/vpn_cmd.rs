// SPDX-License-Identifier: Apache-2.0
//! `aphrody vpn` — Command-line interface for native Mullvad VPN management.

use std::path::PathBuf;

use aphrody_vpn::{MullvadController, TunnelState};
use clap::Subcommand;
use miette::IntoDiagnostic;

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum VpnAction {
    /// Afficher le statut actuel du tunnel Mullvad VPN et du proxy VPS US.
    Status {
        /// Format de sortie JSON.
        #[arg(long)]
        json: bool,
    },
    /// Connecter le VPN local Mullvad (optionnellement cibler un pays/serveur, ex: 'us', 'ch',
    /// 'se').
    Connect {
        /// Code du pays ou relais cible (ex: 'us', 'ch').
        #[arg(long, short)]
        location: Option<String>,
    },
    /// Déconnecter le VPN local Mullvad.
    Disconnect,
    /// Assurer une connexion US / non-EEE (Mullvad local ou tunnel SSH VPS) pour agy.
    EnsureAgy,
    /// Gérer le tunnel SSH et le proxy SOCKS5 US hébergé sur le VPS.
    Proxy {
        /// Vérifier le statut du proxy SOCKS5 (127.0.0.1:1080)
        #[arg(long)]
        status: bool,
        /// Démarrer le tunnel SSH en arrière-plan
        #[arg(long, short = 'd')]
        daemon: bool,
        /// Arrêter le tunnel SSH
        #[arg(long)]
        stop: bool,
        /// Basculer le relais VPS (ex: --switch us)
        #[arg(long)]
        switch: Option<Option<String>>,
    },
    /// Piloter le routage US ciblé sur les applications (Chrome, Antigravity 2, AGY CLI).
    App {
        #[command(subcommand)]
        target: AppTarget,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum AppTarget {
    /// Lancer Google Gemini App en fenêtre PWA dédiée sous proxy SOCKS5 US
    Gemini {
        /// Invite ou URL optionnelle
        prompt: Option<String>,
    },
    /// Lancer AGY Desktop (Antigravity 2) sous proxy SOCKS5 US
    Desktop {
        /// Arguments supplémentaires pour Antigravity
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Lancer AGY CLI configuré sur le proxy SOCKS5 US (tunnel VPS)
    Agy {
        /// Arguments pour agy
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Configurer les raccourcis stricts (Gemini App, AGY Desktop, AGY CLI)
    Setup,
    /// Afficher le statut des 3 applications cibles et du tunnel US
    Status,
}

pub(crate) async fn run(action: VpnAction) -> miette::Result<()> {
    let controller_res = MullvadController::discover();

    match action {
        VpnAction::Status { json } => {
            let vps_proxy = aphrody_vpn::VpsProxyManager::check_proxy_alive(1080).await;

            if json {
                let local_state = match &controller_res {
                    Ok(c) => c.status().await.ok(),
                    Err(_) => None,
                };
                let out = serde_json::json!({
                    "mullvad_local": local_state,
                    "vps_proxy_us": vps_proxy,
                });
                println!("{}", serde_json::to_string_pretty(&out).into_diagnostic()?);
                return Ok(());
            }

            println!("=== [VPN / GÉO-BYPASS STATUS] ===");
            match controller_res {
                Ok(ref controller) => match controller.status().await {
                    Ok(status) => match status {
                        TunnelState::Connected { relay, location, ipv4, ipv6 } => {
                            println!("• Mullvad Local : CONNECTÉ");
                            println!("  Relais        : {relay}");
                            println!("  Localisation  : {location}");
                            if let Some(ip) = ipv4 {
                                println!("  IPv4          : {ip}");
                            }
                            if let Some(ip) = ipv6 {
                                println!("  IPv6          : {ip}");
                            }
                        },
                        TunnelState::Connecting => {
                            println!("• Mullvad Local : Connexion en cours...")
                        },
                        TunnelState::Disconnected => println!("• Mullvad Local : Déconnecté"),
                        TunnelState::Blocked(reason) => {
                            println!("• Mullvad Local : Bloqué ({reason})")
                        },
                        TunnelState::Unknown(raw) => println!("• Mullvad Local : État ({raw})"),
                    },
                    Err(e) => println!("• Mullvad Local : Erreur de statut ({e})"),
                },
                Err(_) => println!("• Mullvad Local : Non installé ou introuvable"),
            }

            println!("\n• Proxy VPS US (SSH 127.0.0.1:1080) :");
            match vps_proxy {
                Some(p) => {
                    println!("  État          : ACTIF");
                    println!("  URL           : {}", p.proxy_url);
                    println!(
                        "  Sortie        : {} ({})",
                        p.exit_country,
                        p.exit_city.as_deref().unwrap_or("?")
                    );
                    if let Some(ip) = p.exit_ip {
                        println!("  IP            : {ip}");
                    }
                },
                None => {
                    println!(
                        "  État          : Inactif ou non démarré (lancer `aphrody ssh proxy -d`)"
                    );
                },
            }
            println!("================================");
        },
        VpnAction::Connect { location } => {
            let controller =
                controller_res.map_err(|e| miette::miette!("Mullvad introuvable : {e}"))?;
            println!(
                "[VPN] Connexion en cours (cible: {:?})...",
                location.as_deref().unwrap_or("défaut")
            );
            controller
                .connect(location.as_deref())
                .await
                .map_err(|e| miette::miette!("Échec de connexion : {e}"))?;
            println!("[VPN] Connecté avec succès.");
        },
        VpnAction::Disconnect => {
            let controller =
                controller_res.map_err(|e| miette::miette!("Mullvad introuvable : {e}"))?;
            println!("[VPN] Déconnexion en cours...");
            controller
                .disconnect()
                .await
                .map_err(|e| miette::miette!("Échec de déconnexion : {e}"))?;
            println!("[VPN] Déconnecté avec succès.");
        },
        VpnAction::EnsureAgy => {
            println!("[VPN] Assurer une sortie US / non-EEE pour Google AI & agy...");
            match aphrody_vpn::ensure_us_connectivity_for_agy().await {
                Ok(Some(cfg)) => {
                    println!("[VPN] Prêt pour agy via Proxy VPS US !");
                    println!("  URL  : {}", cfg.proxy_url);
                    println!(
                        "  Pays : {} ({})",
                        cfg.exit_country,
                        cfg.exit_city.as_deref().unwrap_or("?")
                    );
                    if let Some(ip) = cfg.exit_ip {
                        println!("  IP   : {ip}");
                    }
                },
                Ok(None) => {
                    println!("[VPN] Prêt pour agy via le VPN local Mullvad (actif hors EEE).");
                },
                Err(e) => {
                    return Err(miette::miette!("Échec de préparation géo agy : {e}"));
                },
            }
        },
        VpnAction::Proxy { status, daemon, stop, switch } => {
            // Déléguer directement à aphrody_ssh::run
            let mut args = vec![
                "aphrody-ssh".to_string(),
                "proxy".to_string(),
                "--host".to_string(),
                "vps".to_string(),
            ];
            if status {
                args.push("--status".to_string());
            }
            if daemon {
                args.push("-d".to_string());
            }
            if stop {
                args.push("--stop".to_string());
            }
            if let Some(sw) = switch {
                args.push("--switch".to_string());
                if let Some(country) = sw {
                    args.push(country);
                }
            }
            aphrody_ssh::run_from_args(args).await.map_err(|e| miette::miette!("{e}"))?;
        },
        VpnAction::App { target } => match target {
            AppTarget::Gemini { prompt } => {
                println!("[App Proxy] Vérification du tunnel US VPS...");
                let cfg = aphrody_vpn::VpsProxyManager::ensure_vps_proxy_us(1080)
                    .await
                    .map_err(|e| miette::miette!("Échec tunnel US : {e}"))?;
                println!(
                    "[App Proxy] Tunnel US actif : {} ({})",
                    cfg.exit_country,
                    cfg.exit_city.as_deref().unwrap_or("?")
                );

                let chrome = find_chrome_path().ok_or_else(|| {
                    miette::miette!("Google Chrome introuvable (requis pour encapsuler Gemini App)")
                })?;
                println!("[App Proxy] Lancement de Gemini App via {}", cfg.proxy_url);

                let gemini_url = match prompt {
                    Some(p) => format!("https://gemini.google.com/app?q={}", p.replace(' ', "+")),
                    None => "https://gemini.google.com/app".to_string(),
                };

                let mut cmd = std::process::Command::new(chrome);
                cmd.arg(format!("--app={}", gemini_url));
                cmd.arg("--proxy-server=socks5://127.0.0.1:1080");
                // A dedicated profile on every platform: without it, a Chrome
                // already running would adopt this window into its own process
                // and silently drop `--proxy-server`, sending the traffic
                // outside the tunnel.
                cmd.arg(format!("--user-data-dir={}", gemini_app_profile_dir().display()));
                cmd.spawn()
                    .map_err(|e| miette::miette!("Échec du lancement de Gemini App : {e}"))?;
            },
            AppTarget::Desktop { args } => {
                println!("[App Proxy] Vérification du tunnel US VPS...");
                let cfg = aphrody_vpn::VpsProxyManager::ensure_vps_proxy_us(1080)
                    .await
                    .map_err(|e| miette::miette!("Échec tunnel US : {e}"))?;
                println!(
                    "[App Proxy] Tunnel US actif : {} ({})",
                    cfg.exit_country,
                    cfg.exit_city.as_deref().unwrap_or("?")
                );

                let ag = find_antigravity_path().ok_or_else(|| {
                    miette::miette!("AGY Desktop (Antigravity) introuvable sur la machine")
                })?;
                println!("[App Proxy] Lancement de AGY Desktop via {}", cfg.proxy_url);

                let mut cmd = std::process::Command::new(ag);
                cmd.arg("--proxy-server=socks5://127.0.0.1:1080");
                cmd.args(&args);
                cmd.env("HTTPS_PROXY", "socks5h://127.0.0.1:1080");
                cmd.env("HTTP_PROXY", "socks5h://127.0.0.1:1080");
                cmd.env("ALL_PROXY", "socks5h://127.0.0.1:1080");
                cmd.spawn()
                    .map_err(|e| miette::miette!("Échec du lancement d'AGY Desktop : {e}"))?;
            },
            AppTarget::Agy { args } => {
                println!("[App Proxy] Vérification du tunnel US VPS...");
                let cfg = aphrody_vpn::VpsProxyManager::ensure_vps_proxy_us(1080)
                    .await
                    .map_err(|e| miette::miette!("Échec tunnel US : {e}"))?;
                println!(
                    "[App Proxy] Tunnel US actif : {} ({})",
                    cfg.exit_country,
                    cfg.exit_city.as_deref().unwrap_or("?")
                );

                let agy = find_agy_path()
                    .ok_or_else(|| miette::miette!("AGY CLI introuvable sur la machine"))?;
                let mut cmd = std::process::Command::new(agy);
                cmd.args(&args);
                cmd.env("HTTPS_PROXY", "socks5h://127.0.0.1:1080");
                cmd.env("HTTP_PROXY", "socks5h://127.0.0.1:1080");
                cmd.env("ALL_PROXY", "socks5h://127.0.0.1:1080");
                cmd.env("https_proxy", "socks5h://127.0.0.1:1080");
                cmd.env("http_proxy", "socks5h://127.0.0.1:1080");
                cmd.env("all_proxy", "socks5h://127.0.0.1:1080");
                let status = cmd
                    .status()
                    .map_err(|e| miette::miette!("Échec d'exécution d'AGY CLI : {e}"))?;
                if !status.success() {
                    return Err(miette::miette!("AGY a terminé avec le code {:?}", status.code()));
                }
            },
            AppTarget::Setup => {
                println!(
                    "[App Proxy Setup] Configuration stricte : Gemini App, AGY Desktop, AGY CLI..."
                );
                let script_path = setup_app_proxies_script()?;
                let status = std::process::Command::new("powershell")
                    .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                    .arg(&script_path)
                    .status()
                    .map_err(|e| miette::miette!("Échec de lancement de PowerShell : {e}"))?;
                if !status.success() {
                    return Err(miette::miette!(
                        "{} a échoué (code {:?})",
                        script_path.display(),
                        status.code()
                    ));
                }
                println!(
                    "[App Proxy Setup] Succès : raccourcis et commandes configurés uniquement \
                     pour les 3 cibles."
                );
            },
            AppTarget::Status => {
                let vps_proxy = aphrody_vpn::VpsProxyManager::check_proxy_alive(1080).await;
                println!("=== [ROUTAGE PROXY US STRICT : 3 CIBLES EXCLUSIVES] ===");
                println!("• Tunnel SOCKS5 (127.0.0.1:1080) :");
                match vps_proxy {
                    Some(p) => println!(
                        "  État : ACTIF -> {} ({})",
                        p.exit_country,
                        p.exit_city.as_deref().unwrap_or("?")
                    ),
                    None => println!("  État : INACTIF (démarré automatiquement sur demande)"),
                }
                println!("\n• Applications cibles exclusives :");
                println!(
                    "  1. Gemini App   : Encapsulée via Chrome ({})",
                    find_chrome_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "Chrome non trouvé".into())
                );
                println!(
                    "  2. AGY CLI      : {}",
                    find_agy_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "Non trouvé".into())
                );
                println!(
                    "  3. AGY Desktop  : {}",
                    find_antigravity_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "Non trouvé".into())
                );
                println!("\n• Commandes console dédiées :");
                println!("  - gemini-us        (ou `aphrody vpn app gemini`)");
                println!("  - agy-us           (ou `aphrody agy --us-proxy`)");
                println!("  - agy-desktop-us   (ou `aphrody vpn app desktop`)");
                println!("  - aphrody vpn app setup");
                println!(
                    "\n• Note : tout le reste de Windows navigue en connexion directe normale."
                );
                println!("========================================================");
            },
        },
    }

    Ok(())
}

/// Chrome profile directory reserved for the proxied Gemini app window.
fn gemini_app_profile_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        PathBuf::from(local_appdata).join(r"Google\Chrome\User Data\GeminiApp")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .unwrap_or_else(std::env::temp_dir);
        base.join("aphrody").join("gemini-app-chrome")
    }
}

fn find_chrome_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
            format!(r"{}\Google\Chrome\Application\chrome.exe", local_appdata),
        ];
        for c in candidates {
            let p = PathBuf::from(&c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let bundled = PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    // Distribution package names come first on Linux; a bare `chrome` is
    // rarely on PATH there.
    ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]
        .iter()
        .find_map(|name| which::which(name).ok())
}

fn find_antigravity_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let candidates = [
            format!(r"{}\Programs\antigravity\Antigravity.exe", local_appdata),
            format!(r"{}\Programs\Antigravity\Antigravity.exe", local_appdata),
            format!(r"{}\Antigravity\Antigravity.exe", program_files),
        ];
        for c in candidates {
            let p = PathBuf::from(&c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    which::which("antigravity").ok()
}

fn find_agy_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let p = PathBuf::from(format!(r"{}\agy\bin\agy.exe", local_appdata));
        if p.exists() {
            return Some(p);
        }
    }
    which::which("agy").ok()
}

/// Resolve the monorepo's `scripts/aphrody/setup-app-proxies.ps1`.
///
/// `APHRODY_INFRA_ROOT` overrides; otherwise the repository root containing
/// this CLI crate or an ancestor of the current directory is searched.
fn setup_app_proxies_script() -> miette::Result<std::path::PathBuf> {
    let rel = std::path::Path::new("scripts").join("aphrody").join("setup-app-proxies.ps1");
    let mut roots = Vec::new();
    if let Some(root) = std::env::var_os("APHRODY_INFRA_ROOT") {
        roots.push(std::path::PathBuf::from(root));
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(ws) = manifest.ancestors().nth(3) {
        roots.push(ws.to_path_buf());
    }
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors() {
            roots.push(dir.to_path_buf());
        }
    }
    let candidates: Vec<std::path::PathBuf> = roots.iter().map(|r| r.join(&rel)).collect();
    candidates.iter().find(|p| p.is_file()).cloned().ok_or_else(|| {
        miette::miette!(
            "setup-app-proxies.ps1 introuvable (sondé : {}) ; définissez APHRODY_INFRA_ROOT",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
        )
    })
}
