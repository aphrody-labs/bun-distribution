// SPDX-License-Identifier: Apache-2.0
//! `aphrody infra remote always-online`: keeps a Windows tunnel member (Omar's PC by default)
//! reachable with nobody at the keyboard. Runbook: docs/operations/infra/OMAR-REMOTE-CONTROL.md
//! (section 2.10).
//!
//! Hidden self-healing tasks under `\Aphrody\` ([`crate::wintask`] window policy): the wg1 tunnel
//! at boot as SYSTEM, the remote desktop + VNC on the interactive desktop (`conhost --headless`),
//! the MCP HTTP server and the reverse SSH tunnel to the hub (S4U, no window station) and the WSL
//! sshd. Each one also repeats every 5 minutes with `IgnoreNew` and restarts on failure, so a
//! crashed or disconnected process comes back on its own. Plus the MCP portproxy on the tunnel
//! address, no sleep on mains power and WSL mirrored networking. Idempotent. Secrets are never
//! read or printed: tokens and keys stay in `<aphrody home>/private` and `~/.ssh`.

use crate::wintask::{self, Action, Principal, Scheduler, Settings, TaskSpec, Trigger};
use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use aphrody_wireguard::Inventory;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const FOLDER: &str = "\\Aphrody\\";
const DESCRIPTION: &str = "Aphrody always-online (aphrody infra remote always-online)";
/// Reverse forwards opened on the hub loopback: `hub port -> target on this PC`.
const REVERSE: [(u16, &str, u16); 6] = [
    (22010, "127.0.0.1", 22),
    (28795, "{address}", 8795),
    (28793, "127.0.0.1", 8793),
    (22011, "127.0.0.1", 2222),
    (25900, "{address}", 5900),
    (25080, "127.0.0.1", 50080),
];

/// Choices of the operator.
#[derive(Debug, Clone)]
pub struct Options {
    /// Inventory member configured on this PC.
    pub member: String,
    /// SSH user on the hub for the reverse tunnel (default: the member id).
    pub hub_user: Option<String>,
    /// WSL distribution running sshd on port 2222.
    pub distro: String,
    pub no_wsl: bool,
    pub no_reverse: bool,
}

/// Host paths the tasks run (resolved by [`Paths::detect`], injected by tests).
#[derive(Debug, Clone)]
pub struct Paths {
    pub aphrody: PathBuf,
    pub mcp: PathBuf,
    pub home: PathBuf,
    /// `<home>/private/mcp-http.env` when it exists (passed by path, never read).
    pub mcp_env: Option<PathBuf>,
    pub ssh: PathBuf,
    pub identity: PathBuf,
    pub system_root: String,
    pub wsl: bool,
}

impl Paths {
    /// Installed binaries (`%LOCALAPPDATA%\Aphrody\bin` unless `aphrody` is given), Aphrody home,
    /// OpenSSH client and WSL of this host.
    #[must_use]
    pub fn detect(aphrody: Option<PathBuf>, identity: Option<PathBuf>) -> Self {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from).unwrap_or_default();
        let aphrody = aphrody
            .unwrap_or_else(|| env("LOCALAPPDATA").join("Aphrody").join("bin").join("aphrody.exe"));
        let mcp = aphrody.with_file_name("aphrody-mcp.exe");
        // Task Scheduler and cmd.exe want native separators (APHRODY_HOME may use `/`).
        let home = PathBuf::from(
            aphrody_wireguard::driver::aphrody_home().to_string_lossy().replace('/', "\\"),
        );
        let mcp_env = Some(home.join("private").join("mcp-http.env")).filter(|p| p.is_file());
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
        let system32 = Path::new(&system_root).join("System32");
        // Windows OpenSSH client: inbox, then the MSI install, then the first one on PATH.
        let ssh = [
            system32.join("OpenSSH").join("ssh.exe"),
            env("ProgramFiles").join("OpenSSH").join("ssh.exe"),
        ]
        .into_iter()
        .chain(
            std::env::var_os("PATH")
                .iter()
                .flat_map(std::env::split_paths)
                .map(|d| d.join("ssh.exe")),
        )
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from("ssh.exe"));
        Self {
            aphrody,
            mcp,
            mcp_env,
            ssh,
            identity: identity
                .unwrap_or_else(|| env("USERPROFILE").join(".ssh").join("id_ed25519")),
            wsl: system32.join("wsl.exe").is_file(),
            home,
            system_root,
        }
    }
}

