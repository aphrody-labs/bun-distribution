// SPDX-License-Identifier: Apache-2.0
//! Keep ordinary Rust compilations in sccache while routing long Windows
//! invocations through rustc response files before CreateProcessW's limit.

use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const SCCACHE_SAFE_COMMAND_UNITS: usize = 24_000;

fn main() {
    match run(env::args_os().skip(1)) {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("aphrody rustc wrapper: {error}");
            std::process::exit(1);
        },
    }
}

fn run(args: impl IntoIterator<Item = OsString>) -> io::Result<ExitStatus> {
    let mut args = args.into_iter();
    let rustc = args.next().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Cargo did not pass a rustc executable")
    })?;
    let rustc_args: Vec<OsString> = args.collect();
    let sccache = find_sccache()?;

    let forwarded_units = command_line_units(
        sccache.as_os_str(),
        std::iter::once(rustc.as_os_str()).chain(rustc_args.iter().map(OsString::as_os_str)),
    )?;
    if forwarded_units <= SCCACHE_SAFE_COMMAND_UNITS {
        return run_sccache_or_fallback(&sccache, &rustc, &rustc_args);
    }

    eprintln!(
        "aphrody rustc wrapper: long invocation ({forwarded_units} UTF-16 units); bypassing sccache with rustc @response file"
    );
    let expanded_args = expand_response_arguments(&rustc_args)?;
    let response = ResponseFile::create(&expanded_args)?;
    run_child(Command::new(rustc).arg(response.argument()))
}

fn run_child(command: &mut Command) -> io::Result<ExitStatus> {
    command.status()
}

fn run_sccache_or_fallback(
    sccache: &PathBuf,
    rustc: &OsStr,
    args: &[OsString],
) -> io::Result<ExitStatus> {
    let mut child = Command::new(sccache)
        .arg(rustc)
        .args(args)
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("sccache stderr pipe was not available"))?;
    let reader = thread::spawn(move || -> io::Result<bool> {
        let mut chunk = [0u8; 8192];
        let mut line = Vec::with_capacity(256);
        let mut detected = false;
        let mut output_failed = false;
        loop {
            let count = stderr.read(&mut chunk)?;
            if count == 0 {
                break;
            }
            if !output_failed && io::stderr().write_all(&chunk[..count]).is_err() {
                output_failed = true;
            }
            for byte in &chunk[..count] {
                line.push(*byte);
                if *byte == b'\n' {
                    detected |= is_sccache_command_line_error(&line);
                    line.clear();
                } else if line.len() > 8192 {
                    line.drain(..4096);
                }
            }
        }
        detected |= is_sccache_command_line_error(&line);
        if output_failed {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "could not forward sccache stderr"))
        } else {
            Ok(detected)
        }
    });
    let status = child.wait()?;
    let command_line_error =
        reader.join().map_err(|_| io::Error::other("sccache stderr reader panicked"))??;
    if !status.success() && command_line_error {
        eprintln!(
            "aphrody rustc wrapper: sccache hit Windows command-line error 206 after expanding rustc arguments; retrying once with rustc @response file"
        );
        let expanded_args = expand_response_arguments(args)?;
        let response = ResponseFile::create(&expanded_args)?;
        return run_child(Command::new(rustc).arg(response.argument()));
    }
    Ok(status)
}

fn expand_response_arguments(args: &[OsString]) -> io::Result<Vec<OsString>> {
    let mut expanded = Vec::with_capacity(args.len());
    for arg in args {
        let Some(value) = arg.to_str() else {
            expanded.push(arg.clone());
            continue;
        };
        let Some(path) = value.strip_prefix('@') else {
            expanded.push(arg.clone());
            continue;
        };
        let contents = fs::read_to_string(path)?;
        expanded.extend(contents.lines().map(OsString::from));
    }
    Ok(expanded)
}

fn is_sccache_command_line_error(line: &[u8]) -> bool {
    contains_bytes(line, b"sccache: caused by:") && contains_bytes(line, b"os error 206")
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn find_sccache() -> io::Result<PathBuf> {
    if let Some(configured) = env::var_os("APHRODY_SCCACHE_EXE") {
        let configured = PathBuf::from(configured);
        if configured.components().count() > 1 || configured.is_absolute() {
            if configured.is_file() {
                return Ok(configured);
            }
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("configured sccache executable does not exist: {}", configured.display()),
            ));
        }
        for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
            let candidate = directory.join(&configured);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "configured sccache executable was not found on PATH: {}",
                configured.display()
            ),
        ));
    }
    if let Ok(executable) = env::current_exe()
        && let Some(parent) = executable.parent()
    {
        let sibling = parent.join(if cfg!(windows) { "sccache.exe" } else { "sccache" });
        if sibling.is_file() {
            return Ok(sibling);
        }
    }

    for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
        for name in if cfg!(windows) {
            ["sccache.exe", "sccache"].as_slice()
        } else {
            ["sccache"].as_slice()
        } {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "sccache was not found beside the wrapper or on PATH",
    ))
}

fn command_line_units<'a>(
    executable: &'a OsStr,
    args: impl IntoIterator<Item = &'a OsStr>,
) -> io::Result<usize> {
    let mut units = 1usize;
    for (index, arg) in std::iter::once(executable).chain(args).enumerate() {
        if index != 0 {
            units += 1;
        }
        units = units.checked_add(quoted_units(arg)?).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "command-line length overflow")
        })?;
    }
    Ok(units)
}

