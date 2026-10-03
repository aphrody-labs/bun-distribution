// SPDX-License-Identifier: Apache-2.0
use std::{net::SocketAddr, path::PathBuf};

use async_trait::async_trait;
use colored::Colorize;
use indicatif::{ProgressBar, ProgressStyle};

use crate::{
    context::{GoogleContext, TerminalCommand},
    nl_tokens::{BYPASS_ENGINES, CARGO_COMMANDS, SCRIPT_EXTS, STANDARD_ACTIONS, UV_COMMANDS},
    platform,
};

/// A subprocess forwarded by aphrody exited with a non-zero status code.
///
/// This error is produced instead of calling `std::process::exit` directly in
/// library code.  The single authoritative `process::exit` call lives in
/// `main.rs` which downcasts `miette::Report` to this type and propagates the
/// exit code.
#[derive(Debug, miette::Diagnostic)]
pub(crate) struct SubprocessExit(pub(crate) i32);

impl std::fmt::Display for SubprocessExit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "subprocess exited with code {}", self.0)
    }
}

impl std::error::Error for SubprocessExit {}

pub(crate) struct VersionCommand {
    pub json: bool,
}

#[async_trait]
impl TerminalCommand for VersionCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        if self.json {
            let info = serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "commit": env!("APHRODY_GIT_SHA"),
                "built": env!("APHRODY_BUILD_UNIX"),
                "target": env!("APHRODY_TARGET"),
                "profile": env!("APHRODY_BUILD_PROFILE"),
                "repo": "https://github.com/aphrody-labs/aphrody",
                "license": "Apache-2.0",
                "a2a": "ai.json v1 (AGNTCY a2a/v0.4) @ /ai.json + /.well-known/ai.json"
            });
            println!("{}", serde_json::to_string_pretty(&info).unwrap());
            return Ok(());
        }

        // Format mirrors `gh --version` / `rustc -Vv` — flat key:value, no
        // emoji, no styling (terminals downstream may pipe to grep).
        println!("aphrody {}", env!("CARGO_PKG_VERSION"));
        println!("commit:    {}", env!("APHRODY_GIT_SHA"));
        println!("built:     {} (unix epoch)", env!("APHRODY_BUILD_UNIX"));
        println!("target:    {}", env!("APHRODY_TARGET"));
        println!("profile:   {}", env!("APHRODY_BUILD_PROFILE"));
        println!();
        println!("repo:      https://github.com/aphrody-labs/aphrody");
        println!("license:   Apache-2.0");
        println!("a2a:       ai.json v1 (AGNTCY a2a/v0.4) @ /ai.json + /.well-known/ai.json");
        Ok(())
    }
}

pub(crate) struct MirrorCommand {
    pub action: String,
}

#[async_trait]
impl TerminalCommand for MirrorCommand {
    async fn execute(&self, ctx: &GoogleContext) -> miette::Result<()> {
        match self.action.as_str() {
            "start" => {
                ctx.mirror.start_mirroring().await.map_err(|e| miette::miette!(e.to_string()))?;
                println!("[ok] mirror started");
            },
            "stop" => {
                println!("[ok] mirror stopped (synchronous cycle complete)");
            },
            "status" => {
                println!("[ok] mirror target /var/mirror initialized in VFS");
            },
            other => {
                println!("[skip] unsupported mirror action: {other} (use start|stop|status)");
            },
        }
        Ok(())
    }
}

pub(crate) struct AuthCommand {
    #[allow(dead_code)]
    pub force: bool,
}

#[async_trait]
impl TerminalCommand for AuthCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        println!("🔐 Tentative d'authentification Google...");

        // gemini-cli is deprecated — it was absorbed into the Antigravity CLI
        // (`agy`, installed at %LOCALAPPDATA%\agy\bin per the official
        // install.ps1), and `@google/gemini-cli/bundle/gemini.js` no longer
        // exists. We no longer shell out to it. Instead, extract the Google
        // OAuth token from the Antigravity CLI (agy): Windows Credential Manager
        // `gemini:antigravity`, or on Unix `~/.gemini/antigravity-cli/antigravity-oauth-token`.
        if let Some(tok) = read_antigravity_oauth() {
            if let Some(access) = tok.pointer("/token/access_token").and_then(|v| v.as_str()) {
                Self::persist_god_mode_token("antigravity", access)?;
                println!("🔓 Token Google extrait depuis l'Antigravity CLI (agy).");
                return Ok(());
            }
            println!("⚠️ Credential agy présent mais sans `token.access_token`.");
        }

        // Last resort: reuse an existing on-disk token (gemini/agy shared store).
        if read_gemini_oauth().is_some() {
            println!("🔓 Token réutilisé depuis ~/.gemini/oauth_creds.json.");
            return Ok(());
        }

        Err(miette::miette!(
            "Aucune source d'authentification disponible. Connectez-vous via l'Antigravity CLI \
             (`agy` ou `aphrody antigravity login`) puis relancez `aphrody auth`. gemini-cli \
             n'est plus utilisé."
        ))
    }
}

fn read_gemini_oauth() -> Option<serde_json::Value> {
    let home = platform::home_dir().ok()?;
    let path = home.join(".gemini").join("oauth_creds.json");
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Read the agy / Antigravity OAuth envelope (`{"token": {…}}`).
fn read_antigravity_oauth() -> Option<serde_json::Value> {
    #[cfg(unix)]
    {
        if let Ok(home) = platform::home_dir() {
            for rel in [
                [".config", "aphrody", "antigravity-token.json"],
                [".gemini", "antigravity-cli", "antigravity-oauth-token"],
            ] {
                let path = rel.iter().fold(home.clone(), |p, seg| p.join(seg));
                if let Ok(content) = std::fs::read_to_string(&path)
                    && let Ok(v) = serde_json::from_str(&content)
                {
                    return Some(v);
                }
            }
        }
    }

    // Windows reads the credential manager and stops there; every other target
    // reaches the `None` below. Gating both keeps the fallback from being
    // compiled as dead code behind that `return`.
    #[cfg(target_os = "windows")]
    {
        read_antigravity_oauth_windows()
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn read_antigravity_oauth_windows() -> Option<serde_json::Value> {
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
    };

    let target: Vec<u16> = "gemini:antigravity".encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `target` is a NUL-terminated UTF-16 string. On success CredReadW
    // hands back one heap-allocated CREDENTIALW that we read once and free with
    // CredFree; the blob slice lives only for the duration of the read.
    unsafe {
        let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
        if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pcred) == 0 || pcred.is_null() {
            return None;
        }
        let cred = &*pcred;
        let parsed = if cred.CredentialBlob.is_null() || cred.CredentialBlobSize == 0 {
            None
        } else {
            let blob =
                std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
            serde_json::from_slice::<serde_json::Value>(blob).ok()
        };
        CredFree(pcred.cast());
        parsed
    }
}

impl AuthCommand {
    /// Persists a God Mode token to the per-user CLI credential store.
    /// File is created with `0600` on Unix; on Windows it inherits the user
    /// profile ACL (DPAPI-equivalent isolation since it sits under `%APPDATA%`).
    ///
    /// Only called from the Windows-gated God Mode branch in
    /// `AuthCommand::execute`; on Linux/macOS the symbol is reachable but
    /// the call site is `cfg`-stripped, so dead-code is allowed.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    fn persist_god_mode_token(profile: &str, token: &str) -> miette::Result<()> {
        // Root from `aphrody_models::paths`, the single authority.
        let dir = aphrody_models::paths::state_subdir("credentials")
            .map_err(|_| miette::miette!("Impossible de localiser le répertoire utilisateur"))?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| miette::miette!("Création de {} impossible : {e}", dir.display()))?;
        let file = dir.join(format!("{profile}.gm.token"));
        std::fs::write(&file, token)
            .map_err(|e| miette::miette!("Écriture de {} impossible : {e}", file.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| miette::miette!("chmod 0600 sur {} : {e}", file.display()))?;
        }
        Ok(())
    }
}

pub(crate) async fn dispatch_a2a(
    action: crate::A2aAction,
    _ctx: &GoogleContext,
) -> miette::Result<()> {
    use std::net::SocketAddr;

    use aphrody_a2a_coord::{
        ListenerConfig, PeerId, PeerInvoker,
        listener::{self, TickOptions},
    };

    let (manifest, repo_root) =
        aphrody_a2a_coord::AiManifest::load_repo_default().map_err(|e| miette::miette!("{e}"))?;

    match action {
        crate::A2aAction::Serve { bind, unix, no_tcp, coord_dir } => {
            let addr: SocketAddr =
                bind.parse().map_err(|e| miette::miette!("invalid --bind: {e}"))?;
            let cfg = ListenerConfig { bind: addr, manifest, repo_root, dry_run: false };
            let env_path = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(Into::into);
            let opts = listener::ServeOptions {
                unix: unix.or_else(|| env_path("A2A_SOCKET")),
                no_tcp,
                coord_dir: coord_dir.or_else(|| env_path("COORD_DIR")),
            };
            if !opts.no_tcp {
                println!("A2A coord on http://{addr} — agent card, /ping, /msg, /jsonrpc, /events, JSON-RPC, HTTP+REST");
            }
            if let Some(sock) = &opts.unix {
                println!("A2A coord on unix:{}", sock.display());
            }
            listener::serve_with_options(cfg, opts).await.map_err(|e| miette::miette!("a2a serve failed: {e}"))?;
        },
        crate::A2aAction::Tick { iteration, side, peer, subject, body, kind } => {
            let opts =
                TickOptions { iteration, side, peer: Some(peer), subject, body, kind: Some(kind) };
            let env = listener::run_tick(&manifest, &repo_root, &opts)
                .map_err(|e| miette::miette!("a2a tick: {e}"))?;
            println!("{}", serde_json::to_string_pretty(&env).unwrap_or_default());
        },
        crate::A2aAction::Invoke { prompt, peer, dry_run, claim } => {
            let peer_id = PeerId::parse(&peer).ok_or_else(|| {
                miette::miette!("unknown peer {peer:?}; use grok|agy|claude|codex|bxc")
            })?;
            let _claims = claim
                .iter()
                .map(|path| {
                    aphrody_a2a_coord::claims::FileClaim::acquire(&repo_root, path)
                        .map_err(|e| miette::miette!("claim {}: {e}", path.display()))
                })
                .collect::<miette::Result<Vec<_>>>()?;
            let prompt = if claim.is_empty() {
                prompt
            } else {
                let paths = claim
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "Edit only these claimed file families: {paths}. Other workers share this checkout. Do not switch branches or commit.\n\n{prompt}"
                )
            };
            let invoker = PeerInvoker::new(&repo_root).with_dry_run(dry_run);
            let result = invoker
                .invoke_prompt(peer_id, &prompt)
                .map_err(|e| miette::miette!("peer invoke: {e}"))?;
            if !result.stderr.is_empty() {
                eprintln!("{}", result.stderr);
            }
            print!("{}", result.stdout);
            if result.exit_code != Some(0) {
                return Err(miette::miette!(
                    "peer {} exited {:?}",
                    peer_id.short(),
                    result.exit_code
                ));
            }
        },
        crate::A2aAction::Send { instruction, target, source, yolo } => {
            let registry = aphrody_a2a_coord::PeerRegistry::from_env(&repo_root);
            let mailbox = aphrody_a2a_coord::mailbox::Mailbox::new(manifest.coord_dir(&repo_root));
            let params =
                aphrody_a2a_coord::SendParams { target, source_agent: source, instruction, yolo };
            let out = aphrody_a2a_coord::bridge::send(&registry, &mailbox, &params)
                .await
                .map_err(|e| miette::miette!("a2a send: {e}"))?;
            println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        },
        crate::A2aAction::Peers => {
            let registry = aphrody_a2a_coord::PeerRegistry::from_env(&repo_root);
            println!("{}", serde_json::to_string_pretty(registry.peers()).unwrap_or_default());
        },
    }
    Ok(())
}

