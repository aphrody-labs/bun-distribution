//! `aphrody infra remote`: remote control over the private tunnel, one target model and one
//! credential source for the WebSocket desktop, RFB (VNC), MCP computer use and the shell.

use aphrody_proc::NoWindow as _;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result, bail};
use aphrody_remote_desktop as rd;
use aphrody_wireguard::{Backend, Inventory, Tunnel};
use clap::Subcommand;
use rd::target::{RemoteTarget, TargetKind};
use rd::tokens::{self, TokenKind};
use serde_json::{Value, json};

#[derive(Debug, Subcommand)]
pub enum RemoteCommand {
    /// Serve the desktop of this host: browser viewer (WebSocket) and RFB for any VNC viewer.
    /// Bind a tunnel address, e.g. `--bind 10.200.77.10:8795` (VNC then on 10.200.77.10:5900).
    Serve {
        #[arg(long, default_value = "127.0.0.1:8795")]
        bind: SocketAddr,
        /// Bearer token (default: APHRODY_REMOTE_TOKEN, else <aphrody home>/private/remote.token,
        /// else generated and printed once).
        #[arg(long, env = "APHRODY_REMOTE_TOKEN", hide_env_values = true)]
        token: Option<String>,
        /// RFB listener (default: the --bind address on port 5900).
        #[arg(long)]
        vnc: Option<SocketAddr>,
        /// Do not start the RFB server.
        #[arg(long, conflicts_with = "vnc")]
        no_vnc: bool,
        /// Peers admitted by the RFB server besides loopback: addresses, CIDRs or `any`
        /// (default: tunnel members granted a `vnc-*` service in the inventory).
        #[arg(long = "vnc-allow", value_delimiter = ',')]
        vnc_allow: Vec<String>,
        #[arg(long, default_value_t = 15)]
        fps: u32,
        #[arg(long, default_value_t = 70)]
        quality: u8,
        #[arg(long, default_value_t = 1)]
        scale: u8,
    },
    /// Aggregated state: local capture backend, tunnel handshakes and reachability of the remote
    /// servers (WebSocket desktop, VNC, MCP, shell). Targets default to every declared service.
    Status {
        /// Targets (`omar`, `vnc://10.200.77.10`, `http://host:8793`...).
        targets: Vec<String>,
        #[arg(long, default_value_t = 2000)]
        timeout_ms: u64,
    },
    /// Write one JPEG frame of this desktop.
    Snapshot {
        #[arg(long, default_value = "remote-snapshot.jpg")]
        out: PathBuf,
        #[arg(long, default_value_t = 80)]
        quality: u8,
        #[arg(long, default_value_t = 1)]
        scale: u8,
    },
    /// Open the browser viewer of a remote host (inventory member, `host[:port]` or `ws://`).
    Open {
        target: String,
        /// Bearer token (default: the credential store for that target).
        #[arg(long, env = "APHRODY_REMOTE_TOKEN", hide_env_values = true)]
        token: Option<String>,
    },
    /// Connect to any VNC server (`vnc://host:port`, inventory member or `host[:port]`) and
    /// optionally act on it.
    Connect {
        target: String,
        /// RFB password (default: the credential store for that target; none if absent).
        #[arg(long, env = "APHRODY_VNC_PASSWORD", hide_env_values = true)]
        password: Option<String>,
        /// Write a JPEG screenshot.
        #[arg(long)]
        screenshot: Option<PathBuf>,
        /// Left click at `x,y`.
        #[arg(long)]
        click: Option<String>,
        /// Type text.
        #[arg(long = "type")]
        text: Option<String>,
        /// Press a key or shortcut (`Enter`, `ctrl+s`).
        #[arg(long)]
        key: Option<String>,
    },
    /// Credential store (`<aphrody home>/private`): where each channel's secret comes from.
    Token {
        #[command(subcommand)]
        action: TokenAction,
    },
    /// Keep this Windows tunnel member reachable unattended: hidden self-healing tasks (wg1 at
    /// boot as SYSTEM, remote desktop + VNC, MCP HTTP, reverse SSH tunnel to the hub, WSL sshd),
    /// MCP portproxy on the tunnel address, no sleep on mains power, WSL mirrored networking.
    /// Relaunches itself elevated (sudo.exe inline, else UAC).
    AlwaysOnline {
        /// Inventory member configured on this PC.
        #[arg(long, default_value = "omar")]
        member: String,
        /// SSH user on the hub for the reverse tunnel (default: the member id).
        #[arg(long)]
        hub_user: Option<String>,
        /// WSL distribution running sshd on port 2222.
        #[arg(long, default_value = "Ubuntu")]
        distro: String,
        /// SSH key of the reverse tunnel (default: ~/.ssh/id_ed25519).
        #[arg(long)]
        identity_file: Option<PathBuf>,
        /// Installed `aphrody.exe` the tasks run (default: %LOCALAPPDATA%\Aphrody\bin\aphrody.exe;
        /// `aphrody-mcp.exe` is its sibling).
        #[arg(long)]
        aphrody: Option<PathBuf>,
        #[arg(long)]
        no_wsl: bool,
        #[arg(long)]
        no_reverse: bool,
        /// Print the plan, change nothing.
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum TokenAction {
    /// Show the source (never the value) of every channel's credential.
    Status {
        /// Scope (inventory member id).
        #[arg(long)]
        target: Option<String>,
    },
    /// Store a credential read from stdin, or a generated one with --generate.
    Set {
        /// remote, mcp, vnc or shell.
        kind: String,
        /// Scope (inventory member id); global when omitted.
        #[arg(long)]
        target: Option<String>,
        /// Generate a random value instead of reading stdin (printed once).
        #[arg(long)]
        generate: bool,
    },
}

/// Addresses granted the `vnc-*` service served at `listen` (the default RFB allowlist); every
/// `vnc-*` service when none is declared at that address (loopback bind).
pub(crate) fn vnc_grantees(inventory: &Inventory, listen: &str) -> Vec<String> {
    let all = || inventory.services.iter().filter(|s| s.id == "vnc" || s.id.starts_with("vnc-"));
    let own: Vec<&str> = all().filter(|s| s.address == listen).map(|s| s.id.as_str()).collect();
    let vnc = if own.is_empty() { all().map(|s| s.id.as_str()).collect() } else { own };
    inventory
        .grants
        .iter()
        .filter(|(_, granted)| granted.iter().any(|g| vnc.contains(&g.as_str())))
        .filter_map(|(id, _)| inventory.address_of(id).map(str::to_owned))
        .collect()
}

fn serve_token(token: Option<&String>) -> String {
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        return t.clone();
    }
    if let Some(s) = tokens::resolve(TokenKind::Remote, None) {
        eprintln!("jeton: {}", s.describe());
        return s.expose().to_owned();
    }
    let t = rd::generate_token();
    eprintln!("token (à transmettre hors bande): {t}");
    t
}

fn kind_of_service(id: &str) -> Option<TargetKind> {
    let is = |p: &str| id == p || id.starts_with(&format!("{p}-"));
    if is("mcp-http") {
        Some(TargetKind::McpHttp)
    } else if is("vnc") {
        Some(TargetKind::Vnc)
    } else if is("remote-desktop") {
        Some(TargetKind::Ws)
    } else if is("shell") {
        Some(TargetKind::Shell)
    } else {
        None
    }
}

/// Every remote-control service declared in the inventory, as targets.
fn declared_targets(inventory: &Inventory) -> Vec<RemoteTarget> {
    inventory
        .services
        .iter()
        .filter_map(|s| {
            let kind = kind_of_service(&s.id)?;
            let spec = format!("{}:{}", s.address, s.port.unwrap_or_else(|| kind.default_port()));
            RemoteTarget::resolve(&spec, kind, inventory).ok()
        })
        .collect()
}

async fn probe(target: &RemoteTarget, timeout: Duration) -> Value {
    let started = std::time::Instant::now();
    let addr = target.addr();
    let result: Result<String> = match target.kind {
        TargetKind::Vnc => rd::vnc::probe(&addr, timeout).await,
        TargetKind::Ws | TargetKind::McpHttp => {
            async {
                crate::probe::ensure_crypto_provider();
                let scheme = if target.secure { "https" } else { "http" };
                let resp = reqwest::Client::builder()
                    .timeout(timeout)
                    .build()?
                    .get(format!("{scheme}://{addr}/healthz"))
                    .send()
                    .await?;
                let status = resp.status();
                if !status.is_success() {
                    bail!("/healthz answered {status}");
                }
                Ok(format!("/healthz {status}"))
            }
            .await
        },
        TargetKind::Shell | TargetKind::Local => {
            tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr))
                .await
                .context("timeout")
                .and_then(|r| r.map(|_| "tcp open".to_owned()).map_err(Into::into))
        },
    };
    let credential = target.credential().map(|s| s.describe());
    let mut v = json!({
        "target": target.url(),
        "kind": target.kind.as_str(),
        "member": target.id,
        "credential": credential,
        "ms": started.elapsed().as_millis() as u64,
    });
    match result {
        Ok(detail) => {
            v["reachable"] = json!(true);
            v["detail"] = json!(detail);
        },
        Err(e) => {
            v["reachable"] = json!(false);
            v["error"] = json!(format!("{e:#}"));
        },
    }
    v
}

