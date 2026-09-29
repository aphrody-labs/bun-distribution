// SPDX-License-Identifier: Apache-2.0
//! Tests against real child processes, real sockets and real file locks.

use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use pretty_assertions::assert_eq;

use crate::{
    FileLock, GpuLease, LeaseError, LeaseKind, LockKind, SpawnOptions, free_port, process_alive,
    spawn_detached, spawn_group,
};

/// A command that stays alive for about `seconds`, using only what every
/// supported OS ships.
fn sleeper(seconds: u32) -> Command {
    #[cfg(windows)]
    {
        // `ping -n N` waits one second between echoes.
        let mut command = Command::new("ping");
        command.args(["-n", &(seconds + 1).to_string(), "127.0.0.1"]);
        command.stdout(Stdio::null()).stderr(Stdio::null());
        command
    }
    #[cfg(unix)]
    {
        let mut command = Command::new("sleep");
        command.arg(seconds.to_string());
        command.stdout(Stdio::null()).stderr(Stdio::null());
        command
    }
}

/// A command whose leader starts a long-lived grandchild and then keeps running.
fn parent_with_grandchild() -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "start /B ping -n 60 127.0.0.1 >NUL & ping -n 60 127.0.0.1 >NUL"]);
        command.stdout(Stdio::null()).stderr(Stdio::null());
        command
    }
    #[cfg(unix)]
    {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 60 & sleep 60"]);
        command.stdout(Stdio::null()).stderr(Stdio::null());
        command
    }
}

fn wait_until_dead(pid: u32, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if !process_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    !process_alive(pid)
}

#[test]
fn own_process_is_alive_and_an_unused_pid_is_not() {
    assert!(process_alive(std::process::id()));
    // Pids are far below this on every supported OS.
    assert!(!process_alive(u32::MAX - 7));
}

#[test]
fn kill_tree_ends_the_leader() {
    let mut child = spawn_group(&mut sleeper(60), SpawnOptions::default()).expect("spawn");
    let pid = child.id();
    assert!(process_alive(pid));

    child.kill_tree().expect("kill");
    assert!(wait_until_dead(pid, Duration::from_secs(5)));
    // Idempotent.
    child.kill_tree().expect("second kill is a no-op");
}

#[test]
fn dropping_the_owner_kills_the_group() {
    let child = spawn_group(&mut sleeper(60), SpawnOptions::default()).expect("spawn");
    let pid = child.id();
    drop(child);
    assert!(wait_until_dead(pid, Duration::from_secs(5)));
}

/// The point of a group: a grandchild the leader started dies with it.
#[test]
fn kill_tree_takes_grandchildren_down() {
    let mut child =
        spawn_group(&mut parent_with_grandchild(), SpawnOptions::default()).expect("spawn");
    let leader = child.id();
    // Give the leader time to start its grandchild.
    std::thread::sleep(Duration::from_millis(800));

    let before = descendants_of(leader);
    assert!(!before.is_empty(), "the leader should have started a grandchild");

    child.kill_tree().expect("kill");
    assert!(wait_until_dead(leader, Duration::from_secs(5)));
    for pid in before {
        assert!(wait_until_dead(pid, Duration::from_secs(5)), "grandchild {pid} survived");
    }
}

/// Pids whose parent is `parent`, asked from the OS.
fn descendants_of(parent: u32) -> Vec<u32> {
    #[cfg(windows)]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Get-CimInstance Win32_Process -Filter \"ParentProcessId={parent}\" | \
                     ForEach-Object {{ $_.ProcessId }}"
                ),
            ])
            .output()
            .expect("powershell");
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }
    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .args(["-o", "pid=", "--ppid", &parent.to_string()])
            .output()
            .expect("ps");
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }
}

#[test]
fn wait_returns_the_exit_status_of_a_finishing_leader() {
    let mut child = spawn_group(&mut sleeper(1), SpawnOptions::default()).expect("spawn");
    let status = child.wait().expect("wait");
    assert!(status.success());
    assert_eq!(child.try_wait().expect("try_wait").map(|status| status.success()), Some(true));
}

#[test]
fn a_detached_daemon_survives_and_can_be_found_by_pid() {
    let pid = spawn_detached(&mut sleeper(4)).expect("spawn detached");
    assert!(process_alive(pid));
    // It ends on its own; nothing owns it.
    assert!(wait_until_dead(pid, Duration::from_secs(15)));
}

#[test]
fn terminate_process_ends_a_daemon_nobody_owns() {
    let pid = spawn_detached(&mut sleeper(60)).expect("spawn detached");
    assert!(process_alive(pid));
    crate::terminate_process(pid).expect("terminate");
    assert!(wait_until_dead(pid, Duration::from_secs(5)));
    // Already gone: still success.
    crate::terminate_process(pid).expect("terminate again");
}