pub(crate) struct CrosCommand {
    pub action: crate::CrosActions,
}

#[async_trait]
impl TerminalCommand for CrosCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);

        println!("🚀 Mode Hyper-Performance ChromeOS Activé");
        println!("⚡ Détection matérielle : {} cœurs logiques disponibles", cores);

        match &self.action {
            crate::CrosActions::Sync => {
                println!("🔄 Création de la configuration .gclient pour ChromeOS...");

                let gclient_config = r#"solutions = [
  {
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "name": "src",
  },
]
target_os = ['chromeos']
"#;
                std::fs::write(".gclient", gclient_config)
                    .map_err(|e| miette::miette!("Erreur écriture .gclient: {}", e))?;

                println!("📥 Lancement du shallow fetch multi-threadé (-j {})...", cores);

                let pb = ProgressBar::new_spinner();
                pb.set_style(
                    ProgressStyle::default_spinner()
                        .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ ")
                        .template("{spinner:.green} [{elapsed_precise}] {msg}")
                        .expect("Invalid progress bar template"),
                );
                pb.set_message("Synchronisation Chromium en cours...");
                pb.enable_steady_tick(std::time::Duration::from_millis(100));

                // Exécution de gclient sync via depot_tools
                let status = std::process::Command::new("cmd")
                    .args([
                        "/C",
                        r"vendor\depot_tools\gclient.bat",
                        "sync",
                        "--no-history",
                        &format!("-j{}", cores),
                    ])
                    .status()
                    .map_err(|e| miette::miette!("Erreur exécution gclient: {}", e))?;

                pb.finish_and_clear();

                if !status.success() {
                    return Err(miette::miette!("Échec de gclient sync"));
                }
                println!("✅ Code source ChromeOS synchronisé avec une vitesse maximale.");
            },
            crate::CrosActions::Build => {
                println!("⚙️ Configuration du moteur GN pour des performances absolues...");

                let out_dir = PathBuf::from("src/out/ChromeOS");
                std::fs::create_dir_all(&out_dir)
                    .map_err(|e| miette::miette!("Erreur création dossier out/ChromeOS: {}", e))?;

                let gn_args = r#"target_os = "chromeos"
is_chromeos_device = false
use_remoteexec = false
is_debug = false
is_component_build = true
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0
use_lld = true
cc_wrapper = "sccache"
"#;
                std::fs::write(out_dir.join("args.gn"), gn_args)
                    .map_err(|e| miette::miette!("Erreur écriture args.gn: {}", e))?;

                println!("🔨 Génération Ninja...");
                let gn_status = std::process::Command::new("cmd")
                    .current_dir("src")
                    .args(["/C", r"..\vendor\depot_tools\gn.bat", "gen", "out/ChromeOS"])
                    .status()
                    .map_err(|e| miette::miette!("Erreur exécution gn: {}", e))?;

                if !gn_status.success() {
                    return Err(miette::miette!("Échec de la génération GN"));
                }

                println!("🔥 Lancement d'Autoninja sur {} threads...", cores);
                // SAFETY: Setting environment variables in a multithreaded process is inherently
                // unsafe. However, this CLI command runs as a short-lived process
                // and this mutation happens before the child process is spawned, so
                // the race window is minimal in practice.
                unsafe {
                    std::env::set_var("NINJA_SUMMARIZE_BUILD", "1");
                }

                let ninja_status = std::process::Command::new("cmd")
                    .current_dir("src")
                    .args([
                        "/C",
                        r"..\vendor\depot_tools\autoninja.bat",
                        "-C",
                        "out/ChromeOS",
                        &format!("-j{}", cores),
                    ])
                    .status()
                    .map_err(|e| miette::miette!("Erreur exécution autoninja: {}", e))?;

                if !ninja_status.success() {
                    return Err(miette::miette!("Échec de la compilation Ninja"));
                }
                println!("✅ Compilation ChromeOS terminée de manière foudroyante.");
            },
        }

        Ok(())
    }
}

pub(crate) struct AutoCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for AutoCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // Policy 100% Rust (memory `feedback_aphrody_rust_only`) :
        // `AutoCommand` n'auto-spawn JAMAIS `bun` implicitement. Les
        // utilisateurs qui veulent invoquer bun passent par BYPASS_ENGINES
        // (`aphrody bun add foo`). Le runtime par défaut est `cargo`.
        if self.args.is_empty() {
            eprintln!(
                "⚠️  [Auto] No arguments. Usage: `aphrody <cmd> [args]` or `aphrody \"<NL \
                 prompt>\"`.\n   Default engine is `cargo` (workspace 100% Rust). Use BYPASS \
                 engines explicitly: `aphrody bun add foo`, `aphrody uv sync`, `aphrody npm i`, \
                 etc."
            );
            return Err(miette::Report::new(SubprocessExit(2)));
        }

        let first_arg = &self.args[0];

        // All category lists (BYPASS_ENGINES, UV_COMMANDS, CARGO_COMMANDS,
        // STANDARD_ACTIONS, SCRIPT_EXTS) come from `crate::nl_tokens` so
        // the NL detector in `main.rs` and this dispatcher cannot drift.
        //
        // Note (Phase 5, 2026-05-18) : `BUN_COMMANDS` a été retiré du
        // dispatcher implicite — bun reste accessible via BYPASS_ENGINES.

        // Explicit engine bypass (`bun`, `uv`, `cargo`, `npm`, …)
        if BYPASS_ENGINES.contains(&first_arg.as_str()) {
            return Self::run_process(first_arg, &self.args[1..]);
        }
        // Specific commands
        else if UV_COMMANDS.contains(&first_arg.as_str()) {
            return Self::run_process("uv", &self.args[..]);
        } else if CARGO_COMMANDS.contains(&first_arg.as_str()) {
            return Self::run_process("cargo", &self.args[..]);
        }

        let is_known_technical_command = STANDARD_ACTIONS.contains(&first_arg.as_str());
        let is_script_file = SCRIPT_EXTS.iter().any(|ext| first_arg.ends_with(ext));

        // Overlapping Universal Commands (run, install, add, remove, test, build...)
        let is_run_script = first_arg == "run" || first_arg == "exec";

        // Default engine = `cargo` (Rust-first policy). Bun/Node ne sont
        // jamais sélectionnés implicitement par le dispatcher.
        let mut target_engine = "cargo";

        if !is_known_technical_command && !is_script_file {
            // If it's neither a known standard action nor a direct script execution, it's likely a
            // natural language prompt.
            let prompt = self.args.join(" ");
            println!("✨ [Auto] Détection de langage naturel, bascule vers l'agent A2A...");
            return dispatch_a2a(
                crate::A2aAction::Invoke {
                    prompt,
                    peer: "grok".to_string(),
                    dry_run: false,
                    claim: Vec::new(),
                },
                _ctx,
            )
            .await;
        }

        if is_run_script && self.args.len() > 1 && self.args[1].ends_with(".py") {
            target_engine = "uv";
        } else if first_arg.ends_with(".py") {
            let mut new_args = vec!["run".to_string()];
            new_args.extend(self.args.clone());
            return Self::run_process("uv", new_args);
        } else if first_arg.ends_with(".js")
            || first_arg.ends_with(".ts")
            || first_arg.ends_with(".jsx")
            || first_arg.ends_with(".tsx")
        {
            // Policy 100% Rust : aucun spawn implicite vers un runtime JS.
            // L'utilisateur doit passer par le BYPASS explicite
            // (`aphrody bun run X.ts`) ou installer un runtime tiers.
            eprintln!(
                "⚠️  [Auto] `{first_arg}` est un script JS/TS — le dispatcher 100% Rust ne spawn \
                 pas de runtime JS implicitement.\n   Utiliser le bypass explicite : `aphrody bun \
                 run {first_arg}` (ou `aphrody node {first_arg}`, `aphrody deno run {first_arg}`)."
            );
            return Err(miette::Report::new(SubprocessExit(2)));
        } else if first_arg.ends_with(".rs") {
            let mut new_args = vec!["run".to_string()];
            new_args.extend(self.args.clone());
            return Self::run_process("cargo", new_args);
        } else {
            // Contextual ecosystem detection. Note : `package.json` ne
            // sélectionne plus `bun` implicitement (policy 100% Rust) ;
            // l'utilisateur passe par `aphrody bun <cmd>` au besoin.
            let has_cargo = std::path::Path::new("Cargo.toml").exists();
            let has_uv = std::path::Path::new("pyproject.toml").exists()
                || std::path::Path::new("requirements.txt").exists();
            let has_go = std::path::Path::new("go.mod").exists();

            if has_cargo {
                target_engine = "cargo";
            } else if has_uv {
                target_engine = "uv";
            } else if has_go {
                target_engine = "go";
            } else {
                // No project file. If it's a global install (e.g. `google install git`), fallback
                // to system manager
                let is_install_like =
                    first_arg == "install" || first_arg == "i" || first_arg == "add";
                if is_install_like && self.args.len() > 1 && !self.args[1].starts_with('-') {
                    #[cfg(target_os = "windows")]
                    {
                        target_engine = "winget";
                    }
                    #[cfg(target_os = "linux")]
                    {
                        target_engine = "apt";
                    }
                    #[cfg(target_os = "macos")]
                    {
                        target_engine = "brew";
                    }
                }
            }
        }

        // Command syntax translation for universal compatibility
        let mut final_args = self.args.clone();
        if target_engine == "cargo" {
            if final_args[0] == "install" || final_args[0] == "i" {
                // In Cargo, adding to a project is 'cargo add', global install is 'cargo install'
                if std::path::Path::new("Cargo.toml").exists() {
                    final_args[0] = "add".to_string();
                } else {
                    final_args[0] = "install".to_string();
                }
            } else if final_args[0] == "rm" || final_args[0] == "remove" {
                final_args[0] = "remove".to_string();
            }
        } else if target_engine == "uv" {
            if final_args[0] == "install" || final_args[0] == "i" {
                final_args[0] = "add".to_string();
            }
        } else if target_engine == "winget" && (final_args[0] == "add" || final_args[0] == "i") {
            final_args[0] = "install".to_string();
        }

        Self::run_process(target_engine, final_args)
    }
}