fn quoted_units(arg: &OsStr) -> io::Result<usize> {
    let value = arg.to_str().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "compiler argument is not valid UTF-8")
    })?;
    let mut units = 2usize;
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                units += backslashes * 2 + 2;
                backslashes = 0;
            },
            _ => {
                units += backslashes + character.len_utf16();
                backslashes = 0;
            },
        }
    }
    units += backslashes * 2;
    Ok(units)
}

#[derive(Debug)]
struct ResponseFile(PathBuf);

impl ResponseFile {
    fn create(args: &[OsString]) -> io::Result<Self> {
        for arg in args {
            let value = arg.to_str().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "compiler argument is not valid UTF-8")
            })?;
            if value.contains('\r') || value.contains('\n') {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "rustc response files cannot represent arguments containing CR or LF",
                ));
            }
        }
        let directory = env::temp_dir();
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        for attempt in 0..32u32 {
            let path = directory
                .join(format!("aphrody-rustc-{}-{nonce:x}-{attempt:x}.rsp", std::process::id()));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let response = Self(path);
                    let write_result = args.iter().try_for_each(|arg| {
                        let value = arg.to_str().ok_or_else(|| {
                            io::Error::new(
                                io::ErrorKind::InvalidInput,
                                "compiler argument is not valid UTF-8",
                            )
                        })?;
                        writeln!(file, "{value}")
                    });
                    drop(file);
                    write_result?;
                    return Ok(response);
                },
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique rustc response file",
        ))
    }

    fn argument(&self) -> OsString {
        let mut argument = OsString::from("@");
        argument.push(&self.0);
        argument
    }
}

impl Drop for ResponseFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.0)
            && error.kind() != io::ErrorKind::NotFound
        {
            eprintln!("aphrody rustc wrapper: failed to remove response file: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_measurement_counts_utf16_and_escaping() {
        assert_eq!(quoted_units(OsStr::new("a")).unwrap(), 3);
        assert_eq!(quoted_units(OsStr::new("💜")).unwrap(), 4);
        assert_eq!(quoted_units(OsStr::new("a\\\"b")).unwrap(), 8);
        let path = OsStr::new("C:\\path with spaces\\é");
        assert_eq!(quoted_units(path).unwrap(), path.to_str().unwrap().encode_utf16().count() + 2);
    }

    #[test]
    fn response_file_keeps_each_argument_on_its_own_line() {
        let args = vec![
            OsString::from("--check-cfg"),
            OsString::from("cfg(feature, values(\"x\"))"),
            OsString::from("C:\\path with spaces\\é.rs"),
        ];
        let response = ResponseFile::create(&args).unwrap();
        assert_eq!(
            fs::read_to_string(&response.0).unwrap(),
            "--check-cfg\ncfg(feature, values(\"x\"))\nC:\\path with spaces\\é.rs\n"
        );
        assert!(response.argument().to_string_lossy().starts_with('@'));
        let path = response.0.clone();
        drop(response);
        assert!(!path.exists());
    }

    #[test]
    fn fallback_flattens_cargo_response_file_and_compiles_with_rustc() {
        let directory = env::temp_dir().join(format!(
            "aphrody-rustc-response-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let cargo_args = directory.join("cargo-args.rsp");
        let source = directory.join("probe.rs");
        let output = directory.join("probe.rmeta");
        fs::write(&source, "pub fn probe() {}\n").unwrap();
        fs::write(
            &cargo_args,
            format!(
                "--crate-name\nrouter_response_probe\n--crate-type\nlib\n--emit=metadata\n-o\n{}\n{}\n",
                output.display(),
                source.display()
            ),
        )
        .unwrap();
        let input = vec![OsString::from(format!("@{}", cargo_args.display()))];
        let flattened = expand_response_arguments(&input).unwrap();
        assert!(!flattened.iter().any(|arg| arg.to_string_lossy().starts_with('@')));
        let response = ResponseFile::create(&flattened).unwrap();
        let status = Command::new("rustc").arg(response.argument()).status().unwrap();
        assert!(status.success());
        assert!(output.is_file());
        drop(response);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn response_file_expansion_is_one_level_only() {
        let directory = env::temp_dir().join(format!(
            "aphrody-rustc-response-depth-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let nested = directory.join("nested.rsp");
        let outer = directory.join("outer.rsp");
        fs::write(&nested, "--edition=2024\n").unwrap();
        fs::write(&outer, format!("@{}\n", nested.display())).unwrap();
        let expanded =
            expand_response_arguments(&[OsString::from(format!("@{}", outer.display()))]).unwrap();
        assert_eq!(expanded, [OsString::from(format!("@{}", nested.display()))]);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn response_file_rejects_line_breaks_without_leaking_file() {
        let result = ResponseFile::create(&[OsString::from("bad\nargument")]);
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn detects_only_sccache_wrapped_windows_command_line_errors() {
        assert!(is_sccache_command_line_error(
            "sccache: caused by: Nom de fichier ou extension trop long. (os error 206)".as_bytes()
        ));
        assert!(!is_sccache_command_line_error("rustc: error: os error 206".as_bytes()));
    }

    #[cfg(windows)]
    #[test]
    fn response_file_rejects_unpaired_utf16_without_creating_a_file() {
        use std::os::windows::ffi::OsStringExt;
        let invalid = OsString::from_wide(&[0xd800]);
        assert_eq!(
            ResponseFile::create(&[invalid]).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