/// What `apply` registers, computed without side effects.
#[derive(Debug, Clone)]
pub struct Plan {
    pub member: String,
    /// Tunnel address of the member (remote desktop, VNC and MCP portproxy listen there).
    pub address: String,
    pub tasks: Vec<TaskSpec>,
    /// Configure `.wslconfig` and the WSL sshd task.
    pub wsl: bool,
}

fn quoted(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

fn task(
    paths: &Paths,
    name: String,
    at: Trigger,
    principal: Principal,
    command: &Path,
    arguments: String,
) -> TaskSpec {
    let action = Action {
        command: command.display().to_string(),
        arguments: Some(arguments),
        working_directory: None,
    };
    TaskSpec {
        path: FOLDER.to_owned(),
        name,
        description: Some(DESCRIPTION.to_owned()),
        action: if principal == Principal::Interactive {
            action.headless(&paths.system_root)
        } else {
            action
        },
        principal,
        highest: true,
        triggers: vec![at, Trigger::Every { minutes: 5 }],
        settings: Settings { restart: true, time_limit_minutes: None },
    }
}

/// The declared tasks of `options.member` from the tunnel inventory.
///
/// # Errors
/// The member is not in the inventory.
pub fn plan(inventory: &Inventory, options: &Options, paths: &Paths) -> Result<Plan> {
    let member = options.member.as_str();
    let address = inventory
        .address_of(member)
        .with_context(|| format!("membre {member} absent de l'inventaire du tunnel"))?
        .to_owned();
    // VNC admits the owners granted it and this PC's own address, source of the reverse tunnel.
    let mut allow = crate::remote::vnc_grantees(inventory, &address);
    if !allow.contains(&address) {
        allow.push(address.clone());
    }
    let system32 = Path::new(&paths.system_root).join("System32");
    let wg_log = paths.home.join("logs").join("wg.log");
    let mut mcp = "http --bind 127.0.0.1:8793".to_owned();
    if let Some(env) = &paths.mcp_env {
        mcp.push_str(&format!(" --env-file {}", quoted(env)));
    }
    let mut tasks = vec![
        // WireGuardNT lives with this process: the task keeps wg1 up from boot, before any logon.
        task(
            paths,
            format!("Aphrody WG {member}"),
            Trigger::Boot,
            Principal::System,
            &system32.join("cmd.exe"),
            format!(
                "/d /c \"set APHRODY_HOME={}&& {} infra wg up {member} --name aphrody >> {} 2>&1\"",
                paths.home.display(),
                quoted(&paths.aphrody),
                quoted(&wg_log),
            ),
        ),
        // Screen capture needs the interactive desktop.
        task(
            paths,
            "Aphrody Remote Desktop".to_owned(),
            Trigger::Logon,
            Principal::Interactive,
            &paths.aphrody,
            format!("infra remote serve --bind {address}:8795 --vnc-allow {}", allow.join(",")),
        ),
        task(paths, "Aphrody MCP HTTP".to_owned(), Trigger::Logon, Principal::S4U, &paths.mcp, mcp),
    ];
    if !options.no_reverse {
        let hub = inventory
            .hub
            .endpoint
            .rsplit_once(':')
            .map_or(inventory.hub.endpoint.as_str(), |(h, _)| h);
        let forwards: Vec<String> = REVERSE
            .iter()
            .map(|(port, target, to)| {
                format!("-R 127.0.0.1:{port}:{}:{to}", target.replace("{address}", &address))
            })
            .collect();
        // The owner reaches this PC through the hub loopback even without a wg1 handshake.
        tasks.push(task(
            paths,
            format!("Aphrody {member} reverse"),
            Trigger::Logon,
            Principal::S4U,
            &paths.ssh,
            format!(
                "-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -i {} {} {}@{}",
                quoted(&paths.identity),
                forwards.join(" "),
                options.hub_user.as_deref().unwrap_or(member),
                hub.trim_matches(['[', ']']),
            ),
        ));
    }
    let wsl = !options.no_wsl && paths.wsl;
    if wsl {
        tasks.push(task(
            paths,
            "Aphrody WSL sshd".to_owned(),
            Trigger::Logon,
            Principal::Interactive,
            &system32.join("wsl.exe"),
            format!(
                "-d {} -u root -- sh -c \"service ssh status >/dev/null 2>&1 || service ssh start; exec sleep infinity\"",
                options.distro
            ),
        ));
    }
    Ok(Plan { member: member.to_owned(), address, tasks, wsl })
}

/// `.wslconfig` with mirrored networking and the WSL firewall off (reachable on the tunnel
/// address); `None` when both keys are already set, whatever their value.
#[must_use]
pub fn wslconfig_merge(text: &str) -> Option<String> {
    let set =
        |key: &str| text.lines().any(|l| l.split_once('=').is_some_and(|(k, _)| k.trim() == key));
    let missing: Vec<String> = [("networkingMode", "mirrored"), ("firewall", "false")]
        .iter()
        .filter(|(key, _)| !set(key))
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    if missing.is_empty() {
        return None;
    }
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    match lines.iter().position(|l| l.trim() == "[wsl2]") {
        Some(at) => {
            lines.splice(at + 1..at + 1, missing);
        },
        None => {
            while lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.pop();
            }
            lines.push("[wsl2]".to_owned());
            lines.extend(missing);
        },
    }
    Some(lines.join("\n") + "\n")
}

