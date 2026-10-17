use std::env;
use std::path::PathBuf;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("aphrody-homebrew: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let root = root
        .canonicalize()
        .map_err(|error| format!("resolve IECODE root: {error}"))?;
    match args.as_slice() {
        [command] if command == "targets" => {
            println!("nds\tBlocksDS\t.nds\tBLOCKSDS");
            println!("3ds\tdevkitPro devkitARM/libctru\t.3dsx\tDEVKITARM");
            Ok(())
        }
        [command] if command == "doctor" => doctor(None),
        [command, platform] if command == "doctor" => doctor(Some(platform)),
        [command, platform] if command == "build" => build(&root, platform),
        _ => Err("usage: aphrody-homebrew <targets|doctor [nds|3ds]|build nds|build 3ds>".into()),
    }
}

fn doctor(platform: Option<&str>) -> Result<(), String> {
    let required: &[&str] = match platform {
        None => &["BLOCKSDS", "DEVKITARM"],
        Some("nds") => &["BLOCKSDS"],
        Some("3ds") => &["DEVKITPRO", "DEVKITARM"],
        Some(other) => return Err(format!("unknown target {other:?}; choose nds or 3ds")),
    };
    let mut missing = Vec::new();
    for key in required {
        match env::var_os(key) {
            Some(value) if !value.is_empty() => println!("{key}={}", value.to_string_lossy()),
            _ => {
                println!("{key}=missing");
                missing.push(*key);
            }
        }
    }
    if missing.is_empty() || platform.is_none() {
        Ok(())
    } else {
        Err(format!(
            "install the platform SDK and set {}",
            missing.join(" and ")
        ))
    }
}

fn build(root: &std::path::Path, platform: &str) -> Result<(), String> {
    let (option, target, sdk_vars): (_, _, &[&str]) = match platform {
        "nds" => ("BUILD_HOMEBREW_NDS", "homebrew_nds", &["BLOCKSDS"]),
        "3ds" => (
            "BUILD_HOMEBREW_3DS",
            "homebrew_3ds",
            &["DEVKITPRO", "DEVKITARM"],
        ),
        _ => return Err(format!("unknown target {platform:?}; choose nds or 3ds")),
    };
    let missing: Vec<_> = sdk_vars
        .iter()
        .filter(|key| env::var_os(key).is_none_or(|value| value.is_empty()))
        .copied()
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "{} not set; install the platform toolchain first",
            missing.join(" and ")
        ));
    }
    let build_dir = root.join(format!("build/homebrew-{platform}"));
    let configure = Command::new("cmake")
        .arg("-S")
        .arg(root)
        .arg("-B")
        .arg(&build_dir)
        .arg(format!("-D{option}=ON"))
        .status()
        .map_err(|error| format!("start CMake configure: {error}"))?;
    if !configure.success() {
        return Err("CMake configure failed".into());
    }
    let status = Command::new("cmake")
        .arg("--build")
        .arg(&build_dir)
        .arg("--target")
        .arg(target)
        .status()
        .map_err(|error| format!("start CMake build: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("CMake target {target} failed with {status}"))
    }
}