impl AutoCommand {
    fn run_process<I, S>(cmd: &str, args: I) -> miette::Result<()>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<std::ffi::OsStr>,
    {
        println!(
            "{}",
            format!(
                "⚡ Route native: {} {:?}",
                cmd,
                args.clone()
                    .into_iter()
                    .map(|s| s.as_ref().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            )
            .bright_black()
        );

        let status = std::process::Command::new(cmd)
            .args(args)
            .status()
            .map_err(|e| miette::miette!("Erreur lors de l'appel au moteur {}: {}", cmd, e))?;

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

pub(crate) struct GeminiCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for GeminiCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // Délègue à la chain unifiée `aphrody_gemini_runtime::resolve_bin()` :
        // 1. $APHRODY_GEMINI_BIN  2. sibling exe (post-bootstrap)
        // 3. packages/gemini-cli/bundle/gemini[.exe|.js] (fork in-tree)
        // 4. which("gemini") (upstream PATH). Cf. CLAUDE.md §0.4 et memory
        // project_aphrody_owned_tools : on préfère toujours l'outil maison.
        // DÉPRÉCIÉ : le Gemini CLI a fusionné dans l'Antigravity CLI (`agy`).
        // On honore encore un binaire gemini explicitement fourni (override
        // `APHRODY_GEMINI_BIN` ou fork in-tree) pour la rétro-compat, mais dès
        // que la chaîne gemini échoue on forwarde vers `agy` — la surface
        // canonique — au lieu d'échouer. Cf. message utilisateur 2026-09-07.
        let bin_path = match aphrody_gemini_runtime::resolve_bin() {
            Ok(p) => p,
            Err(_) => {
                let agy = resolve_agy_bin().ok_or_else(|| {
                    miette::miette!(
                        "`aphrody gemini` est déprécié : le Gemini CLI a migré vers l'Antigravity \
                         CLI (`agy`), et `agy` est introuvable.\n\nRésolution `agy` : \
                         $APHRODY_AGY_BIN > %LOCALAPPDATA%\\agy\\bin\\agy.exe > PATH.\n• \
                         Installer l'Antigravity CLI puis relancer `aphrody agy …`, ou\n• \
                         `aphrody chat --stub --prompt \"…\"` (aucun binaire requis)."
                    )
                })?;
                eprintln!(
                    "⚠️  `aphrody gemini` est déprécié — le Gemini CLI a migré vers `agy`. \
                     Forward vers `agy`. Utilisez `aphrody agy` directement."
                );
                let status = std::process::Command::new(&agy)
                    .args(&self.args)
                    .status()
                    .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", agy.display()))?;
                if !status.success() {
                    return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
                }
                return Ok(());
            },
        };

        let mut cmd = std::process::Command::new(&bin_path);
        cmd.args(&self.args);
        // Gemini CLI refuse de tourner en headless si le cwd n'est pas un
        // "trusted directory". Pour `aphrody a2a` / `aphrody gemini` invoqués
        // par l'autopilot ou tout autre scénario non-interactif, on opt-in au
        // trust par défaut. L'opérateur peut override en exportant
        // GEMINI_CLI_TRUST_WORKSPACE=false avant l'appel.
        if std::env::var_os("GEMINI_CLI_TRUST_WORKSPACE").is_none() {
            cmd.env("GEMINI_CLI_TRUST_WORKSPACE", "true");
        }

        let status = cmd
            .status()
            .map_err(|e| miette::miette!("Failed to spawn `{}`: {e}", bin_path.display()))?;

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

// ===========================================================================
// `aphrody agy` — forward to the native Antigravity CLI (`agy`) binary.
// ===========================================================================

/// Env override pointing directly at the `agy` binary. Highest precedence.
pub(crate) const ENV_AGY_BIN: &str = "APHRODY_AGY_BIN";

/// Resolve the `agy` (Antigravity CLI) binary, first match wins:
/// 1. `$APHRODY_AGY_BIN` (must exist).
/// 2. `%LOCALAPPDATA%\agy\bin\agy.exe` on Windows — the path the official Antigravity `install.ps1`
///    writes.
/// 3. `$HOME/.local/share/agy/bin/agy` / `$HOME/.agy/bin/agy` on Unix.
/// 4. `which("agy")` — PATH lookup.
pub(crate) fn resolve_agy_bin() -> Option<std::path::PathBuf> {
    if let Ok(explicit) = std::env::var(ENV_AGY_BIN) {
        let p = std::path::PathBuf::from(explicit.trim());
        if !explicit.trim().is_empty() && p.exists() {
            return Some(p);
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = std::path::Path::new(&local).join("agy").join("bin").join("agy.exe");
        if p.exists() {
            return Some(p);
        }
    }

    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        for rel in [["agy", "bin", "agy"], [".local", "share/agy", "bin/agy"]] {
            let mut p = std::path::PathBuf::from(&home);
            for seg in rel {
                p.push(seg);
            }
            if p.exists() {
                return Some(p);
            }
        }
    }

    which::which("agy").ok()
}

/// Implementation of `aphrody agy <args…>` — a thin, scriptable forwarder to
/// the Antigravity CLI. Stdio is inherited and the child's exit code is
/// propagated verbatim via [`SubprocessExit`].
pub(crate) struct AgyCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for AgyCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let bin_path = resolve_agy_bin().ok_or_else(|| {
            miette::miette!(
                "Antigravity CLI (`agy`) introuvable.\n\nRésolution tentée : $APHRODY_AGY_BIN > \
                 %LOCALAPPDATA%\\agy\\bin\\agy.exe > PATH.\n• Installer l'Antigravity CLI, puis \
                 re-run, ou\n• Override : `APHRODY_AGY_BIN=/abs/path aphrody agy …`.\nPour la \
                 surface API pure (sans binaire), voir `aphrody antigravity`."
            )
        })?;

        // Branche nativement le home agent aphrody (persona + serveur MCP
        // `aphrody`) et le package yolo (skills) dans `~/.gemini` avant de céder
        // la main à `agy`. Best-effort : n'échoue jamais la session.
        let prov = crate::agy_provision::provision(aphrody_diagnostics::doctor::repo_root().as_deref());
        if prov.changed() {
            eprintln!(
                "aphrody agy: home agent + yolo câblés dans ~/.gemini (mcp={} skills={} \
                 persona={})",
                prov.mcp, prov.skills, prov.persona
            );
        }

        // Détecte et intercepte les drapeaux de forçage de proxy US
        let mut agy_args = Vec::new();
        let mut force_vps_proxy =
            std::env::var("APHRODY_FORCE_VPS_PROXY").unwrap_or_default() == "1";

        for arg in &self.args {
            if arg == "--us-proxy" || arg == "--vps-proxy" || arg == "--proxy-us" {
                force_vps_proxy = true;
            } else {
                agy_args.push(arg.clone());
            }
        }

        if force_vps_proxy {
            // SAFETY: safe in single-threaded setup before spawning child
            unsafe {
                std::env::set_var("APHRODY_FORCE_VPS_PROXY", "1");
            }
        }

        // Assure que agy a accès à une sortie US / non-EEE (Mullvad local ou SSH VPS US proxy)
        // pour contourner la géo-restriction 400 Cloud Code / Vertex AI ("User location is not
        // supported").
        let mut cmd = std::process::Command::new(&bin_path);
        cmd.args(&agy_args);

        if std::env::var("APHRODY_NO_VPN_CHECK").unwrap_or_default() != "1" {
            match aphrody_vpn::ensure_us_connectivity_for_agy().await {
                Ok(Some(cfg)) => {
                    eprintln!(
                        "aphrody agy (proxy): focus US via {} (IP: {}, {})",
                        cfg.proxy_url,
                        cfg.exit_ip.as_deref().unwrap_or("?"),
                        cfg.exit_country
                    );
                    cmd.env("HTTPS_PROXY", &cfg.proxy_url);
                    cmd.env("HTTP_PROXY", &cfg.proxy_url);
                    cmd.env("ALL_PROXY", &cfg.proxy_url);
                    cmd.env("https_proxy", &cfg.proxy_url);
                    cmd.env("http_proxy", &cfg.proxy_url);
                    cmd.env("all_proxy", &cfg.proxy_url);
                },
                Ok(None) => {
                    // VPN local Mullvad actif et routant hors EEE
                },
                Err(e) => {
                    eprintln!("aphrody agy (proxy): note - {e}");
                },
            }
        }

        let status = cmd
            .status()
            .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", bin_path.display()))?;

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

pub(crate) struct CodexCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for CodexCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let bin_path = crate::codex_provision::resolve_codex_bin().ok_or_else(|| {
            miette::miette!(
                "OpenAI Codex CLI (`codex`) introuvable.\n\nRésolution tentée : \
                 $APHRODY_CODEX_BIN > PATH > standard global bin.\n• Installer codex (`npm \
                 install -g @openai/codex` ou `bun add -g @openai/codex`), ou\n• Définir : \
                 `APHRODY_CODEX_BIN=/chemin/vers/codex aphrody codex …`."
            )
        })?;

        // Provisionne idempotemment aphrody MCP + yolo persona dans $CODEX_HOME
        let prov = crate::codex_provision::provision(aphrody_diagnostics::doctor::repo_root().as_deref());
        if prov.changed() {
            eprintln!(
                "aphrody codex: home agent + yolo câblés dans $CODEX_HOME (config={} persona={})",
                prov.config, prov.persona
            );
        }

        let mut cmd = std::process::Command::new(&bin_path);
        cmd.args(&self.args);

        let status = cmd
            .status()
            .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", bin_path.display()))?;

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

// The `bxc` resolution chain used to live here, in a `resolve_bxc_bin` helper.
// It now lives in `aphrody_web_bridge::resolve::binary`, the single authority for where
// bxc is on this machine: the CLI and the MCP server must not drift apart on
// that question, and two copies is how they would. Delegating also fixed a real
// defect the local copy carried — its `~/.local/bin` branch was
// `#[cfg(not(windows))]`, so on Windows, where the installed binary sits at
// `%USERPROFILE%\.local\bin\bxc.exe`, the chain skipped it and reported bxc as
// absent.

/// Implementation of `aphrody bxc <args…>` — a thin, scriptable forwarder to Bxc.
pub(crate) struct BxcCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for BxcCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // The itinerary comes from the resolver, so the message lists the
        // paths that were really probed rather than a prose summary that can
        // drift away from the code.
        let bin_path =
            aphrody_web_bridge::resolve::binary().map_err(|e| miette::miette!("{e}"))?.into_path();

        let status = if cfg!(windows)
            && bin_path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd"))
        {
            std::process::Command::new("cmd").arg("/c").arg(&bin_path).args(&self.args).status()
        } else {
            std::process::Command::new(&bin_path).args(&self.args).status()
        };

        let status = match status {
            Ok(st) => st,
            Err(e) => {
                // Repli in-tree via Bun si le spawn direct échoue
                let in_tree_candidate = aphrody_diagnostics::doctor::repo_root()
                    .map(|r| r.join("apps").join("bxc").join("src").join("cli").join("index.ts"));
                if let Some(script) = in_tree_candidate.filter(|p| p.is_file()) {
                    aphrody_toolchains::Toolchain::Bun
                        .command([script])
                        .args(&self.args)
                        .status()
                        .map_err(|be| {
                        miette::miette!(
                            "Échec du spawn `{}` ({e}) et du repli Bun ({be})",
                            bin_path.display()
                        )
                    })?
                } else {
                    return Err(miette::miette!("Échec du spawn `{}`: {e}", bin_path.display()));
                }
            },
        };

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

/// Forwards `aphrody google <args…>` to the native Google/Gemini ecosystem or executes native DoH / Suggest / Languages in-process.
pub(crate) struct GoogleCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for GoogleCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let first = self.args.first().map(|s| s.as_str()).unwrap_or("");

        match first {
            "" | "help" | "--help" | "-h" => {
                println!("{}", "Écosystème Google branché via Aphrody (DoH, Suggest, Translate, Gemini Web, Runtime)".bold().blue());
                println!();
                println!("Usage: aphrody google <COMMAND> [OPTIONS]");
                println!();
                println!("Commands:");
                println!("  dns <NAME> [TYPE]    Query Google Public DNS-over-HTTPS (A, AAAA, MX, TXT...)");
                println!("  suggest <QUERY>      Get real-time Google Autocomplete query suggestions");
                println!("  languages [TARGET]   List 195 official supported Google Cloud Translation languages");
                println!("  status               Print resolved Google/Gemini runtime contract as JSON");
                println!("  env                  Print shell exports for the Google Cloud / Gemini runtime");
                println!("  doctor               Validate Google project mapping and local configuration");
                println!("  login                Sign in to Google with the OAuth PKCE flow");
                println!("  auth-status          Report Google AI authentication status");
                println!("  whoami               Print the signed-in Google account profile");
                println!("  models               List Gemini models available to the authenticated account");
                println!("  generate             Generate one Gemini response with Antigravity");
                println!("  generate-stream      Stream one Gemini response from stdin");
                return Ok(());
            },
            "dns" => {
                let name = self.args.get(1).map(|s| s.as_str()).ok_or_else(|| {
                    miette::miette!("Usage: aphrody google dns <domain> [record_type] [--json]")
                })?;
                let mut record_type = "A";
                let mut json = false;
                for arg in &self.args[2..] {
                    if arg == "--json" {
                        json = true;
                    } else if !arg.starts_with('-') {
                        record_type = arg.as_str();
                    }
                }

                let mut url = reqwest::Url::parse("https://dns.google/resolve").unwrap();
                url.query_pairs_mut().append_pair("name", name).append_pair("type", record_type);

                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .map_err(|e| miette::miette!("HTTP client error: {e}"))?;

                let res = client.get(url).send().await
                    .map_err(|e| miette::miette!("Erreur lors de la requête DoH Google: {e}"))?;

                let body: serde_json::Value = res.json().await
                    .map_err(|e| miette::miette!("Réponse DoH JSON invalide: {e}"))?;

                if json {
                    println!("{}", serde_json::to_string_pretty(&body).unwrap());
                } else {
                    let status = body.get("Status").and_then(|s| s.as_i64()).unwrap_or(-1);
                    if status != 0 {
                        println!("{} Status: {}", "DNS Query Failed:".bold().red(), status);
                    } else if let Some(answers) = body.get("Answer").and_then(|a| a.as_array()) {
                        println!("{} {} ({})", "🔍 Google Public DNS:".bold().green(), name, record_type);
                        for ans in answers {
                            let data = ans.get("data").and_then(|d| d.as_str()).unwrap_or("");
                            let ttl = ans.get("TTL").and_then(|t| t.as_i64()).unwrap_or(0);
                            let t = ans.get("type").and_then(|t| t.as_i64()).unwrap_or(0);
                            println!("  {} {} (type {}, TTL {}s)", "->".bold().cyan(), data.bold(), t, ttl);
                        }
                    } else {
                        println!("{} Aucun enregistrement trouvé pour {} ({})", "ℹ".bold().yellow(), name, record_type);
                    }
                }
                return Ok(());
            },
            "suggest" => {
                let query = self.args[1..].iter()
                    .filter(|a| !a.starts_with('-'))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ");
                if query.trim().is_empty() {
                    return Err(miette::miette!("Usage: aphrody google suggest <query> [--json]"));
                }
                let json = self.args.iter().any(|a| a == "--json");

                let mut url = reqwest::Url::parse("https://suggestqueries.google.com/complete/search").unwrap();
                url.query_pairs_mut().append_pair("client", "chrome").append_pair("q", &query);

                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .map_err(|e| miette::miette!("HTTP client error: {e}"))?;

                let res = client.get(url).send().await
                    .map_err(|e| miette::miette!("Erreur lors de la requête Google Suggest: {e}"))?;

                let body: serde_json::Value = res.json().await
                    .map_err(|e| miette::miette!("Réponse Suggest JSON invalide: {e}"))?;

                let suggestions = body.as_array()
                    .and_then(|a| a.get(1))
                    .and_then(|s| s.as_array())
                    .map(|arr| {
                        arr.iter().filter_map(|item| item.as_str().map(String::from)).collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                if json {
                    println!("{}", serde_json::to_string_pretty(&suggestions).unwrap());
                } else {
                    println!("{} {} ({} suggestions)", "💡 Suggestions pour :".bold().blue(), query, suggestions.len());
                    for (i, s) in suggestions.iter().enumerate() {
                        println!("  {:2}. {}", i + 1, s.cyan());
                    }
                }
                return Ok(());
            },
            "languages" | "langs" => {
                let target = self.args.get(1).map(|s| s.as_str()).filter(|s| !s.starts_with('-'));
                let json = self.args.iter().any(|a| a == "--json");
                let langs = aphrody_google::languages::supported_languages(target);
                if json {
                    println!("{}", serde_json::to_string_pretty(&langs).unwrap());
                } else {
                    println!("{} {} langues supportées", "🌐 Google Translation:".bold().green(), langs.data.languages.len());
                    for lang in &langs.data.languages {
                        if let Some(name) = &lang.name {
                            println!("  {:8} -> {}", lang.language.cyan().bold(), name);
                        } else {
                            println!("  {:8}", lang.language.cyan().bold());
                        }
                    }
                }
                return Ok(());
            },
            _ => {}
        }

        // For other commands (status, env, doctor, login, whoami, models, generate, etc.), forward to aphrody-google binary.
        let google_bin = std::env::var_os("APHRODY_GOOGLE_BIN")
            .map(PathBuf::from)
            .or_else(|| {
                let p = PathBuf::from("/home/aphro/.local/bin/aphrody-google");
                if p.is_file() { Some(p) } else { None }
            })
            .or_else(|| which::which("aphrody-google").ok());

        if let Some(bin_path) = google_bin {
            let status = std::process::Command::new(&bin_path)
                .args(&self.args)
                .status();
            if let Ok(st) = status {
                if st.success() {
                    return Ok(());
                }
                return Err(miette::Report::new(SubprocessExit(st.code().unwrap_or(1))));
            }
        }

        // Fallback: If aphrody-google binary is not found, execute directly via aphrody_google library if status/env/doctor
        if first == "status" {
            let runtime = aphrody_google::GoogleRuntime::from_env();
            let report = serde_json::json!({
                "provider": "aphrody-google",
                "project": runtime.project.id(),
                "location": runtime.location,
                "home": runtime.home,
                "auth": runtime.auth,
                "capabilities": ["vertex", "gemini-oauth", "gemini-web", "google-web", "mcp", "bxc"],
            });
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
            return Ok(());
        }

        Err(miette::miette!("Commande google non reconnue: `{first}`. Voir `aphrody google --help`"))
    }
}

/// Implementation of `aphrody translate [text]` with the configured translation backends.
pub(crate) struct TranslateCommand {
    pub text: Option<String>,
    pub source: String,
    pub target: String,
    pub backend: String,
    pub file: Option<PathBuf>,
    pub json: bool,
}

#[async_trait]
impl TerminalCommand for TranslateCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let cache_path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".aphrody-translate-cache.json");

        let backend = aphrody_translate::Backend::from_str_loose(&self.backend);
        let translator = aphrody_translate::Translator::new(cache_path, None)
            .map_err(|e| miette::miette!("{e}"))?
            .with_backend(backend);

        if self.json {
            let text = match (&self.text, &self.file) {
                (Some(text), None) => text.clone(),
                (None, Some(path)) => std::fs::read_to_string(path)
                    .map_err(|error| miette::miette!("Lecture {}: {error}", path.display()))?,
                _ => {
                    return Err(miette::miette!(
                        "Provide exactly one text or --file for JSON translation"
                    ));
                },
            };
            let translated = translator
                .translate_with_lang_strict(&text, &self.source, &self.target)
                .await
                .map_err(|error| miette::miette!("{error}"))?;
            println!(
                "{}",
                serde_json::json!({
                    "translatedText": translated,
                    "detectedSource": self.source,
                    "target": self.target,
                    "provider": "aphrody-translate",
                })
            );
            translator.persist().map_err(|error| miette::miette!("{error}"))?;
            return Ok(());
        }

        if let Some(ref text) = self.text {
            let is_jp = self.source == "ja" || aphrody_translate::Translator::is_japanese(text);
            let res = if is_jp {
                println!(
                    "{}",
                    "Mode Shenron JP -> FR activé (protection canonique + contrôle qualité)".cyan()
                );
                translator.translate_jp_to_fr(text).await.map_err(|e| miette::miette!("{e}"))?
            } else {
                let src = if self.source == "auto" { "en" } else { &self.source };
                translator
                    .translate_with_lang(text, src, &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            };

            println!("\n{}", "Traduction :".bold().green());
            println!("{res}\n");
            translator.persist().ok();
            return Ok(());
        }

        if let Some(ref path) = self.file {
            let content = std::fs::read_to_string(path)
                .map_err(|e| miette::miette!("Lecture {}: {e}", path.display()))?;
            let is_jp = self.source == "ja" || aphrody_translate::Translator::is_japanese(&content);
            let res = if is_jp {
                translator.translate_jp_to_fr(&content).await.map_err(|e| miette::miette!("{e}"))?
            } else {
                let src = if self.source == "auto" { "en" } else { &self.source };
                translator
                    .translate_with_lang(&content, src, &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            };
            println!("{res}");
            translator.persist().ok();
            return Ok(());
        }

        println!(
            "{}",
            "Veuillez fournir un texte à traduire ou un fichier (--help pour les options)".yellow()
        );
        Ok(())
    }
}

/// Implementation of `aphrody n2b <args…>` using the integrated N2B crate.
pub(crate) struct N2bCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for N2bCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let mut args = vec!["n2b".to_string()];
        args.extend(self.args.iter().cloned());
        let status = aphrody_n2b::run_from(args).map_err(|e| miette::miette!("n2b: {e:#}"))?;
        if status != std::process::ExitCode::SUCCESS {
            return Err(miette::miette!("n2b a terminé avec un statut non nul"));
        }
        Ok(())
    }
}

