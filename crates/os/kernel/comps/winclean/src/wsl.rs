// SPDX-License-Identifier: Apache-2.0
//! Windows WSL launcher, including invocation from the WSL guest.

use aphrody_proc::NoWindow as _;
use std::{
    io::{self, Read, Seek, SeekFrom},
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(30);
const OUTPUT_LIMIT: u64 = 4 * 1024 * 1024;

fn launcher() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("APHRODY_WSL_EXE") {
        let path = PathBuf::from(path);
        if !path.is_absolute() || !path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "APHRODY_WSL_EXE must name an existing absolute executable path",
            ));
        }
        return Ok(path);
    }
    if cfg!(windows) {
        return Ok(PathBuf::from("wsl.exe"));
    }
    let is_wsl = cfg!(target_os = "linux")
        && std::fs::read_to_string("/proc/sys/kernel/osrelease")
            .is_ok_and(|release| release.to_ascii_lowercase().contains("microsoft"));
    if !is_wsl {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "WSL management requires Windows or WSL",
        ));
    }
    if let Some(path) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).map(|dir| dir.join("wsl.exe")).find(|path| path.is_file())
    }) {
        return Ok(path);
    }
    // Respect the configured automount root rather than assuming /mnt/c.
    let output = capture(
        Command::new("wslpath").no_window().args(["-u", r"C:\Windows\System32\wsl.exe"]),
        Duration::from_secs(5),
    )?;
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    if output.status.success() && !output.timed_out && path.is_file() {
        Ok(path)
    } else {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "wsl.exe unavailable; set APHRODY_WSL_EXE to its absolute host path",
        ))
    }
}

pub(crate) struct Output {
    pub(crate) status: std::process::ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) timed_out: bool,
    pub(crate) truncated: bool,
}

pub(crate) fn capture(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    // Anonymous files avoid pipe backpressure, including a guest process retaining a
    // launcher pipe after exit. Returned bytes are capped; file growth is checked
    // every 10 ms and can overshoot the limit between checks.
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout.try_clone()?))
        .stderr(Stdio::from(stderr.try_clone()?))
        .spawn()?;
    let started = Instant::now();
    let mut timed_out = false;
    let mut truncated = false;
    let status = loop {
        let observation = (|| {
            truncated =
                stdout.metadata()?.len() > OUTPUT_LIMIT || stderr.metadata()?.len() > OUTPUT_LIMIT;
            if let Some(status) = child.try_wait()? {
                return Ok(Some(status));
            }
            timed_out = started.elapsed() >= timeout;
            if timed_out || truncated {
                child.kill()?;
                return child.wait().map(Some);
            }
            Ok(None)
        })();
        match observation {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            },
        }
    };
    stdout.seek(SeekFrom::Start(0))?;
    stderr.seek(SeekFrom::Start(0))?;
    let mut out = Vec::new();
    let mut err = Vec::new();
    stdout.take(OUTPUT_LIMIT).read_to_end(&mut out)?;
    stderr.take(OUTPUT_LIMIT).read_to_end(&mut err)?;
    Ok(Output { status, stdout: out, stderr: err, timed_out, truncated })
}

pub(crate) fn result(args: &[String]) -> serde_json::Value {
    let started = Instant::now();
    match launcher().and_then(|path| capture(Command::new(path).no_window().args(args), TIMEOUT)) {
        Ok(output) => serde_json::json!({
            "Success": output.status.success() && !output.timed_out && !output.truncated,
            "ExitCode": if output.timed_out { 124 } else { output.status.code().unwrap_or(-1) },
            "Stdout": decode(&output.stdout), "Stderr": decode(&output.stderr),
            "DurationSeconds": started.elapsed().as_secs_f64(), "TimedOut": output.timed_out,
            "OutputTruncated": output.truncated,
            "Error": if output.truncated { Some("WSL output exceeds 4 MiB per stream") } else { None },
        }),
        Err(error) => serde_json::json!({
            "Success": false, "ExitCode": -1, "Stdout": "", "Stderr": error.to_string(),
            "DurationSeconds": started.elapsed().as_secs_f64(), "TimedOut": false,
            "Error": if error.kind() == io::ErrorKind::Unsupported { "unsupported".to_owned() } else { error.to_string() },
        }),
    }
}

pub(crate) fn decode(bytes: &[u8]) -> String {
    let pairs = (bytes.len() / 2).min(64);
    let utf16 = bytes.starts_with(&[0xff, 0xfe])
        || (pairs > 0 && (0..pairs).filter(|index| bytes[index * 2 + 1] == 0).count() * 2 >= pairs);
    if utf16 {
        let bytes = bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes);
        let units: Vec<_> =
            bytes.as_chunks::<2>().0.iter().copied().map(u16::from_le_bytes).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_windows_inventory_and_linux_output() {
        let text = "Ubuntu-24.04\r\n";
        let encoded: Vec<_> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode(&encoded), text);
        assert_eq!(decode(&[&[0xff, 0xfe][..], &encoded].concat()), text);
        assert_eq!(decode("été 日本語\n".as_bytes()), "été 日本語\n");
    }

    #[cfg(unix)]
    #[test]
    fn captures_large_streams_without_pipe_deadlock() {
        let output = capture(
            Command::new("/bin/sh")
                .args(["-c", "head -c 262144 /dev/zero; head -c 262144 /dev/zero >&2"]),
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(output.status.success());
        assert!(!output.timed_out);
        assert_eq!(output.stdout.len(), 262144);
        assert_eq!(output.stderr.len(), 262144);
    }

    #[cfg(unix)]
    #[test]
    fn reaps_timed_out_launcher() {
        let output =
            capture(Command::new("/bin/sleep").arg("10"), Duration::from_millis(30)).unwrap();
        assert!(output.timed_out);
        assert!(!output.status.success());
    }

    #[cfg(unix)]
    #[test]
    fn limits_output() {
        let output = capture(
            Command::new("/usr/bin/head").args(["-c", "8388608", "/dev/zero"]),
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(output.truncated);
        assert_eq!(output.stdout.len(), OUTPUT_LIMIT as usize);
    }
}