fn tunnel_status(root: &Path, inventory: &Inventory) -> Value {
    let name = crate::tunnel::default_name(root);
    let status = match Tunnel::open(&name, Backend::native()).and_then(|t| t.status()) {
        Ok(s) => s,
        Err(e) => return json!({ "name": name, "up": false, "error": e.to_string() }),
    };
    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let member_of = |key: &str| {
        if inventory.hub.public_key == key {
            return Some(inventory.hub.peer.clone());
        }
        inventory.peers.iter().find(|p| p.public_key == key).map(|p| p.id.clone())
    };
    let peers: Vec<Value> = status
        .peers
        .iter()
        .map(|p| {
            let key = p.public_key.to_base64();
            let age = p.latest_handshake.map(|t| now.saturating_sub(t));
            json!({
                "member": member_of(&key),
                "endpoint": p.endpoint.map(|e| e.to_string()),
                "handshakeAgeSecs": age,
                // WireGuard rekeys every 2 minutes; 3 minutes without a handshake means no session.
                "alive": age.is_some_and(|a| a < 180),
                "rxBytes": p.rx_bytes,
                "txBytes": p.tx_bytes,
            })
        })
        .collect();
    json!({ "name": name, "up": true, "backend": status.backend, "peers": peers })
}

fn parse_point(s: &str) -> Result<(i32, i32)> {
    let (x, y) = s.split_once(',').context("expected x,y")?;
    Ok((x.trim().parse()?, y.trim().parse()?))
}

