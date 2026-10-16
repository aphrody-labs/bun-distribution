// SPDX-License-Identifier: Apache-2.0
//! Elevated execution without a new console window.
//!
//! [`run_elevated`] picks the platform elevation path once, through [`Elevation::detect`]:
//!
//! - the caller already holds administrator rights (elevated Windows token, Unix effective uid
//!   0): the program runs directly;
//! - Windows, Sudo for Windows enabled inline (developer workstations) and a caller console:
//!   `sudo.exe --inline` runs the program in that console, so its streams and exit code are the
//!   caller's and no window opens; the `disableInput` sudo mode maps to `--disable-input`;
//! - Windows otherwise (sudo absent, disabled, configured for a new window, or no caller
//!   console): the UAC consent prompt through `ShellExecuteExW` with the `runas` verb and
//!   `SW_HIDE`. The prompt is the only visible surface; the program's own console stays hidden,
//!   its standard streams are not connected to the caller, and its exit code is returned;
//! - Unix: `sudo-rs` when it is on `PATH`, otherwise `sudo` (sudo-rs installed under that name).

use std::{
    ffi::{OsStr, OsString},
    io,
    path::{Path, PathBuf},
    process::Command,
};

use crate::NoWindow as _;

/// How the current process obtains administrator rights.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Elevation {
    /// The caller already holds administrator rights.
    Elevated,
    /// Sudo for Windows (`%SystemRoot%\System32\sudo.exe`) and the mode flag its configuration
    /// allows without a new window.
    WindowsSudo {
        /// Path of `sudo.exe`.
        program: PathBuf,
        /// `--inline` or `--disable-input`.
        mode_flag: &'static str,
    },
    /// The UAC consent prompt (`ShellExecuteExW`, verb `runas`, hidden program window).
    Uac,
    /// `sudo-rs` or `sudo` on Unix.
    Sudo {
        /// Resolved sudo executable.
        program: PathBuf,
    },
}

impl Elevation {
    /// Detect the elevation path of the current process.
    ///
    /// # Errors
    /// On Unix, when the caller is not root and neither `sudo-rs` nor `sudo` is on `PATH`.
    pub fn detect() -> io::Result<Self> {
        if is_elevated() {
            return Ok(Self::Elevated);
        }
        detect_unelevated()
    }

    /// Stable label of the path, for diagnostics and JSON reports.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Elevated => "elevated",
            Self::WindowsSudo { .. } => "windows-sudo",
            Self::Uac => "uac",
            Self::Sudo { .. } => "sudo",
        }
    }

    /// The command line that runs `program` through this path, or `None` for [`Self::Uac`], which
    /// is a shell verb rather than a command line.
    #[must_use]
    pub fn command_line(
        &self,
        program: &OsStr,
        args: &[OsString],
        cwd: &Path,
    ) -> Option<(PathBuf, Vec<OsString>)> {
        match self {
            Self::Elevated => Some((PathBuf::from(program), args.to_vec())),
            Self::WindowsSudo {
                program: sudo,
                mode_flag,
            } => {
                let mut argv: Vec<OsString> = vec![
                    OsString::from(*mode_flag),
                    OsString::from("--chdir"),
                    cwd.as_os_str().to_owned(),
                    program.to_owned(),
                ];
                argv.extend(args.iter().cloned());
                Some((sudo.clone(), argv))
            }
            Self::Sudo { program: sudo } => {
                let mut argv: Vec<OsString> = vec![OsString::from("--"), program.to_owned()];
                argv.extend(args.iter().cloned());
                Some((sudo.clone(), argv))
            }
            Self::Uac => None,
        }
    }
}

/// Run `program` with administrator rights and wait for it.
///
/// `cwd` defaults to the current directory. Returns the program exit code (1 when it ended
/// without one, for example on a Unix signal).
///
/// # Errors
/// No elevation path, a program that cannot start, or a declined UAC prompt.
pub fn run_elevated(program: &OsStr, args: &[OsString], cwd: Option<&Path>) -> io::Result<i32> {
    let cwd = match cwd {
        Some(dir) => dir.to_path_buf(),
        None => std::env::current_dir()?,
    };
    let elevation = Elevation::detect()?;
    match elevation.command_line(program, args, &cwd) {
        Some((exe, argv)) => {
            let mut command = Command::new(exe).no_window();
            let status = command.args(argv).current_dir(&cwd).status()?;
            Ok(status.code().unwrap_or(1))
        }
        None => run_uac(program, args, &cwd),
    }
}

/// Quote one argument for a Windows command line (the `CommandLineToArgvW` / MSVC CRT rules).
#[must_use]
pub fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return arg.to_owned();
    }
    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            other => {
                quoted.extend(std::iter::repeat_n('\\', backslashes));
                quoted.push(other);
                backslashes = 0;
            }
        }
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

