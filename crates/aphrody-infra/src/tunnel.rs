//! `aphrody infra wg`: native WireGuard (wg + wg-quick + WireGuardNT) for the private tunnel.

use aphrody_proc::NoWindow as _;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use aphrody_wireguard::{Backend, Config, Inventory, Key, PeerPatch, Tunnel, driver, state};
use clap::{Subcommand, ValueEnum};
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum DriverAction {
    /// Show the WireGuardNT library lookup (Windows).
    Status,
    /// Download the pinned WireGuardNT release, verify its SHA-256 and install the DLL.
    Install,
}

#[derive(Debug, Subcommand)]
pub enum WgCommand {
    /// Generate a private key (`wg genkey`).
    Genkey,
    /// Derive the public key of a private key read from the argument or stdin (`wg pubkey`).
    Pubkey { key: Option<String> },
    /// Generate a preshared key (`wg genpsk`).
    Genpsk,
    /// Create this host's tunnel key in its protected store and print the public half.
    Keygen {
        /// Interface name (default: the inventory name for this OS).
        #[arg(long)]
        name: Option<String>,
        /// Replace an existing key.
        #[arg(long)]
        force: bool,
    },
    /// Declared tunnel summary: hub, members, granted services.
    Plan,
    /// Render the wg-quick configuration of an inventory member (hub or peer).
    Render {
        member: String,
        /// Private key file to embed (omitted: template without PrivateKey).
        #[arg(long)]
        private_key_file: Option<PathBuf>,
        /// Write to this file instead of stdout.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Bring a tunnel up (`wg-quick up`): a .conf path or an inventory member id.
    Up {
        target: String,
        /// Interface name (default: the inventory name for this OS).
        #[arg(long)]
        name: Option<String>,
        /// Private key file when `target` is an inventory member.
        #[arg(long)]
        private_key_file: Option<PathBuf>,
        /// Force the boringtun userspace device (Linux, BSD, macOS).
        #[arg(long)]
        userspace: bool,
        /// Keep running in the background (WireGuardNT and userspace tunnels live with their process).
        #[arg(long)]
        detach: bool,
    },
    /// Bring a tunnel down (`wg-quick down`).
    Down { name: Option<String> },
    /// Interface state, peers, handshakes and transfer (`wg show`).
    Show { name: Option<String> },
    /// Add or update one peer (`wg set <iface> peer ...`).
    SetPeer {
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        public_key: String,
        #[arg(long)]
        endpoint: Option<String>,
        /// Replace comma separated CIDRs; omission preserves routes, an empty flag clears them.
        #[arg(long, value_delimiter = ',', num_args = 0..)]
        allowed_ips: Option<Vec<String>>,
        #[arg(long)]
        keepalive: Option<u16>,
        #[arg(long)]
        preshared_key_file: Option<PathBuf>,
    },
    /// Remove one peer (`wg set <iface> peer <key> remove`).
    RemovePeer {
        #[arg(long)]
        name: Option<String>,
        public_key: String,
    },
    /// Converge the peers of a live interface on a configuration (`wg syncconf`).
    Syncconf { name: Option<String>, config: String },
    /// Print the `wg setconf` subset of a configuration (`wg-quick strip`).
    Strip { config: PathBuf },
    /// WireGuardNT driver library (Windows).
    Driver {
        #[arg(value_enum, default_value_t = DriverAction::Status)]
        action: DriverAction,
    },
}

fn inventory(root: &Path) -> Result<Inventory> {
    Inventory::discover(Some(root)).map_err(|e| anyhow!("{e}"))
}

/// Interface name of this OS: `windowsTunnelName` on Windows, `interface` elsewhere.
pub(crate) fn default_name(root: &Path) -> String {
    inventory(root)
        .map(|i| if cfg!(windows) { i.windows_tunnel_name } else { i.interface })
        .unwrap_or_else(|_| if cfg!(windows) { "aphrody".into() } else { "wg1".into() })
}

/// Protected key store of this host.
fn key_path(name: &str) -> PathBuf {
    if cfg!(target_os = "linux") && Path::new("/etc/wireguard").is_dir() {
        PathBuf::from(format!("/etc/wireguard/{name}.key"))
    } else {
        driver::state_dir().join(format!("{name}.key"))
    }
}

fn read_key(path: &Path) -> Result<Key> {
    fs_read(path)?.trim().parse().map_err(|e| anyhow!("{}: {e}", path.display()))
}

fn fs_read(path: &Path) -> Result<String> {
    std::fs::read_to_string(path).with_context(|| path.display().to_string())
}

fn write_secret(path: &Path, body: &str) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, body).with_context(|| path.display().to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn wg_err(e: aphrody_wireguard::Error) -> anyhow::Error {
    anyhow!("{e}")
}

/// A configuration from a file path or an inventory member id.
fn load_config(root: &Path, target: &str, name: &str, key_file: Option<&Path>) -> Result<Config> {
    let path = Path::new(target);
    if path.is_file() {
        return Config::parse(&fs_read(path)?).map_err(wg_err);
    }
    let inv = inventory(root)?;
    let key_file = key_file.map_or_else(|| key_path(name), Path::to_path_buf);
    let key = read_key(&key_file).with_context(|| {
        format!(
            "clé privée absente: `aphrody infra wg keygen --name {name}` crée {}",
            key_file.display()
        )
    })?;
    inv.render(target, Some(key)).map_err(wg_err)
}

fn backend(userspace: bool) -> Backend {
    if userspace { Backend::Userspace } else { Backend::native() }
}

fn status_json(t: &Tunnel) -> Result<Value> {
    Ok(serde_json::to_value(t.status().map_err(wg_err)?)?)
}

/// Run a `wg` subcommand; returns the JSON evidence recorded in the run manifest.
pub async fn execute(root: &Path, cmd: &WgCommand, as_json: bool) -> Result<Value> {
    let out = match cmd {
        WgCommand::Genkey => {
            let k = Key::generate_private().map_err(wg_err)?;
            println!("{k}");
            return Ok(json!({ "generated": "private" }));
        },
        WgCommand::Pubkey { key } => {
            let raw = match key {
                Some(k) => k.clone(),
                None => {
                    let mut s = String::new();
                    std::io::stdin().read_to_string(&mut s)?;
                    s
                },
            };
            let k: Key = raw.trim().parse().map_err(wg_err)?;
            println!("{}", k.public());
            return Ok(json!({ "public": k.public().to_base64() }));
        },
        WgCommand::Genpsk => {
            println!("{}", Key::generate_preshared().map_err(wg_err)?);
            return Ok(json!({ "generated": "preshared" }));
        },
        WgCommand::Keygen { name, force } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let path = key_path(&name);
            if path.exists() && !force {
                let k = read_key(&path)?;
                json!({ "name": name, "keyFile": path, "publicKey": k.public().to_base64(), "created": false })
            } else {
                let k = Key::generate_private().map_err(wg_err)?;
                write_secret(&path, &format!("{k}\n"))?;
                json!({ "name": name, "keyFile": path, "publicKey": k.public().to_base64(), "created": true })
            }
        },
        WgCommand::Plan => inventory(root)?.plan(),
        WgCommand::Render { member, private_key_file, out } => {
            let key = private_key_file.as_deref().map(read_key).transpose()?;
            let cfg = inventory(root)?.render(member, key).map_err(wg_err)?;
            match out {
                Some(p) => {
                    write_secret(p, &cfg.render())?;
                    json!({ "member": member, "written": p })
                },
                None => {
                    print!("{}", cfg.render());
                    return Ok(json!({ "member": member }));
                },
            }
        },
        WgCommand::Strip { config } => {
            print!("{}", Config::parse(&fs_read(config)?).map_err(wg_err)?.strip());
            return Ok(json!({ "stripped": config }));
        },
        WgCommand::Up { target, name, private_key_file, userspace, detach } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let backend = backend(*userspace);
            if *detach && !backend.persistent() {
                return detach_up(root, target, &name, private_key_file.as_deref(), *userspace);
            }
            let cfg = load_config(root, target, &name, private_key_file.as_deref())?;
            let tunnel = Tunnel::up(&name, &cfg, backend).map_err(wg_err)?;
            let st = status_json(&tunnel)?;
            if backend.persistent() {
                println!("tunnel {name} actif ({backend:?})");
                json!({ "name": name, "up": true, "status": st })
            } else {
                state::record(&name, &cfg).map_err(wg_err)?;
                println!(
                    "tunnel {name} actif ({backend:?}, pid {}), Ctrl-C pour l'arrêter",
                    std::process::id()
                );
                tokio::signal::ctrl_c().await?;
                tunnel.down(Some(&cfg)).map_err(wg_err)?;
                state::clear(&name);
                println!("tunnel {name} arrêté");
                json!({ "name": name, "up": false, "status": st })
            }
        },
        WgCommand::Down { name } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let recorded = state::recorded(&name);
            if let Some(pid) = state::stop_owner(&name).map_err(wg_err)? {
                json!({ "name": name, "stoppedOwner": pid })
            } else {
                Tunnel::open(&name, Backend::native())
                    .and_then(|t| t.down(recorded.as_ref()))
                    .map_err(wg_err)?;
                json!({ "name": name, "down": true })
            }
        },
        WgCommand::Show { name } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let st = status_json(&Tunnel::open(&name, Backend::native()).map_err(wg_err)?)?;
            if !as_json {
                print_status(&st);
                return Ok(st);
            }
            st
        },
        WgCommand::SetPeer {
            name,
            public_key,
            endpoint,
            allowed_ips,
            keepalive,
            preshared_key_file,
        } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let patch = PeerPatch {
                public_key: public_key.parse().map_err(wg_err)?,
                endpoint: endpoint.clone(),
                persistent_keepalive: *keepalive,
                preshared_key: preshared_key_file.as_deref().map(read_key).transpose()?,
                allowed_ips: allowed_ips
                    .as_ref()
                    .map(|ips| {
                        ips.iter()
                            .map(|a| a.parse().with_context(|| format!("AllowedIPs {a}")))
                            .collect::<Result<Vec<_>>>()
                    })
                    .transpose()?,
            };
            Tunnel::open(&name, Backend::native())
                .and_then(|t| t.patch_peer(&patch))
                .map_err(wg_err)?;
            json!({ "name": name, "peer": public_key, "configured": true })
        },
        WgCommand::RemovePeer { name, public_key } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let k: Key = public_key.parse().map_err(wg_err)?;
            Tunnel::open(&name, Backend::native())
                .and_then(|t| t.remove_peer(&k))
                .map_err(wg_err)?;
            json!({ "name": name, "peer": public_key, "removed": true })
        },
        WgCommand::Syncconf { name, config } => {
            let name = name.clone().unwrap_or_else(|| default_name(root));
            let cfg = load_config(root, config, &name, None)?;
            let report = Tunnel::open(&name, Backend::native())
                .and_then(|t| t.sync(&cfg))
                .map_err(wg_err)?;
            json!({ "name": name, "sync": report })
        },
        WgCommand::Driver { action } => match action {
            DriverAction::Status => serde_json::to_value(driver::status())?,
            DriverAction::Install => {
                if !cfg!(windows) {
                    bail!(
                        "WireGuardNT est propre à Windows (Linux: module noyau, macOS/BSD: --userspace)"
                    );
                }
                let path = tokio::task::spawn_blocking(driver::install).await?.map_err(wg_err)?;
                json!({ "installed": path, "version": driver::NT_VERSION, "sha256": driver::NT_SHA256 })
            },
        },
    };
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(out)
}