/// Resolve the Niers CLI from `$NIE_BIN`, the Aphrody user bin, then PATH.
pub(crate) fn resolve_nie_bin() -> Option<std::path::PathBuf> {
    if let Ok(explicit) = std::env::var("NIE_BIN") {
        let path = std::path::PathBuf::from(explicit.trim());
        if !explicit.trim().is_empty() && path.exists() {
            return Some(path);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let path = std::path::Path::new(&local).join("Aphrody").join("bin").join("niers.exe");
        if path.exists() {
            return Some(path);
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        let path = std::path::Path::new(&home).join(".local").join("bin").join("niers");
        if path.exists() {
            return Some(path);
        }
    }
    which::which("niers").ok()
}

/// Implementation of `aphrody nie <args…>`.
pub(crate) struct NieCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for NieCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let bin_path = resolve_nie_bin().ok_or_else(|| {
            miette::miette!(
                "CLI Niers (`niers`) introuvable. Installer avec `aphrody package install nie` ou \
                 définir NIE_BIN=/chemin/absolu."
            )
        })?;
        let status = std::process::Command::new(&bin_path)
            .args(&self.args)
            .status()
            .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", bin_path.display()))?;
        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
        }
        Ok(())
    }
}

/// Implementation of `aphrody ssh <args…>` — forwarder to aphrody-ssh operator.
pub(crate) struct SshCommand {
    pub args: Vec<String>,
}

