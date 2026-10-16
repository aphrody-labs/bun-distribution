//! `bunos-utils`: Bun OS multicall binary. Started as an applet name (`ls`, `nm`, `ps`, ...;
//! through a link or `argv0`) it runs that applet; started as `bunos-utils` the first argument
//! names the applet. `bunos-utils --list` prints every applet and
//! `bunos-utils --install DIR` links each applet name to this binary in `DIR`.

use std::ffi::OsString;
use std::path::Path;
use std::process::ExitCode;

#[cfg(feature = "binutils")]
mod binutils;
#[cfg(feature = "coreutils")]
mod coreutils;
#[cfg(feature = "diffutils")]
mod diffutils;
#[cfg(feature = "findutils")]
mod findutils;
#[cfg(feature = "procps")]
mod procps;

type Main = fn(Vec<OsString>) -> i32;

/// Every applet with its owner suite; one implementation per name.
fn applets() -> Vec<(&'static str, &'static str, Main)> {
    let mut all: Vec<(&'static str, &'static str, Main)> = Vec::new();
    #[cfg(feature = "coreutils")]
    all.extend(coreutils::APPLETS.iter().map(|(n, m)| (*n, "coreutils", *m)));
    #[cfg(feature = "findutils")]
    all.extend(findutils::APPLETS.iter().map(|(n, m)| (*n, "findutils", *m)));
    #[cfg(feature = "diffutils")]
    all.extend(diffutils::APPLETS.iter().map(|(n, m)| (*n, "diffutils", *m)));
    #[cfg(feature = "procps")]
    all.extend(procps::APPLETS.iter().map(|(n, m)| (*n, "procps", *m)));
    #[cfg(feature = "binutils")]
    all.extend(binutils::APPLETS.iter().map(|(n, m)| (*n, "binutils", *m)));
    all
}

fn applet_of(argv0: &OsString) -> String {
    let name = Path::new(argv0)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    match name.len().checked_sub(4) {
        Some(stem) if name[stem..].eq_ignore_ascii_case(".exe") => name[..stem].to_owned(),
        _ => name,
    }
}

fn install(dir: &Path) -> i32 {
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("bunos-utils: cannot resolve its own path");
        return 1;
    };
    if let Err(err) = std::fs::create_dir_all(dir) {
        eprintln!("bunos-utils: {}: {err}", dir.display());
        return 1;
    }
    let mut code = 0;
    for (name, _, _) in applets() {
        let link = dir.join(name);
        let _ = std::fs::remove_file(&link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&exe, &link);
        #[cfg(not(unix))]
        let made = std::fs::hard_link(&exe, link.with_extension("exe"));
        if let Err(err) = made {
            eprintln!("bunos-utils: {}: {err}", link.display());
            code = 1;
        }
    }
    code
}

fn main() -> ExitCode {
    let mut args: Vec<OsString> = std::env::args_os().collect();
    let mut name = args.first().map(applet_of).unwrap_or_default();
    if name == "bunos-utils" {
        args.remove(0);
        match args.first().and_then(|a| a.to_str()) {
            None | Some("--help" | "-h") => {
                println!("usage: bunos-utils <applet> [args...] | --list | --install DIR");
                return ExitCode::SUCCESS;
            }
            Some("--list") => {
                for (applet, suite, _) in applets() {
                    println!("{applet}\t{suite}");
                }
                return ExitCode::SUCCESS;
            }
            Some("--install") => {
                let Some(dir) = args.get(1) else {
                    eprintln!("bunos-utils: --install needs a directory");
                    return ExitCode::from(2);
                };
                return ExitCode::from(install(Path::new(dir)) as u8);
            }
            Some(_) => name = applet_of(&args[0]),
        }
    }
    let Some((_, _, run)) = applets().into_iter().find(|(n, _, _)| *n == name) else {
        eprintln!("bunos-utils: {name}: applet not found");
        return ExitCode::from(127);
    };
    ExitCode::from(run(args).clamp(0, 255) as u8)
}