pub async fn execute_remote(root: &Path, cmd: &RemoteCommand) -> Result<Value> {
    let out = match cmd {
        RemoteCommand::Serve { bind, token, vnc, no_vnc, vnc_allow, fps, quality, scale } => {
            let token = serve_token(token.as_ref());
            let ws = rd::serve(rd::ServeOptions {
                bind: *bind,
                token: token.clone(),
                fps: *fps,
                quality: *quality,
                scale: *scale,
            });
            println!("bureau à distance: http://{bind}/#token=<token>");
            if *no_vnc {
                ws.await?;
                json!({ "served": bind.to_string() })
            } else {
                let vnc_bind = vnc.unwrap_or_else(|| SocketAddr::new(bind.ip(), 5900));
                let inventory = rd::target::inventory(Some(root))?;
                let entries = if vnc_allow.is_empty() {
                    vnc_grantees(&inventory, &vnc_bind.ip().to_string())
                } else {
                    vnc_allow.clone()
                };
                let mut allow = Vec::new();
                for e in &entries {
                    allow.extend(rd::vnc::server::parse_allow(e)?);
                }
                let password = match tokens::lookup(TokenKind::Vnc, None) {
                    Some(s) => {
                        eprintln!("mot de passe VNC: {}", s.describe());
                        s.expose().to_owned()
                    },
                    None => {
                        eprintln!("mot de passe VNC: dérivé du jeton du bureau à distance");
                        tokens::derive_vnc_password(&token)
                    },
                };
                let mut opts = rd::vnc::server::VncServeOptions::new(vnc_bind, password);
                opts.allow = allow;
                opts.fps = (*fps).min(30);
                println!("VNC: vnc://{vnc_bind} (pairs admis: loopback, {})", entries.join(", "));
                tokio::try_join!(ws, rd::vnc::server::serve(opts))?;
                json!({ "served": bind.to_string(), "vnc": vnc_bind.to_string(), "vncAllow": entries })
            }
        },
        RemoteCommand::Status { targets, timeout_ms } => {
            let inventory = rd::target::inventory(Some(root))?;
            let timeout = Duration::from_millis(*timeout_ms);
            let resolved = if targets.is_empty() {
                declared_targets(&inventory)
            } else {
                targets
                    .iter()
                    .map(|t| RemoteTarget::resolve(t, TargetKind::Vnc, &inventory))
                    .collect::<Result<Vec<_>>>()?
            };
            let probes = futures_probe(&resolved, timeout).await;
            let local = tokio::task::spawn_blocking(rd::backend_status).await?;
            json!({
                "local": local,
                "tunnel": tunnel_status(root, &inventory),
                "services": probes,
            })
        },
        RemoteCommand::Snapshot { out, quality, scale } => {
            let (q, s) = (*quality, *scale);
            let jpeg = tokio::task::spawn_blocking(move || rd::snapshot_jpeg(q, s)).await??;
            std::fs::write(out, &jpeg)?;
            json!({ "written": out, "bytes": jpeg.len() })
        },
        RemoteCommand::Open { target, token } => {
            let t = rd::target::resolve(target, TargetKind::Ws, Some(root))?;
            if t.kind != TargetKind::Ws {
                bail!("{target}: not a remote-desktop (ws) target");
            }
            let token = match token.clone().filter(|t| !t.is_empty()) {
                Some(t) => t,
                None => t.require_credential()?.expose().to_owned(),
            };
            let scheme = if t.secure { "https" } else { "http" };
            let base = format!("{scheme}://{}/", t.addr());
            std::process::Command::new(if cfg!(windows) { "explorer" } else { "xdg-open" })
                .no_window()
                .arg(format!("{base}#token={token}"))
                .spawn()?;
            json!({ "opened": base })
        },
        RemoteCommand::Connect { target, password, screenshot, click, text, key } => {
            let t = rd::target::resolve(target, TargetKind::Vnc, Some(root))?;
            if t.kind != TargetKind::Vnc {
                bail!("{target}: not a VNC target (use vnc://host:port)");
            }
            let password = password
                .clone()
                .filter(|p| !p.is_empty())
                .or_else(|| t.credential().map(|s| s.expose().to_owned()));
            let session = rd::vnc::client::VncSession::connect(&t.addr(), password).await?;
            let (width, height) = session.size().await;
            let mut done = Vec::new();
            if let Some(p) = click {
                let (x, y) = parse_point(p)?;
                session.click(x, y, rd::backend::MouseButton::Left, 1).await?;
                done.push(json!({ "click": [x, y] }));
            }
            if let Some(s) = text {
                session.type_text(s).await?;
                done.push(json!({ "type": s.chars().count() }));
            }
            if let Some(k) = key {
                session.keypress(k).await?;
                done.push(json!({ "key": k }));
            }
            if let Some(path) = screenshot {
                let shot = session.screenshot(80, 1).await?;
                std::fs::write(path, &shot.jpeg)?;
                done.push(json!({ "screenshot": path, "bytes": shot.jpeg.len() }));
            }
            session.close().await;
            json!({ "target": t.url(), "member": t.id, "width": width, "height": height, "actions": done })
        },
        RemoteCommand::Token { action } => match action {
            TokenAction::Status { target } => {
                let rows: Vec<Value> = TokenKind::ALL
                    .into_iter()
                    .map(|k| {
                        json!({
                            "kind": k.as_str(),
                            "env": k.env(),
                            "source": tokens::resolve(k, target.as_deref()).map(|s| s.describe()),
                        })
                    })
                    .collect();
                json!({ "dir": tokens::private_dir(), "target": target, "credentials": rows })
            },
            TokenAction::Set { kind, target, generate } => {
                let kind = TokenKind::parse(kind)?;
                let value = if *generate {
                    let v = rd::generate_token();
                    eprintln!("{} (à transmettre hors bande): {v}", kind.as_str());
                    v
                } else {
                    let mut s = String::new();
                    std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
                    s
                };
                let path = tokens::store(kind, target.as_deref(), &value)?;
                json!({ "kind": kind.as_str(), "stored": path })
            },
        },
        RemoteCommand::AlwaysOnline {
            member,
            hub_user,
            distro,
            identity_file,
            aphrody,
            no_wsl,
            no_reverse,
            dry_run,
        } => {
            let options = crate::always_online::Options {
                member: member.clone(),
                hub_user: hub_user.clone(),
                distro: distro.clone(),
                no_wsl: *no_wsl,
                no_reverse: *no_reverse,
            };
            let paths = crate::always_online::Paths::detect(aphrody.clone(), identity_file.clone());
            crate::always_online::execute(root, &options, &paths, *dry_run)?
        },
    };
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(out)
}

