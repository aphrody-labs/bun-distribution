//! procps: `ps`, `free`, `pidof`, `pgrep`, `pkill`, on `sysinfo` (cross-platform).

use std::ffi::OsString;
use sysinfo::{ProcessesToUpdate, System};

crate::applets! {
    "ps" => ps,
    "free" => free,
    "pidof" => pidof,
    "pgrep" => pgrep,
    "pkill" => pkill,
}

fn processes() -> System {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys
}

fn ps(_args: Vec<OsString>) -> i32 {
    let sys = processes();
    let mut rows: Vec<_> = sys.processes().values().collect();
    rows.sort_by_key(|p| p.pid());
    println!("{:>8} {:>8} {:>10} CMD", "PID", "PPID", "RSS(KiB)");
    for p in rows {
        let ppid = p
            .parent()
            .map(|pid| pid.to_string())
            .unwrap_or_else(|| "-".into());
        println!(
            "{:>8} {:>8} {:>10} {}",
            p.pid(),
            ppid,
            p.memory() / 1024,
            p.name().to_string_lossy()
        );
    }
    0
}

fn free(args: Vec<OsString>) -> i32 {
    let unit: u64 = match args.get(1).and_then(|a| a.to_str()) {
        Some("-m") => 1 << 20,
        Some("-g") => 1 << 30,
        Some("-b") => 1,
        _ => 1 << 10,
    };
    let mut sys = System::new();
    sys.refresh_memory();
    println!(
        "{:>7} {:>12} {:>12} {:>12} {:>12}",
        "", "total", "used", "free", "available"
    );
    println!(
        "{:>7} {:>12} {:>12} {:>12} {:>12}",
        "Mem:",
        sys.total_memory() / unit,
        sys.used_memory() / unit,
        sys.free_memory() / unit,
        sys.available_memory() / unit
    );
    println!(
        "{:>7} {:>12} {:>12} {:>12}",
        "Swap:",
        sys.total_swap() / unit,
        sys.used_swap() / unit,
        sys.free_swap() / unit
    );
    0
}

fn matching(pattern: &str, exact: bool) -> Vec<(sysinfo::Pid, String)> {
    let sys = processes();
    let mut found: Vec<_> = sys
        .processes()
        .values()
        .filter_map(|p| {
            let name = p.name().to_string_lossy().into_owned();
            let hit = if exact {
                name == pattern
            } else {
                name.contains(pattern)
            };
            hit.then(|| (p.pid(), name))
        })
        .collect();
    found.sort();
    found
}

fn pidof(args: Vec<OsString>) -> i32 {
    let mut pids = Vec::new();
    for name in args.iter().skip(1) {
        pids.extend(
            matching(&name.to_string_lossy(), true)
                .into_iter()
                .map(|(pid, _)| pid.to_string()),
        );
    }
    if pids.is_empty() {
        return 1;
    }
    println!("{}", pids.join(" "));
    0
}

fn pgrep(args: Vec<OsString>) -> i32 {
    let Some(pattern) = args
        .iter()
        .skip(1)
        .find(|a| !a.to_string_lossy().starts_with('-'))
    else {
        eprintln!("pgrep: no matching criteria specified");
        return 2;
    };
    let list = args.iter().any(|a| a == "-l");
    let found = matching(&pattern.to_string_lossy(), false);
    for (pid, name) in &found {
        if list {
            println!("{pid} {name}")
        } else {
            println!("{pid}")
        }
    }
    i32::from(found.is_empty())
}

fn pkill(args: Vec<OsString>) -> i32 {
    let Some(pattern) = args
        .iter()
        .skip(1)
        .find(|a| !a.to_string_lossy().starts_with('-'))
    else {
        eprintln!("pkill: no matching criteria specified");
        return 2;
    };
    let sys = processes();
    let mut killed = false;
    for (pid, _) in matching(&pattern.to_string_lossy(), false) {
        if let Some(process) = sys.process(pid) {
            killed |= process.kill();
        }
    }
    i32::from(!killed)
}