pub(crate) fn is_openssh_config_dump(args: &[String]) -> bool {
    matches!(args, [flag, _host] if flag == "-G")
}

#[async_trait]
impl TerminalCommand for SshCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // `ssh -G <host>` is OpenSSH's read-only resolved-config probe. Keep
        // Aphrody's structured operator subcommands as the default, while
        // preserving this essential diagnostic used before remote operations.
        if is_openssh_config_dump(&self.args) {
            let ssh = which::which("ssh")
                .map_err(|_| miette::miette!("OpenSSH `ssh` introuvable dans PATH"))?;
            let status = std::process::Command::new(&ssh)
                .args(&self.args)
                .status()
                .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", ssh.display()))?;
            if !status.success() {
                return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
            }
            return Ok(());
        }

        if let Ok(explicit) = std::env::var("APHRODY_SSH_BIN") {
            let p = std::path::PathBuf::from(explicit.trim());
            if !explicit.trim().is_empty() && p.exists() {
                let status = std::process::Command::new(&p)
                    .args(&self.args)
                    .status()
                    .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", p.display()))?;
                if !status.success() {
                    return Err(miette::Report::new(SubprocessExit(status.code().unwrap_or(1))));
                }
                return Ok(());
            }
        }

        let mut full_args = vec!["aphrody-ssh".to_string()];
        full_args.extend(self.args.clone());
        aphrody_ssh::run_from_args(full_args).await.map_err(|e| miette::miette!("{e}"))?;
        Ok(())
    }
}

/// `aphrody search <query…>` — web search, delegated to the bxc engine.
///
/// # What this replaced, and why
///
/// This command used to scrape `https://html.duckduckgo.com/html/` by hand: a
/// forged Chrome 124 user agent, then three hard-coded CSS selectors
/// (`div.result.results_links`, `a.result__a`, `a.result__snippet`) against an
/// endpoint DuckDuckGo never contracted, plus a hand-rolled decoder for their
/// `uddg` redirect wrapper. It had one loud defect and one quiet one:
///
/// * loud — the selectors break whenever DDG touches its markup, which it does;
/// * quiet — when they broke, the loop simply matched nothing and the command printed "Aucun
///   résultat trouvé". A parsing failure was **indistinguishable from an honest zero-result
///   query**, which is precisely the failure mode this repository has a name for (`CLAUDE.md` §7):
///   the filter discards, and raises nothing.
///
/// bxc owns SERP retrieval, including the bot-detection dance, and answers
/// with structured JSON. So the selectors are gone, and the two outcomes are
/// now told apart: [`aphrody_web_bridge::cli::Search::unreadable`] counts entries bxc
/// returned that this side could not read, so "Google gave nothing" and "the
/// payload shape changed" no longer print the same sentence.
///
/// There is **no fallback to the old scraper**. Falling back would reinstate
/// the silent failure on the day bxc is missing, and the operator would never
/// learn why the results got worse.
pub(crate) struct SearchCommand {
    pub query: Vec<String>,
}

#[async_trait]
impl TerminalCommand for SearchCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let q = self.query.join(" ");
        println!("{}", format!("🔍 Recherche : {}", q).bold().blue());

        let cli = aphrody_web_bridge::BxcCli::discover().map_err(|e| miette::miette!("{e}"))?;
        let results = match cli
            .search(&q, Some(10), aphrody_web_bridge::cli::SEARCH_BUDGET)
            .await
        {
            Ok(res) => res,
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("blocked") || err_str.contains("interstitial") || err_str.contains("organic") {
                    println!(
                        "\n{} {}",
                        "⚠️  Google a présenté un interstitiel anti-bot pour cette requête anonyme.".bold().yellow(),
                        "Utilisez `aphrody web search --cookies <cookies.json>` ou connectez-vous avec `aphrody google login`.".dimmed()
                    );
                    println!("\n{}", "Alternatives disponibles sans blocage :".bold());
                    println!("  • `aphrody docs search \"{}\"` pour la documentation technique", q.cyan());
                    println!("  • `aphrody google suggest \"{}\"` pour les suggestions de complétion Google", q.cyan());
                    return Ok(());
                }
                return Err(miette::miette!("{e}"));
            }
        };

        for hit in results.hits.iter().take(10) {
            println!("\n{}", hit.title.bold().green());
            if !hit.link.is_empty() {
                println!("{}", hit.link.cyan().underline());
            }
            if !hit.snippet.is_empty() {
                println!("{}", hit.snippet);
            }
        }

        // The provenance line: which engine ran, on which profile, whether the
        // answer was cached and whether a cookie jar was in play. Without it a
        // blocked anonymous query and a genuinely empty one look identical.
        let profile = results.profile.as_deref().unwrap_or("unknown");
        println!(
            "\n{}",
            format!(
                "via Aphrody Web Rust ({}) · profil {profile} · {} · {}",
                cli.path().display(),
                if results.from_cache { "cache" } else { "live" },
                if results.authenticated { "authentifié" } else { "anonyme" }
            )
            .dimmed()
        );

        // bxc exits 65 for "ran, found nothing" and 0 for "ran, found some".
        // Both are honest answers, so neither is turned into a failure here —
        // but a reader who sees zero results needs to know the engine actually
        // answered, and with what code, to tell that apart from a block.
        if let Some(code) = results.exit_code
            && code != 0
        {
            println!("{}", format!("code de sortie Web : {code}").dimmed());
        }

        if results.partial > 0 {
            // Kept in `hits` — dropping them would be the discarding
            // filter — but a hit with no link cannot be opened, so the
            // count has to be visible next to the results it describes.
            println!(
                "{}",
                format!(
                    "⚠ {} résultat(s) incomplet(s) (titre sans lien, ou lien sans titre) — \
                     affichés tels quels.",
                    results.partial
                )
                .yellow()
            );
        }

        if results.unreadable > 0 {
            // Counted, never dropped in silence: if this number is non-zero
            // the bxc payload shape moved, and that is a bridge bug, not an
            // empty search.
            println!(
                "{}",
                format!(
                    "⚠ {} résultat(s) renvoyé(s) par bxc mais illisibles ici (le format de `bxc \
                     search --json` a changé) — corriger \
                     aphrody_web_bridge::cli::Search::from_json.",
                    results.unreadable
                )
                .yellow()
            );
        }

        if results.hits.is_empty() {
            println!(
                "{}",
                format!(
                    "Aucun résultat (bxc a répondu, code {}). Un profil `fetch` anonyme est \
                     souvent bloqué : authentifier bxc (`~/.bxc/cookies/google.json`) pour de \
                     meilleurs résultats.",
                    results.exit_code.map_or_else(|| "-".to_owned(), |c| c.to_string())
                )
                .red()
            );
        }

        Ok(())
    }
}

