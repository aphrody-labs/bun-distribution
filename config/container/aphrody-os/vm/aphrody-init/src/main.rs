// SPDX-License-Identifier: Apache-2.0

//! First-stage PID 1 for the Aphrody image.
//!
//! Mounts the pseudo filesystems Bun needs to start (`/proc`, `/sys`, `/dev`,
//! `/tmp`, `/run`), then replaces itself with `bun /sbin/init.ts`, which is
//! the real init of the system.

use std::{
    os::unix::process::CommandExt,
    process::{
        Command,
        exit, //
    },
};

use rustix::{
    fs::{
        Mode,
        mkdir, //
    },
    mount::{
        MountFlags,
        mount, //
    },
    system::{
        RebootCommand,
        reboot, //
    },
};

/// Pseudo filesystems mounted before handing over to Bun.
const MOUNTS: &[(&str, &str, &str, u32)] = &[
    ("proc", "/proc", "proc", 0o555),
    ("sysfs", "/sys", "sysfs", 0o555),
    ("devtmpfs", "/dev", "devtmpfs", 0o755),
    ("devpts", "/dev/pts", "devpts", 0o755),
    ("tmpfs", "/dev/shm", "tmpfs", 0o1777),
    ("tmpfs", "/tmp", "tmpfs", 0o1777),
    ("tmpfs", "/run", "tmpfs", 0o755),
];

/// Program and arguments that replace this process.
const NEXT: &[&str] = &["/usr/bin/bun", "/sbin/init.ts"];

fn main() {
    for &(source, target, fstype, mode) in MOUNTS {
        // The directory usually exists in the initramfs already.
        let _ = mkdir(target, Mode::from_raw_mode(mode));

        if let Err(err) = mount(source, target, fstype, MountFlags::empty(), None) {
            eprintln!("aphrody-init: cannot mount {fstype} on {target}: {err}");
        }
    }

    let err = Command::new(NEXT[0])
        .args(&NEXT[1..])
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin")
        .env("HOME", "/root")
        .env("TERM", "linux")
        .exec();
    eprintln!("aphrody-init: cannot exec {}: {err}", NEXT[0]);

    // PID 1 must never exit; power off cleanly instead of panicking the kernel.
    let _ = reboot(RebootCommand::PowerOff);
    exit(1);
}