#[test]
fn free_port_can_be_bound() {
    let port = free_port().expect("port");
    assert!(port > 0);
    std::net::TcpListener::bind(("127.0.0.1", port)).expect("the port is bindable");
}

#[test]
fn exclusive_lock_excludes_everyone_and_shared_locks_coexist() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("nested").join("test.lock");

    let exclusive = FileLock::try_acquire(&path, LockKind::Exclusive).expect("io").expect("free");
    assert_eq!(exclusive.kind(), LockKind::Exclusive);
    assert!(FileLock::try_acquire(&path, LockKind::Exclusive).expect("io").is_none());
    assert!(FileLock::try_acquire(&path, LockKind::Shared).expect("io").is_none());
    drop(exclusive);

    let first = FileLock::try_acquire(&path, LockKind::Shared).expect("io").expect("free");
    let second = FileLock::try_acquire(&path, LockKind::Shared).expect("io").expect("shared");
    assert!(FileLock::try_acquire(&path, LockKind::Exclusive).expect("io").is_none());
    drop((first, second));
    assert!(FileLock::try_acquire(&path, LockKind::Exclusive).expect("io").is_some());
}

#[test]
fn bounded_acquire_gives_up_at_the_deadline_and_succeeds_once_released() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("test.lock");
    let holder = FileLock::try_acquire(&path, LockKind::Exclusive).expect("io").expect("free");

    let started = Instant::now();
    let timed_out =
        FileLock::acquire(&path, LockKind::Exclusive, Duration::from_millis(200)).expect("io");
    assert!(timed_out.is_none());
    assert!(started.elapsed() >= Duration::from_millis(200));

    let releaser = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        drop(holder);
    });
    let acquired =
        FileLock::acquire(&path, LockKind::Exclusive, Duration::from_secs(5)).expect("io");
    assert!(acquired.is_some());
    releaser.join().expect("join");
}

#[test]
fn inference_shares_the_gpu_and_training_needs_it_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    let locks = dir.path();
    let short = Duration::from_millis(150);

    let chat = GpuLease::acquire(locks, "llama-chat", LeaseKind::Inference, 6 << 30, short)
        .expect("first inference lease");
    let embed = GpuLease::acquire(locks, "llama/embed", LeaseKind::Inference, 1 << 30, short)
        .expect("inference leases coexist");

    let holders = GpuLease::holders(locks).expect("holders");
    let roles: Vec<&str> = holders.iter().map(|holder| holder.role.as_str()).collect();
    assert_eq!(roles.len(), 2);
    assert!(roles.contains(&"llama-chat") && roles.contains(&"llama/embed"));
    assert!(holders.iter().all(|holder| holder.pid == std::process::id()));

    // Training cannot start while inference holds the GPU, and says who does.
    let busy = GpuLease::acquire(locks, "train-lora", LeaseKind::Training, 11 << 30, short)
        .expect_err("gpu is busy");
    match busy {
        LeaseError::Busy { holders, .. } => assert_eq!(holders.len(), 2),
        other => panic!("expected Busy, got {other}"),
    }

    drop((chat, embed));
    assert!(GpuLease::holders(locks).expect("holders").is_empty(), "sidecars are removed");

    let training = GpuLease::acquire(locks, "train-lora", LeaseKind::Training, 11 << 30, short)
        .expect("training gets the free gpu");
    // And inference now has to wait for training.
    assert!(matches!(
        GpuLease::acquire(locks, "llama-chat", LeaseKind::Inference, 0, short),
        Err(LeaseError::Busy { .. })
    ));
    drop(training);
}

#[test]
fn a_sidecar_left_by_a_dead_holder_is_pruned() {
    let dir = tempfile::tempdir().expect("tempdir");
    let sidecars = dir.path().join("gpu.d");
    std::fs::create_dir_all(&sidecars).expect("mkdir");
    let stale = sidecars.join("4294967288-ghost.json");
    std::fs::write(
        &stale,
        r#"{"role":"ghost","pid":4294967288,"kind":"inference","vram_bytes":0,"since_unix":1}"#,
    )
    .expect("write");
    std::fs::write(sidecars.join("garbage.json"), "not json").expect("write");

    assert!(GpuLease::holders(dir.path()).expect("holders").is_empty());
    assert!(!stale.exists(), "stale sidecar removed");
    assert!(!sidecars.join("garbage.json").exists(), "unreadable sidecar removed");
}