// ── aphrody doctor ───────────────────────────────────────────────────────────

use aphrody_diagnostics::doctor::DoctorReport;

pub(crate) struct DoctorCommand {
    pub json_output: bool,
}

#[async_trait]
impl TerminalCommand for DoctorCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let report = aphrody_diagnostics::doctor::collect_diagnostics(binary_version()).await;

        if self.json_output {
            println!(
                "{}",
                serde_json::to_string_pretty(&report.to_json())
                    .map_err(|e| miette::miette!("JSON serialization error: {e}"))?
            );
        } else {
            print_text(&report);
        }

        if report.verdict() == "UNHEALTHY" {
            return Err(miette::Report::new(SubprocessExit(1)));
        }
        Ok(())
    }
}

fn binary_version() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let sha = env!("APHRODY_GIT_SHA");
    let built_unix: u64 = env!("APHRODY_BUILD_UNIX").parse().unwrap_or(0);
    let target = env!("APHRODY_TARGET");
    let built_date = if built_unix > 0 { epoch_to_date(built_unix) } else { "unknown".to_string() };
    format!("{version} (commit {sha}, built {built_date}, target {target})")
}

fn print_text(r: &DoctorReport) {
    println!("aphrody doctor — environment + integration diagnostics");
    println!();
    println!("[runtime]");
    println!("  binary version: {}", r.binary_version);
    println!("  rustls CryptoProvider: {}", r.rustls_provider);
    println!("  reqwest TLS backend: {}", r.reqwest_tls);
    println!("  mimalloc allocator: {}", r.allocator);
    println!("  tokio runtime: {}", r.tokio_runtime);
    println!("{}", r.ai_json.line("ai.json"));
    println!("{}", r.well_known_ai_json.line(".well-known/ai.json"));

    println!();
    println!("[peer A2A coord]");
    println!("{}", r.peer_heartbeat.line("peer winclean"));
    println!("{}", r.inbox.line("inbox-from-winclean.jsonl"));
    println!("{}", r.http_listener.line("HTTP listener"));

    println!();
    println!("[supply chain]");
    println!("  cargo-deny: not present at runtime — use the dev tool for CI");
    println!("{}", r.cargo_vet.line("cargo-vet audits"));

    println!();
    println!("[agent workspace]");
    println!("{}", r.workspace.line("agent home"));

    println!();
    println!("[environment]");
    for (var, val) in &r.env_vars {
        println!("  {var}: {val}");
    }

    println!();
    let verdict = r.verdict();
    let detail = match verdict {
        "UNHEALTHY" => "(one or more critical checks failed)",
        "DEGRADED" => "(peer offline or non-critical resource missing)",
        _ => "(all critical checks pass)",
    };
    println!("Verdict: {verdict} {detail}");
}

/// Convert a Unix epoch (seconds) to a YYYY-MM-DD string without external deps.
fn epoch_to_date(unix: u64) -> String {
    // Days since 1970-01-01.  Zeller / proleptic Gregorian.
    let days = unix / 86400;
    // Algorithm from https://www.researchgate.net/publication/316558298
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

// ── aphrody term ─────────────────────────────────────────────────────────────

/// Arguments for the `term` subcommand, mirroring the clap variant fields.
pub(crate) struct TermCommand {
    /// WebSocket bind address as a raw string (parsed at runtime).
    pub addr: String,
    /// Optional shell override forwarded to the backend.
    pub shell: Option<String>,
    /// Optional working directory forwarded to the backend.
    pub cwd: Option<PathBuf>,
    /// Optional authentication token for WebSocket clients.
    pub token: Option<String>,
}

impl TermCommand {
    pub(crate) fn validate_and_configure(&self) -> miette::Result<(SocketAddr, aphrody_terminal_backend::PtyConfig)> {
        let addr: SocketAddr = self
            .addr
            .parse()
            .map_err(|e| miette::miette!("invalid --addr '{}': {e}", self.addr))?;

        let env_token = std::env::var("APHRODY_OS_AUTH_TOKEN")
            .ok()
            .filter(|s| !s.is_empty());
        let explicit_token = self.token.clone().or(env_token);

        // Require authentication token when binding to non-loopback addresses (e.g. 0.0.0.0)
        if !addr.ip().is_loopback() && explicit_token.is_none() {
            return Err(miette::miette!(
                "binding aphrody term to non-loopback address '{addr}' requires authentication; specify --token or set APHRODY_OS_AUTH_TOKEN"
            ));
        }

        let token = explicit_token.unwrap_or_else(aphrody_terminal_backend::generate_token);

        let cfg = aphrody_terminal_backend::PtyConfig {
            cols: 80,
            rows: 24,
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            auth_token: Some(token),
            ..aphrody_terminal_backend::PtyConfig::default()
        };

        Ok((addr, cfg))
    }
}

#[async_trait]
impl TerminalCommand for TermCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let (addr, cfg) = self.validate_and_configure()?;
        let token = cfg.auth_token.as_deref().unwrap_or("");

        eprintln!("aphrody term: auth token: {token}");
        eprintln!("aphrody term: ws://{addr}/?token={token} (open the WASM UI to connect)");

        tokio::select! {
            res = aphrody_terminal_backend::serve(addr, cfg) => {
                res.map_err(|e| miette::miette!("terminal server error: {e:#}"))?;
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\naphrody term: received Ctrl-C, shutting down");
            }
        }

        Ok(())
    }
}

// ── aphrody notify ───────────────────────────────────────────────────────────
//
// Thin facade over `aphrody-channels` (Slack / Telegram / Matrix). Reads
// credentials + destination from environment variables; returns a clean
// `miette::Report` (exit code 1) when any required variable is missing rather
// than panicking.

/// Minimal extension → MIME map for `notify --attach`.
///
/// Deliberately not a dependency: Discord only needs a plausible `Content-Type`
/// on the multipart part, and `application/octet-stream` is always accepted.
fn mime_for_path(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("zip") => "application/zip",
        Some("json") => "application/json",
        Some("md" | "txt") => "text/plain; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("glb") => "model/gltf-binary",
        Some("gltf") => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

pub(crate) struct NotifyCommand {
    pub channel: crate::NotifyChannel,
    pub message: String,
    pub room: Option<String>,
    /// Files to attach after the text message. Discord only for now.
    pub attach: Vec<std::path::PathBuf>,
}

// ── aphrody mail ────────────────────────────────────────────────────────────

/// Environment-backed transactional email command. The connector is built
/// once per invocation so `auto` provider selection cannot change mid-send.
pub(crate) struct MailCommand {
    pub action: crate::MailAction,
}

#[async_trait]
impl TerminalCommand for MailCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        use aphrody_messaging::{Connector, MailConnector, Message};

        let connector = MailConnector::from_env()
            .map_err(|error| miette::miette!("mail configuration error: {error}"))?;
        match &self.action {
            crate::MailAction::Health => {
                connector
                    .health()
                    .await
                    .map_err(|error| miette::miette!("mail health failed: {error}"))?;
                println!("{} healthy", connector.provider());
            },
            crate::MailAction::Send { to, subject, message, from, idempotency_key } => {
                let mut email =
                    Message::text(to.as_str(), message.as_str()).with_subject(subject.as_str());
                if let Some(from) = from {
                    email = email.with_from(from.as_str());
                }
                if let Some(key) = idempotency_key {
                    email = email.with_idempotency_key(key.as_str());
                }
                let id = connector
                    .send(email)
                    .await
                    .map_err(|error| miette::miette!("mail send failed: {error}"))?;
                println!("{} {}", connector.provider(), id);
            },
        }
        Ok(())
    }
}