/// Join arguments into one Windows command-line parameter string.
#[must_use]
pub fn join_windows_args(args: &[OsString]) -> String {
    args.iter()
        .map(|arg| quote_windows_arg(&arg.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(windows)]
pub use win::is_elevated;

#[cfg(windows)]
fn detect_unelevated() -> io::Result<Elevation> {
    let Some(mode_flag) = win::sudo_mode_flag() else {
        return Ok(Elevation::Uac);
    };
    let Some(root) = std::env::var_os("SystemRoot") else {
        return Ok(Elevation::Uac);
    };
    let program = Path::new(&root).join("System32").join("sudo.exe");
    if program.is_file() && win::has_console() {
        Ok(Elevation::WindowsSudo { program, mode_flag })
    } else {
        Ok(Elevation::Uac)
    }
}

#[cfg(windows)]
fn run_uac(program: &OsStr, args: &[OsString], cwd: &Path) -> io::Result<i32> {
    win::shell_execute_runas(program, &join_windows_args(args), cwd)
}

/// Whether the current process runs with an effective uid of 0.
#[cfg(unix)]
#[must_use]
pub fn is_elevated() -> bool {
    rustix::process::geteuid().is_root()
}

#[cfg(unix)]
fn detect_unelevated() -> io::Result<Elevation> {
    ["sudo-rs", "sudo"]
        .into_iter()
        .find_map(find_on_path)
        .map(|program| Elevation::Sudo { program })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "neither sudo-rs nor sudo is on PATH",
            )
        })
}

#[cfg(unix)]
fn find_on_path(name: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt as _;
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(name))
        .find(|path| {
            path.metadata()
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
}

#[cfg(unix)]
fn run_uac(_program: &OsStr, _args: &[OsString], _cwd: &Path) -> io::Result<i32> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "UAC exists only on Windows",
    ))
}

/// No privilege model on this target: nothing is elevated.
#[cfg(not(any(unix, windows)))]
#[must_use]
pub const fn is_elevated() -> bool {
    false
}

#[cfg(not(any(unix, windows)))]
fn detect_unelevated() -> io::Result<Elevation> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "no elevation path on this target",
    ))
}

#[cfg(not(any(unix, windows)))]
fn run_uac(_program: &OsStr, _args: &[OsString], _cwd: &Path) -> io::Result<i32> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "UAC exists only on Windows",
    ))
}

#[cfg(windows)]
mod win {
    use std::{ffi::OsStr, io, os::windows::ffi::OsStrExt as _, path::Path};