fn describe(spec: &TaskSpec) -> Value {
    json!({
        "task": spec.full_path(),
        "principal": spec.principal.logon_label(),
        "triggers": spec.triggers.iter().map(|t| t.label()).collect::<Vec<_>>(),
        "command": spec.action.command,
        "arguments": spec.action.arguments,
    })
}

/// Report of the plan (no side effect).
#[must_use]
pub fn report(plan: &Plan) -> Value {
    json!({
        "member": plan.member,
        "address": plan.address,
        "tasks": plan.tasks.iter().map(describe).collect::<Vec<_>>(),
        "power": "veille et hibernation sur secteur désactivées, hibernation off",
        "portproxy": format!("{}:8793 -> 127.0.0.1:8793 (iphlpsvc automatique)", plan.address),
        "wslconfig": plan.wsl.then_some("networkingMode=mirrored, firewall=false (puis wsl --shutdown)"),
    })
}

fn run(program: &str, args: &[&str]) -> Result<()> {
    let output = std::process::Command::new(program)
        .no_window()
        .args(args)
        .output()
        .with_context(|| format!("{program} {}", args.join(" ")))?;
    if !output.status.success() {
        bail!("{program} {} : {}", args.join(" "), String::from_utf8_lossy(&output.stdout).trim());
    }
    Ok(())
}