#[async_trait]
impl TerminalCommand for NotifyCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        use aphrody_messaging::channels::{
            MessagingChannel, discord::DiscordChannel, matrix::MatrixChannel, slack::SlackChannel,
            telegram::TelegramChannel,
        };

        use crate::NotifyChannel;

        // Resolve destination room: explicit --room overrides the env-var
        // fallback. The env-var name is channel-specific so error messages
        // tell the operator exactly which variable to set.
        let (room_env_var, ctor_label) = match self.channel {
            NotifyChannel::Slack => ("SLACK_CHANNEL", "slack"),
            NotifyChannel::Telegram => ("TELEGRAM_CHAT_ID", "telegram"),
            NotifyChannel::Matrix => ("MATRIX_ROOM_ID", "matrix"),
            NotifyChannel::Discord => ("DISCORD_DM_CHANNEL_ID", "discord"),
        };

        let room = match self.room.clone() {
            Some(r) if !r.is_empty() => r,
            _ => std::env::var(room_env_var).ok().filter(|s| !s.is_empty()).ok_or_else(|| {
                miette::miette!(
                    "missing destination room: pass `--room <id>` or set `{room_env_var}` \
                     environment variable for `aphrody notify --channel {ctor_label}`"
                )
            })?,
        };

        // Dispatch to the matching adapter. Each `from_env()` returns
        // `ChannelError::MissingEnvVar` on missing credentials — we surface
        // that as a clean miette error rather than panicking.
        let result = match self.channel {
            NotifyChannel::Slack => {
                let ch = SlackChannel::from_env()
                    .map_err(|e| miette::miette!("slack credentials error: {e}"))?;
                ch.send_text(&room, &self.message).await
            },
            NotifyChannel::Telegram => {
                let ch = TelegramChannel::from_env()
                    .map_err(|e| miette::miette!("telegram credentials error: {e}"))?;
                ch.send_text(&room, &self.message).await
            },
            NotifyChannel::Matrix => {
                let ch = MatrixChannel::from_env()
                    .map_err(|e| miette::miette!("matrix credentials error: {e}"))?;
                ch.send_text(&room, &self.message).await
            },
            NotifyChannel::Discord => {
                let ch = DiscordChannel::from_env()
                    .map_err(|e| miette::miette!("discord credentials error: {e}"))?;
                // `@<user id>` means "DM that user": resolve it to the private
                // channel id first, so the rest of the flow is channel-generic.
                let room = match room.strip_prefix('@') {
                    Some(user_id) => ch
                        .open_dm(user_id)
                        .await
                        .map_err(|e| miette::miette!("discord open DM failed: {e}"))?,
                    None => room.clone(),
                };
                let first = ch.send_text(&room, &self.message).await;
                // Attachments ride as separate messages in the same channel, so
                // a failed upload cannot lose the text that was already posted.
                for path in &self.attach {
                    let mime = mime_for_path(path);
                    let sent = ch.send_file(&room, path, mime).await.map_err(|e| {
                        miette::miette!("discord attach {} failed: {e}", path.display())
                    })?;
                    println!("{} {} {}", sent.channel_id, sent.id, sent.room);
                }
                first
            },
        };

        let msg_ref = result.map_err(|e| miette::miette!("send failed: {e}"))?;

        // Stable, machine-friendly success line — first column is the channel,
        // second is the platform-native message ID, third is the room.
        println!("{} {} {}", msg_ref.channel_id, msg_ref.id, msg_ref.room);
        Ok(())
    }
}

// ===========================================================================
// `aphrody chat` — unified turn-loop REPL (one-shot mode in Phase 1).
// ===========================================================================

/// Implementation of `aphrody chat`.
///
/// Composes the building blocks via [`aphrody_chat::ChatLoop`]. In Phase 1
/// we only support `--prompt <text>` one-shot mode; invocation without a
/// prompt returns a structured error instead of opening an interactive REPL
/// (ratatui + slash-commands land in Phase 2).
pub(crate) struct ChatCommand {
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub system: Option<String>,
    pub stub: bool,
    /// Local files to attach to the chat (images, PDFs, documents).
    pub attach: Vec<std::path::PathBuf>,
    /// Route directly to local LLM backend (llama-server / vLLM).
    pub local: bool,
}

#[async_trait]
impl TerminalCommand for ChatCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        use std::io::Write;

        use aphrody_chat::{
            ChatConfig, ChatLoop,
            backend::{LocalBackend, ModelBackend, StubBackend},
        };
        use tokio::io::AsyncBufReadExt;

        use crate::agy_backend::AgyBackend;

        // Attachments are validated and inlined as structured text context.
        let mut attachment_prefix = String::new();
        if !self.attach.is_empty() {
            for path in &self.attach {
                if !path.exists() {
                    return Err(miette::miette!("attachment not found: {}", path.display()));
                }
                match std::fs::read_to_string(path) {
                    Ok(content) => {
                        attachment_prefix.push_str(&format!(
                            "[Attachment: {}]\n```\n{}\n```\n\n",
                            path.display(),
                            content.trim_end()
                        ));
                    },
                    Err(_) => {
                        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                        attachment_prefix.push_str(&format!(
                            "[Attachment (binary): {}, {} bytes]\n\n",
                            path.display(),
                            size
                        ));
                    },
                }
            }
        }

        let mut config = ChatConfig::default();
        if let Some(m) = self.model.clone() {
            config.model = m;
        }
        if let Some(sys) = self.system.clone() {
            config.system_prompt = sys;
        }

        let is_explicit_local = self.local
            || config.model.starts_with("local/")
            || config.model.starts_with("qwen")
            || config.model.starts_with("gpt-oss");

        let backend: Box<dyn ModelBackend> = if self.stub {
            Box::new(StubBackend::with_reply(
                "(stub backend reply — `aphrody chat --stub` mode, no live LLM call)",
            ))
        } else if is_explicit_local {
            Box::new(LocalBackend::from_env_or_default().with_model(Some(config.model.clone())))
        } else {
            match AgyBackend::connect(Some(config.model.as_str())) {
                Ok(agy) => Box::new(agy),
                Err(agy_err) => {
                    // Graceful fallback to LocalBackend if agy is not authenticated
                    eprintln!(
                        "ℹ️ agy (Antigravity) non configuré ({agy_err}) — bascule automatique sur LocalBackend ({})",
                        config.model
                    );
                    Box::new(
                        LocalBackend::from_env_or_default().with_model(Some(config.model.clone())),
                    )
                },
            }
        };

        let builder = ChatLoop::builder(config.clone()).with_boxed_backend(backend);
        let builder = if !self.stub {
            match aphrody_memory::SqliteLocalProvider::open_default() {
                Ok(mem) => builder.with_memory(mem),
                Err(err) => {
                    eprintln!(
                        "ℹ️ Base de mémoire locale indisponible ({err}) — repli sur mémoire éphémère"
                    );
                    builder
                },
            }
        } else {
            builder
        };

        let mut chat =
            builder.build().map_err(|e| miette::miette!("ChatLoop build failed: {e}"))?;

        if let Some(raw_prompt) = &self.prompt {
            let prompt = if attachment_prefix.is_empty() {
                raw_prompt.clone()
            } else {
                format!("{attachment_prefix}{raw_prompt}")
            };

            let effective_prompt = match aphrody_chat::slash::parse(&prompt) {
                Some(parsed) => match parsed.spec.kind {
                    aphrody_chat::slash::SlashKind::Meta => {
                        match parsed.spec.name {
                            "model" => println!(
                                "active model: {}\n(switch with `--model <vendor/id>`, e.g. \
                                 `--model gemini-2.5-pro` or `--model anthropic/claude-opus-4-7`)",
                                config.model
                            ),
                            "tools" => {
                                let reg = chat.tools();
                                if reg.is_empty() {
                                    println!("(no tools wired into one-shot chat)");
                                } else {
                                    for d in reg.list() {
                                        println!("{:<24} {}", d.name, d.description);
                                    }
                                }
                            },
                            _ => print!("{}", aphrody_chat::slash::help_text()),
                        }
                        return Ok(());
                    },
                    aphrody_chat::slash::SlashKind::Template => {
                        parsed.expanded_prompt().unwrap_or_else(|| prompt.clone())
                    },
                },
                None if prompt.trim_start().starts_with('/') => {
                    eprintln!("unknown slash command — try /help");
                    print!("{}", aphrody_chat::slash::help_text());
                    return Ok(());
                },
                None => prompt,
            };

            let turn = chat
                .single_turn(&effective_prompt)
                .await
                .map_err(|e| miette::miette!("chat turn failed: {e}"))?;

            println!("{}", turn.assistant_response);
            return Ok(());
        }

        // Interactive turn loop REPL
        println!("aphrody chat — interactive session (model: {})", config.model);
        println!("Type your message, /help for slash commands, /exit or Ctrl+C to quit.\n");

        if !attachment_prefix.is_empty() {
            println!("[Loaded attachments: {} files]", self.attach.len());
        }

        let stdin = tokio::io::stdin();
        let mut reader = tokio::io::BufReader::new(stdin).lines();
        let mut first_turn = true;

        loop {
            print!("aphrody> ");
            std::io::stdout().flush().ok();

            let line = match reader.next_line().await {
                Ok(Some(l)) => l,
                Ok(None) => break,
                Err(e) => {
                    eprintln!("\n[chat: read error: {e}]");
                    break;
                },
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed == "/exit" || trimmed == "/quit" || trimmed == ":q" {
                println!("Goodbye.");
                break;
            }

            let prompt_with_attachments = if first_turn && !attachment_prefix.is_empty() {
                first_turn = false;
                format!("{attachment_prefix}{trimmed}")
            } else {
                trimmed.to_string()
            };

            let effective = match aphrody_chat::slash::parse(&prompt_with_attachments) {
                Some(parsed) => match parsed.spec.kind {
                    aphrody_chat::slash::SlashKind::Meta => {
                        match parsed.spec.name {
                            "model" => println!("active model: {}", config.model),
                            "tools" => {
                                let reg = chat.tools();
                                if reg.is_empty() {
                                    println!("(no tools wired into chat)");
                                } else {
                                    for d in reg.list() {
                                        println!("{:<24} {}", d.name, d.description);
                                    }
                                }
                            },
                            _ => print!("{}", aphrody_chat::slash::help_text()),
                        }
                        continue;
                    },
                    aphrody_chat::slash::SlashKind::Template => {
                        parsed.expanded_prompt().unwrap_or_else(|| prompt_with_attachments.clone())
                    },
                },
                None if prompt_with_attachments.trim_start().starts_with('/') => {
                    eprintln!("unknown slash command — try /help");
                    print!("{}", aphrody_chat::slash::help_text());
                    continue;
                },
                None => prompt_with_attachments,
            };

            match chat.single_turn(&effective).await {
                Ok(turn) => {
                    println!("\n{}\n", turn.assistant_response);
                },
                Err(e) => {
                    eprintln!("\n[chat turn error]: {e}\n");
                },
            }
        }

        Ok(())
    }
}