async fn futures_probe(targets: &[RemoteTarget], timeout: Duration) -> Vec<Value> {
    let handles: Vec<_> = targets
        .iter()
        .cloned()
        .map(|t| tokio::spawn(async move { probe(&t, timeout).await }))
        .collect();
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.unwrap_or_else(|e| json!({ "error": e.to_string() })));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_drives_vnc_allowlist_and_declared_targets() {
        let inv = Inventory::embedded().unwrap();
        assert_eq!(vnc_grantees(&inv, "10.200.77.10"), vec!["10.200.77.4".to_owned()]);
        assert_eq!(vnc_grantees(&inv, "10.200.77.4"), vec!["10.200.77.10".to_owned()]);
        let urls: Vec<String> = declared_targets(&inv).iter().map(RemoteTarget::url).collect();
        assert!(urls.contains(&"vnc://10.200.77.10:5900".to_owned()), "{urls:?}");
        assert!(urls.contains(&"ws://10.200.77.10:8795".to_owned()), "{urls:?}");
        assert!(urls.contains(&"http://10.200.77.1:8793/mcp".to_owned()), "{urls:?}");
        assert_eq!(parse_point("3, 4").unwrap(), (3, 4));
        assert!(parse_point("3").is_err());
    }

    #[tokio::test]
    async fn status_probe_reports_unreachable_without_secrets() {
        let inv = Inventory::embedded().unwrap();
        let t = RemoteTarget::resolve("vnc://127.0.0.1:9", TargetKind::Vnc, &inv).unwrap();
        let v = probe(&t, Duration::from_millis(300)).await;
        assert_eq!(v["reachable"], json!(false));
        assert_eq!(v["kind"], json!("vnc"));
    }
}