/// Relaunch `aphrody infra wg up` without `--detach` as a background process.
fn detach_up(
    root: &Path,
    target: &str,
    name: &str,
    key: Option<&Path>,
    userspace: bool,
) -> Result<Value> {
    let exe = std::env::current_exe()?;
    let mut args: Vec<String> = Vec::new();
    // The multi-call `aphrody` binary dispatches `infra`; `aphrody-infra` takes the subcommand.
    if exe.file_stem().is_some_and(|s| s.eq_ignore_ascii_case("aphrody")) {
        args.push("infra".into());
    }
    args.extend([
        "--root".into(),
        root.display().to_string(),
        "wg".into(),
        "up".into(),
        target.into(),
    ]);
    args.extend(["--name".into(), name.into()]);
    if let Some(k) = key {
        args.extend(["--private-key-file".into(), k.display().to_string()]);
    }
    if userspace {
        args.push("--userspace".into());
    }
    let log = driver::state_dir().join(format!("{name}.log"));
    std::fs::create_dir_all(driver::state_dir())?;
    let file = std::fs::File::create(&log)?;
    let mut cmd = std::process::Command::new(exe).detached();
    cmd.args(&args).stdin(std::process::Stdio::null()).stdout(file.try_clone()?).stderr(file);
    #[cfg(windows)]
    disinherit_std_handles();
    let child = cmd.spawn()?;
    let out = json!({ "name": name, "detached": child.id(), "log": log });
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(out)
}