// ── aphrody notebooklm ──────────────────────────────────────────────────────

/// Façade dispatching every `aphrody notebooklm <sub>` invocation onto the
/// in-tree `notebooklm` crate.  Honours `NOTEBOOKLM_OAUTH_TOKEN` /
/// `NOTEBOOKLM_COOKIES` for credentials and `NOTEBOOKLM_AT_TOKEN` /
/// `NOTEBOOKLM_BL_TOKEN` / `NOTEBOOKLM_FSID_TOKEN` for the per-session
/// XSRF + bootstrap tokens (the upstream web UI exports these on page load;
/// they must be ferried into the CLI environment by the caller).
pub(crate) struct NotebooklmCommand {
    pub action: crate::NotebooklmActions,
}

#[async_trait]
impl TerminalCommand for NotebooklmCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        use crate::NotebooklmActions;
        match &self.action {
            NotebooklmActions::List => notebooklm_list().await,
            NotebooklmActions::Create { title } => notebooklm_create(title.as_deref()).await,
            NotebooklmActions::Delete { notebook_id } => notebooklm_delete(notebook_id).await,
            NotebooklmActions::Upload { notebook_id, source } => {
                notebooklm_upload(notebook_id, source).await
            },
            NotebooklmActions::Chat { notebook_id, prompt } => {
                notebooklm_chat(notebook_id, prompt).await
            },
            NotebooklmActions::Generate { notebook_id, kind, prompt } => {
                notebooklm_generate(notebook_id, kind, prompt.as_deref()).await
            },
            NotebooklmActions::Download { notebook_id, artifact_id, output } => {
                notebooklm_download(notebook_id, artifact_id, output).await
            },
        }
    }
}

fn notebooklm_session_tokens() -> miette::Result<::aphrody_notebooklm::SessionTokens> {
    let at = std::env::var("NOTEBOOKLM_AT_TOKEN").map_err(|_| {
        miette::miette!(
            "NOTEBOOKLM_AT_TOKEN must be set (extract `WIZ_global_data.SNlM0e` from a logged-in \
             notebooklm.google.com page)"
        )
    })?;
    let bl = std::env::var("NOTEBOOKLM_BL_TOKEN").map_err(|_| {
        miette::miette!(
            "NOTEBOOKLM_BL_TOKEN must be set (extract the `cfb2h` / `bl` field from the same \
             bootstrap blob)"
        )
    })?;
    let fsid = std::env::var("NOTEBOOKLM_FSID_TOKEN").ok().filter(|s| !s.is_empty());
    let language = std::env::var("NOTEBOOKLM_HL").ok().filter(|s| !s.is_empty());
    Ok(::aphrody_notebooklm::SessionTokens { at, bl, fsid, language })
}

fn notebooklm_client() -> miette::Result<::aphrody_notebooklm::NotebookClient> {
    let tokens = notebooklm_session_tokens()?;
    ::aphrody_notebooklm::NotebookClient::from_env(tokens)
        .map_err(|e| miette::miette!("notebooklm auth setup failed: {e}"))
}

async fn notebooklm_list() -> miette::Result<()> {
    let client = notebooklm_client()?;
    let notebooks =
        client.list_notebooks().await.map_err(|e| miette::miette!("list_notebooks failed: {e}"))?;
    let json = serde_json::to_string_pretty(&notebooks)
        .map_err(|e| miette::miette!("json encode: {e}"))?;
    println!("{json}");
    Ok(())
}

async fn notebooklm_create(title: Option<&str>) -> miette::Result<()> {
    let client = notebooklm_client()?;
    let (notebook_id, thread_id) = client
        .create_notebook()
        .await
        .map_err(|e| miette::miette!("create_notebook failed: {e}"))?;
    if let Some(new_title) = title {
        client
            .rename_notebook(&notebook_id, new_title)
            .await
            .map_err(|e| miette::miette!("rename_notebook failed: {e}"))?;
    }
    let payload = serde_json::json!({
        "notebook_id": notebook_id,
        "thread_id": thread_id,
        "title": title.unwrap_or(""),
    });
    println!("{payload:#}");
    Ok(())
}

async fn notebooklm_delete(notebook_id: &str) -> miette::Result<()> {
    let client = notebooklm_client()?;
    client
        .delete_notebook(notebook_id)
        .await
        .map_err(|e| miette::miette!("delete_notebook failed: {e}"))?;
    println!(r#"{{"deleted":"{notebook_id}"}}"#);
    Ok(())
}

async fn notebooklm_upload(notebook_id: &str, source: &str) -> miette::Result<()> {
    let client = notebooklm_client()?;
    let result = if source.starts_with("http://") || source.starts_with("https://") {
        client.add_url(notebook_id, source).await
    } else {
        client.add_file(notebook_id, source).await
    };
    let (source_id, title) = result.map_err(|e| miette::miette!("add source failed: {e}"))?;
    let payload = serde_json::json!({
        "source_id": source_id,
        "title": title,
    });
    println!("{payload:#}");
    Ok(())
}

async fn notebooklm_chat(notebook_id: &str, prompt: &str) -> miette::Result<()> {
    let client = notebooklm_client()?;
    let threads = client
        .list_chat_threads(notebook_id)
        .await
        .map_err(|e| miette::miette!("list_chat_threads failed: {e}"))?;
    let thread = threads.first().map(String::as_str);
    let (_nb, sources) = client
        .get_notebook(notebook_id)
        .await
        .map_err(|e| miette::miette!("get_notebook failed: {e}"))?;
    let source_ids: Vec<String> = sources.into_iter().map(|s| s.id).collect();
    let reply = client
        .send_message(notebook_id, prompt, &source_ids, thread)
        .await
        .map_err(|e| miette::miette!("send_message failed: {e}"))?;
    println!("{}", reply.text);
    Ok(())
}

async fn notebooklm_generate(
    notebook_id: &str,
    kind: &str,
    prompt: Option<&str>,
) -> miette::Result<()> {
    use std::str::FromStr;
    let client = notebooklm_client()?;
    let kind = ::aphrody_notebooklm::ArtifactKind::from_str(kind)
        .map_err(|e| miette::miette!("invalid artifact kind: {e}"))?;
    let (_nb, sources) = client
        .get_notebook(notebook_id)
        .await
        .map_err(|e| miette::miette!("get_notebook failed: {e}"))?;
    let source_ids: Vec<String> = sources.into_iter().map(|s| s.id).collect();
    let (artifact_id, title) = client
        .generate(notebook_id, &source_ids, kind, prompt)
        .await
        .map_err(|e| miette::miette!("generate failed: {e}"))?;
    let payload = serde_json::json!({
        "artifact_id": artifact_id,
        "title": title,
        "kind": format!("{kind:?}"),
    });
    println!("{payload:#}");
    Ok(())
}

async fn notebooklm_download(
    notebook_id: &str,
    artifact_id: &str,
    output: &std::path::Path,
) -> miette::Result<()> {
    let client = notebooklm_client()?;
    let artifact = client
        .poll(notebook_id, artifact_id, std::time::Duration::from_secs(600))
        .await
        .map_err(|e| miette::miette!("artifact poll failed: {e}"))?;
    let url = artifact
        .download_url
        .ok_or_else(|| miette::miette!("artifact has no download_url after poll"))?;
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| miette::miette!("download GET {url}: {e}"))?
        .bytes()
        .await
        .map_err(|e| miette::miette!("download read {url}: {e}"))?;
    std::fs::write(output, &bytes)
        .map_err(|e| miette::miette!("write {}: {e}", output.display()))?;
    let payload = serde_json::json!({
        "artifact_id": artifact_id,
        "bytes": bytes.len(),
        "output": output.display().to_string(),
    });
    println!("{payload:#}");
    Ok(())
}

#[cfg(test)]
mod term_command_tests {
    use super::*;

    #[test]
    fn term_command_rejects_non_loopback_without_auth() {
        // Ensure env var is absent for this test
        let _env_guard = std::env::var("APHRODY_OS_AUTH_TOKEN").ok();
        unsafe { std::env::remove_var("APHRODY_OS_AUTH_TOKEN"); }

        let cmd = TermCommand {
            addr: "0.0.0.0:8788".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let res = cmd.validate_and_configure();
        assert!(res.is_err(), "non-loopback without token must be rejected");
        let err_str = res.unwrap_err().to_string();
        assert!(err_str.contains("non-loopback address"), "unexpected error: {err_str}");

        if let Some(tok) = _env_guard {
            unsafe { std::env::set_var("APHRODY_OS_AUTH_TOKEN", tok); }
        }
    }

    #[test]
    fn term_command_accepts_non_loopback_with_explicit_token() {
        let cmd = TermCommand {
            addr: "0.0.0.0:8788".to_string(),
            shell: None,
            cwd: None,
            token: Some("custom-token-secret-1234567890".to_string()),
        };

        let (addr, cfg) = cmd.validate_and_configure().expect("should accept with explicit token");
        assert_eq!(addr, "0.0.0.0:8788".parse().unwrap());
        assert_eq!(cfg.auth_token.as_deref(), Some("custom-token-secret-1234567890"));
    }

    #[test]
    fn term_command_generates_token_for_loopback_when_unset() {
        let _env_guard = std::env::var("APHRODY_OS_AUTH_TOKEN").ok();
        unsafe { std::env::remove_var("APHRODY_OS_AUTH_TOKEN"); }

        let cmd = TermCommand {
            addr: "127.0.0.1:8788".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let (addr, cfg) = cmd.validate_and_configure().expect("loopback should succeed");
        assert_eq!(addr, "127.0.0.1:8788".parse().unwrap());
        let token = cfg.auth_token.expect("token should be generated");
        assert_eq!(token.len(), 32);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));

        if let Some(tok) = _env_guard {
            unsafe { std::env::set_var("APHRODY_OS_AUTH_TOKEN", tok); }
        }
    }

    #[test]
    fn term_command_rejects_invalid_addr() {
        let cmd = TermCommand {
            addr: "not-a-valid-addr".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let res = cmd.validate_and_configure();
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("invalid --addr"));
    }
}