/// Applies the plan (administrator token required): power, WSL networking, tasks registered and
/// started, MCP portproxy. Returns what was done and the state of each task.
///
/// # Errors
/// A system command, the Task Scheduler or the Service Control Manager failed.
pub fn apply(plan: &Plan, paths: &Paths) -> Result<Value> {
    let mut done = Vec::new();
    std::fs::create_dir_all(paths.home.join("logs")).context("journal")?;
    // An asleep PC drops wg1 and every service.
    run("powercfg", &["/change", "standby-timeout-ac", "0"])?;
    run("powercfg", &["/change", "hibernate-timeout-ac", "0"])?;
    run("powercfg", &["/hibernate", "off"])?;
    done.push("veille et hibernation secteur désactivées".to_owned());
    if plan.wsl {
        let path =
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join(".wslconfig");
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        if let Some(merged) = wslconfig_merge(&text) {
            std::fs::write(&path, merged).with_context(|| path.display().to_string())?;
            run("wsl.exe", &["--shutdown"])?;
            done.push(format!(
                "{} : réseau mirrored, pare-feu WSL off, WSL redémarré",
                path.display()
            ));
        }
    }
    let scheduler = Scheduler::connect()?;
    let user = wintask::current_user();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    for spec in &plan.tasks {
        let full = spec.full_path();
        scheduler.register(
            &full,
            &wintask::task_xml(spec, &user, &today),
            spec.principal,
            &user,
        )?;
        if scheduler.get(&full)?.is_some_and(|r| r.state != "Running") {
            scheduler.run(&full)?;
        }
        done.push(format!("tâche {full}"));
    }
    let listen = format!("listenaddress={}", plan.address);
    // Replaced, not duplicated: the delete fails harmlessly when the rule does not exist yet.
    let _absent =
        run("netsh", &["interface", "portproxy", "delete", "v4tov4", &listen, "listenport=8793"]);
    run(
        "netsh",
        &[
            "interface",
            "portproxy",
            "add",
            "v4tov4",
            &listen,
            "listenport=8793",
            "connectaddress=127.0.0.1",
            "connectport=8793",
        ],
    )?;
    let service = crate::winsvc::ensure("iphlpsvc", false)?;
    done.push(format!(
        "portproxy {}:8793 -> 127.0.0.1:8793, iphlpsvc {}",
        plan.address,
        if service.is_empty() { "inchangé".to_owned() } else { service.join(", ") }
    ));
    let states: Vec<Value> = plan
        .tasks
        .iter()
        .map(|spec| {
            let full = spec.full_path();
            let state = scheduler.get(&full).ok().flatten().map(|r| r.state);
            json!({ "task": full, "state": state })
        })
        .collect();
    Ok(json!({ "applied": done, "tasks": states }))
}