    use windows::{
        Win32::{
            Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0},
            Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation},
            System::{
                Console::GetConsoleWindow,
                Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RegGetValueW},
                Threading::{
                    GetCurrentProcess, GetExitCodeProcess, INFINITE, OpenProcessToken,
                    WaitForSingleObject,
                },
            },
            UI::{
                Shell::{
                    SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
                    SHELLEXECUTEINFOW, ShellExecuteExW,
                },
                WindowsAndMessaging::SW_HIDE,
            },
        },
        core::{PCWSTR, w},
    };

    /// Sudo for Windows modes (`HKLM\...\CurrentVersion\Sudo`, value `Enabled`).
    const SUDO_DISABLE_INPUT: u32 = 2;
    const SUDO_INLINE: u32 = 3;

    fn wide(text: &OsStr) -> Vec<u16> {
        text.encode_wide().chain(std::iter::once(0)).collect()
    }

    /// Whether the current process token is elevated.
    #[must_use]
    pub fn is_elevated() -> bool {
        let mut token = HANDLE::default();
        // SAFETY: `GetCurrentProcess` returns a pseudo handle; `token` is a valid out pointer.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) }.is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        // SAFETY: the buffer is a `TOKEN_ELEVATION` of the size passed; `token` is open.
        let queried = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                Some((&raw mut elevation).cast()),
                u32::try_from(size_of::<TOKEN_ELEVATION>()).unwrap_or(u32::MAX),
                &raw mut returned,
            )
        };
        // SAFETY: `token` was opened above and is closed once.
        let _ = unsafe { CloseHandle(token) };
        queried.is_ok() && elevation.TokenIsElevated != 0
    }

    pub(super) fn has_console() -> bool {
        // SAFETY: `GetConsoleWindow` takes no arguments and only reads the calling process state.
        !unsafe { GetConsoleWindow() }.0.is_null()
    }

    /// The sudo flag the system configuration allows without a new window, if any.
    pub(super) fn sudo_mode_flag() -> Option<&'static str> {
        let mut value = 0u32;
        let mut size = u32::try_from(size_of::<u32>()).unwrap_or(4);
        // SAFETY: the subkey and value names are static wide strings; `value` is a DWORD buffer
        // of `size` bytes.
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Sudo"),
                w!("Enabled"),
                RRF_RT_REG_DWORD,
                None,
                Some((&raw mut value).cast()),
                Some(&raw mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        match value {
            SUDO_INLINE => Some("--inline"),
            SUDO_DISABLE_INPUT => Some("--disable-input"),
            _ => None,
        }
    }

    /// UAC elevation with a hidden program window; waits and returns the exit code.
    pub(super) fn shell_execute_runas(
        program: &OsStr,
        parameters: &str,
        cwd: &Path,
    ) -> io::Result<i32> {
        let verb = wide(OsStr::new("runas"));
        let file = wide(program);
        let params = wide(OsStr::new(parameters));
        let directory = wide(cwd.as_os_str());
        let mut info = SHELLEXECUTEINFOW {
            cbSize: u32::try_from(size_of::<SHELLEXECUTEINFOW>()).unwrap_or(u32::MAX),
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: PCWSTR(verb.as_ptr()),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            lpDirectory: PCWSTR(directory.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        // SAFETY: every string pointer outlives the call; `info` is a valid, sized struct.
        unsafe { ShellExecuteExW(&raw mut info) }.map_err(io::Error::other)?;
        let process = info.hProcess;
        if process.is_invalid() {
            return Err(io::Error::other(
                "ShellExecuteExW returned no process handle",
            ));
        }
        // SAFETY: `process` is the handle requested with SEE_MASK_NOCLOSEPROCESS.
        let waited = unsafe { WaitForSingleObject(process, INFINITE) };
        let mut code = 1u32;
        // SAFETY: `process` is valid until closed below; `code` is a valid out pointer.
        let exited = unsafe { GetExitCodeProcess(process, &raw mut code) };
        // SAFETY: `process` is closed once.
        let _ = unsafe { CloseHandle(process) };
        if waited != WAIT_OBJECT_0 {
            return Err(io::Error::other("waiting for the elevated process failed"));
        }
        exited.map_err(io::Error::other)?;
        Ok(i32::from_ne_bytes(code.to_ne_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_windows_arg_follows_crt_rules() {
        assert_eq!(quote_windows_arg("plain"), "plain");
        assert_eq!(quote_windows_arg(""), "\"\"");
        assert_eq!(quote_windows_arg("two words"), "\"two words\"");
        assert_eq!(quote_windows_arg(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(
            quote_windows_arg(r"C:\Program Files\"),
            r#""C:\Program Files\\""#
        );
        assert_eq!(quote_windows_arg(r"C:\dir\file"), r"C:\dir\file");
        assert_eq!(quote_windows_arg(r#"a\"b"#), r#""a\\\"b""#);
    }

    #[test]
    fn join_windows_args_quotes_each_argument() {
        let args = [
            OsString::from("-x"),
            OsString::from("a b"),
            OsString::from(""),
        ];
        assert_eq!(join_windows_args(&args), "-x \"a b\" \"\"");
    }

    #[test]
    fn command_lines_per_path() {
        let args = [OsString::from("--flag"), OsString::from("value")];
        let cwd = Path::new("/work");
        let (exe, argv) = Elevation::Elevated
            .command_line(OsStr::new("tool"), &args, cwd)
            .unwrap();
        assert_eq!(exe, PathBuf::from("tool"));
        assert_eq!(argv, args.to_vec());

        let sudo = Elevation::WindowsSudo {
            program: PathBuf::from(r"C:\Windows\System32\sudo.exe"),
            mode_flag: "--inline",
        };
        let (exe, argv) = sudo.command_line(OsStr::new("tool"), &args, cwd).unwrap();
        assert_eq!(exe, PathBuf::from(r"C:\Windows\System32\sudo.exe"));
        assert_eq!(
            argv,
            ["--inline", "--chdir", "/work", "tool", "--flag", "value"].map(OsString::from)
        );

        let unix = Elevation::Sudo {
            program: PathBuf::from("/usr/bin/sudo-rs"),
        };
        let (exe, argv) = unix.command_line(OsStr::new("tool"), &args, cwd).unwrap();
        assert_eq!(exe, PathBuf::from("/usr/bin/sudo-rs"));
        assert_eq!(argv, ["--", "tool", "--flag", "value"].map(OsString::from));

        assert!(
            Elevation::Uac
                .command_line(OsStr::new("tool"), &args, cwd)
                .is_none()
        );
        assert_eq!(Elevation::Uac.label(), "uac");
        assert_eq!(sudo.label(), "windows-sudo");
    }

    #[test]
    fn detect_matches_token_state() {
        let elevated = is_elevated();
        if let Ok(path) = Elevation::detect() {
            assert_eq!(path == Elevation::Elevated, elevated);
        }
    }

    /// The direct path end to end; an unelevated runner would raise a consent prompt instead.
    #[test]
    fn elevated_caller_runs_directly_with_exit_code() {
        if !is_elevated() {
            return;
        }
        #[cfg(windows)]
        let (program, args) = ("cmd.exe", ["/c", "exit 7"]);
        #[cfg(not(windows))]
        let (program, args) = ("sh", ["-c", "exit 7"]);
        let args = args.map(OsString::from);
        let dir = std::env::temp_dir();
        assert_eq!(
            run_elevated(OsStr::new(program), &args, Some(&dir)).unwrap(),
            7
        );
    }
}