/// `CreateProcess` inherits every inheritable handle, including the caller's stdout pipe: the
/// detached owner would then hold the pipe of a capturing shell open for the tunnel's lifetime.
#[cfg(windows)]
fn disinherit_std_handles() {
    use windows_sys::Win32::Foundation::{
        HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation,
    };
    use windows_sys::Win32::System::Console::{
        GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };
    for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        // SAFETY: GetStdHandle has no preconditions; SetHandleInformation only clears the
        // inherit flag of a handle owned by this process and is skipped for null/invalid ones.
        unsafe {
            let h = GetStdHandle(which);
            if !h.is_null() && h != INVALID_HANDLE_VALUE {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

fn print_status(st: &Value) {
    println!("interface: {}", st["name"].as_str().unwrap_or("?"));
    println!("  backend: {}", st["backend"].as_str().unwrap_or("?"));
    if let Some(k) = st["public_key"].as_str() {
        println!("  public key: {k}");
    }
    println!("  listening port: {}", st["listen_port"]);
    for p in st["peers"].as_array().into_iter().flatten() {
        println!("\npeer: {}", p["public_key"].as_str().unwrap_or("?"));
        if let Some(e) = p["endpoint"].as_str() {
            println!("  endpoint: {e}");
        }
        let ips: Vec<&str> =
            p["allowed_ips"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        println!("  allowed ips: {}", ips.join(", "));
        if let Some(h) = p["latest_handshake"].as_u64() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            println!("  latest handshake: {}s ago", now.saturating_sub(h));
        }
        println!("  transfer: {} B received, {} B sent", p["rx_bytes"], p["tx_bytes"]);
        if let Some(k) = p["persistent_keepalive"].as_u64() {
            println!("  persistent keepalive: every {k}s");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_default_name_and_render() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/aphrody/crates");
        let name = default_name(&root);
        assert_eq!(name, if cfg!(windows) { "aphrody" } else { "wg1" });
        let inv = inventory(&root).unwrap();
        assert!(inv.render("aphro-pc", None).is_ok());
    }

    #[derive(clap::Parser)]
    struct WgArgs {
        #[command(subcommand)]
        command: WgCommand,
    }

    #[test]
    fn set_peer_cli_distinguishes_omitted_routes_from_explicit_replacement_and_clear() {
        use clap::Parser as _;
        let key = Key([1; 32]).to_base64();
        let parse = |extra: &[&str]| {
            let mut args = vec!["wg", "set-peer", "--public-key", key.as_str()];
            args.extend_from_slice(extra);
            WgArgs::try_parse_from(args).unwrap().command
        };
        let WgCommand::SetPeer { allowed_ips, endpoint, keepalive, preshared_key_file, .. } =
            parse(&["--keepalive", "25"])
        else {
            panic!("set-peer expected");
        };
        assert_eq!(allowed_ips, None);
        assert_eq!(endpoint, None);
        assert_eq!(keepalive, Some(25));
        assert_eq!(preshared_key_file, None);
        let WgCommand::SetPeer { allowed_ips, .. } =
            parse(&["--allowed-ips", "10.200.77.10/32,2001:db8::10/128"])
        else {
            panic!("set-peer expected");
        };
        assert_eq!(allowed_ips.unwrap(), ["10.200.77.10/32", "2001:db8::10/128"]);
        let WgCommand::SetPeer { allowed_ips, keepalive, .. } =
            parse(&["--allowed-ips", "--keepalive", "0"])
        else {
            panic!("set-peer expected");
        };
        assert_eq!(allowed_ips, Some(Vec::new()));
        assert_eq!(keepalive, Some(0));
    }
}