/// `aphrody infra remote always-online`: plan, or apply (relaunched elevated when needed).
///
/// # Errors
/// Not Windows, unknown member, missing installed binaries or a failed correction.
pub fn execute(root: &Path, options: &Options, paths: &Paths, dry_run: bool) -> Result<Value> {
    if !cfg!(windows) {
        bail!("always-online configure un membre Windows du tunnel");
    }
    let inventory = aphrody_remote_desktop::target::inventory(Some(root))?;
    let plan = plan(&inventory, options, paths)?;
    let mut out = report(&plan);
    if dry_run {
        return Ok(out);
    }
    for binary in [&paths.aphrody, &paths.mcp] {
        if !binary.is_file() {
            bail!("{} absent (installer Aphrody d'abord)", binary.display());
        }
    }
    if !aphrody_proc::is_elevated() {
        let code = crate::boot::relaunch_elevated("always-online")?;
        if code != 0 {
            bail!("always-online élevé : code de sortie {code}");
        }
        out["elevated"] = json!(true);
        return Ok(out);
    }
    out["result"] = apply(&plan, paths)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(wsl: bool) -> Paths {
        Paths {
            aphrody: PathBuf::from("C:\\Users\\o\\AppData\\Local\\Aphrody\\bin\\aphrody.exe"),
            mcp: PathBuf::from("C:\\Users\\o\\AppData\\Local\\Aphrody\\bin\\aphrody-mcp.exe"),
            home: PathBuf::from("C:\\Users\\o\\.aphrody"),
            mcp_env: Some(PathBuf::from("C:\\Users\\o\\.aphrody\\private\\mcp-http.env")),
            ssh: PathBuf::from("C:\\Windows\\System32\\OpenSSH\\ssh.exe"),
            identity: PathBuf::from("C:\\Users\\o\\.ssh\\id_ed25519"),
            system_root: "C:\\Windows".to_owned(),
            wsl,
        }
    }

    fn options() -> Options {
        Options {
            member: "omar".into(),
            hub_user: None,
            distro: "Ubuntu".into(),
            no_wsl: false,
            no_reverse: false,
        }
    }

    #[test]
    fn omar_plan_matches_the_runbook() {
        let inventory = Inventory::embedded().unwrap();
        let plan = plan(&inventory, &options(), &paths(true)).unwrap();
        assert_eq!(plan.address, "10.200.77.10");
        let names: Vec<String> = plan.tasks.iter().map(TaskSpec::full_path).collect();
        assert_eq!(
            names,
            [
                "\\Aphrody\\Aphrody WG omar",
                "\\Aphrody\\Aphrody Remote Desktop",
                "\\Aphrody\\Aphrody MCP HTTP",
                "\\Aphrody\\Aphrody omar reverse",
                "\\Aphrody\\Aphrody WSL sshd",
            ]
        );
        let [wg, desktop, mcp, reverse, wsl] = plan.tasks.as_slice() else { panic!() };
        assert_eq!(wg.principal, Principal::System);
        assert_eq!(wg.triggers, [Trigger::Boot, Trigger::Every { minutes: 5 }]);
        assert!(wg.action.arguments.as_deref().unwrap().contains(
            "\"C:\\Users\\o\\AppData\\Local\\Aphrody\\bin\\aphrody.exe\" infra wg up omar --name aphrody >> \"C:\\Users\\o\\.aphrody\\logs\\wg.log\" 2>&1"
        ));
        // Desktop tasks run behind a headless console host; the others have no window station.
        assert_eq!(desktop.principal, Principal::Interactive);
        assert!(desktop.action.is_headless());
        assert!(desktop.action.arguments.as_deref().unwrap().ends_with(
            "infra remote serve --bind 10.200.77.10:8795 --vnc-allow 10.200.77.4,10.200.77.3,10.200.77.1,10.200.77.10"
        ));
        assert_eq!(mcp.principal, Principal::S4U);
        assert_eq!(
            mcp.action.arguments.as_deref(),
            Some(
                "http --bind 127.0.0.1:8793 --env-file \"C:\\Users\\o\\.aphrody\\private\\mcp-http.env\""
            )
        );
        let ssh = reverse.action.arguments.as_deref().unwrap();
        assert!(ssh.contains("-R 127.0.0.1:28795:10.200.77.10:8795"), "{ssh}");
        assert!(ssh.contains("-R 127.0.0.1:22011:127.0.0.1:2222"), "{ssh}");
        assert!(ssh.contains("-R 127.0.0.1:25080:127.0.0.1:50080"), "{ssh}");
        assert!(ssh.ends_with(" omar@51.77.147.152"), "{ssh}");
        assert!(wsl.action.is_headless());
        assert!(plan.tasks.iter().all(|t| t.settings.restart && t.highest));
        let xml = wintask::task_xml(desktop, "PC\\omar", "2026-10-09");
        assert!(xml.contains("<Hidden>true</Hidden>") && xml.contains("<Interval>PT5M</Interval>"));
    }

    #[test]
    fn options_drop_reverse_and_wsl() {
        let inventory = Inventory::embedded().unwrap();
        let mut o = options();
        o.no_reverse = true;
        o.hub_user = Some("x".into());
        assert_eq!(plan(&inventory, &o, &paths(false)).unwrap().tasks.len(), 3);
        o.member = "ghost".into();
        assert!(plan(&inventory, &o, &paths(true)).is_err());
    }

    #[test]
    fn wslconfig_adds_only_missing_keys() {
        assert_eq!(
            wslconfig_merge(""),
            Some("[wsl2]\nnetworkingMode=mirrored\nfirewall=false\n".into())
        );
        assert_eq!(
            wslconfig_merge("[wsl2]\nmemory=8GB\nfirewall=true\n\n"),
            Some("[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\nfirewall=true\n\n".into())
        );
        assert_eq!(wslconfig_merge("[wsl2]\nnetworkingMode = nat\nfirewall=false"), None);
        assert_eq!(
            wslconfig_merge("[experimental]\nsparseVhd=true\n"),
            Some(
                "[experimental]\nsparseVhd=true\n[wsl2]\nnetworkingMode=mirrored\nfirewall=false\n"
                    .into()
            )
        );
    }
}
