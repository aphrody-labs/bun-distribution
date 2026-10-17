// SPDX-License-Identifier: Apache-2.0
use crate::wsl::{
    Config, Result, Target, artifact, build, doctor, expected_artifacts, import, latest_kernel,
    plan, sources,
};
use aphrody_proc::NoWindow as _;
use clap::{Parser, Subcommand};
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Subcommand)]
pub enum Action {
    /// Verify source pins and installed build tools.
    Doctor,
    /// Inspect source revisions and dirtiness.
    Sources,
    /// Show exact build commands without executing them.
    Plan {
        #[arg(value_enum)]
        target: Target,
    },
    /// Install host Linux dependencies (Windows prerequisites use native setup).
    Dependencies,
    /// Compile an upstream component or assemble the guest root filesystem.
    Build {
        #[arg(value_enum)]
        target: Target,
    },
    /// Build both kernels, WSLg, Windows WSL and the Aphrody OS guest in sequence.
    All,
    /// Resolve the newest kernel.org stable tag; --apply moves the linux-stable pin to it.
    Latest {
        #[arg(long)]
        apply: bool,
    },
    /// Read build evidence; missing and failed reports remain visible.
    Status,
    /// Hash and validate expected nonempty artifacts.
    Verify {
        #[arg(value_enum)]
        target: Target,
    },
    /// Import a new distro, preserving every existing distribution.
    Import {
        #[arg(long)]
        install_dir: PathBuf,
    },
    /// Inspect or launch WSLg on the Windows host (no build configuration needed).
    Wslg {
        #[command(subcommand)]
        action: crate::wsl::wslg::WslgAction,
    },
}
#[derive(Parser)]
#[command(version, about = "Aphrody WSL source build and distribution workbench")]
struct Args {
    #[arg(
        long,
        env = "APHRODY_WSL_BUILD_CONFIG",
        default_value = "tools/config/os/wsl-build.json"
    )]
    config: PathBuf,
    #[command(subcommand)]
    action: Action,
}

/// Entry point of the former `aphrody-wsl` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<std::ffi::OsString>) -> i32 {
    let args = match Args::try_parse_from(args) {
        Ok(args) => args,
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    match run(args.action, args.config) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

pub fn run(action: Action, config_path: PathBuf) -> Result<()> {
    if let Action::Wslg { action } = action {
        println!(
            "{}",
            serde_json::to_string_pretty(&crate::wsl::wslg::run(action)?)?
        );
        return Ok(());
    }
    let config = Config::read(&config_path)?;
    let result = match action {
        Action::Doctor => doctor(&config)?,
        Action::Sources => serde_json::to_value(sources(&config)?)?,
        Action::Plan { target } => serde_json::to_value(plan(&config, target)?)?,
        Action::Build { target } => serde_json::to_value(build(&config, target)?)?,
        Action::All => {
            let mut results = vec![];
            for target in Target::ALL {
                results.push(build(&config, target)?);
            }
            serde_json::to_value(results)?
        }
        Action::Latest { apply } => {
            serde_json::to_value(latest_kernel(&config, &config_path, apply)?)?
        }
        Action::Status => {
            let mut reports = serde_json::Map::new();
            for target in Target::ALL {
                let path = config
                    .output_root
                    .join(format!("{}-report.json", target.name()));
                reports.insert(
                    target.name().into(),
                    if path.exists() {
                        serde_json::from_slice(&fs::read(path)?)?
                    } else {
                        serde_json::json!({"state":"not-built"})
                    },
                );
            }
            serde_json::Value::Object(reports)
        }
        Action::Verify { target } => serde_json::to_value(
            expected_artifacts(&config, target)
                .iter()
                .map(|p| artifact(p))
                .collect::<Result<Vec<_>>>()?,
        )?,
        Action::Import { install_dir } => {
            import(&config, &install_dir)?;
            serde_json::json!({"imported":config.distribution})
        }
        Action::Wslg { .. } => unreachable!("handled before the build configuration is read"),
        Action::Dependencies => {
            let status = std::process::Command::new("sudo")
                .no_window()
                .args([
                    "-n",
                    "env",
                    "DEBIAN_FRONTEND=noninteractive",
                    "apt-get",
                    "install",
                    "-y",
                    "build-essential",
                    "flex",
                    "bison",
                    "dwarves",
                    "libssl-dev",
                    "libelf-dev",
                    "cpio",
                    "qemu-utils",
                    "rsync",
                    "bc",
                    "e2fsprogs",
                    "kmod",
                    "debootstrap",
                    "ubuntu-keyring",
                    "podman",
                    "golang-go",
                    "pkg-config",
                    "libdw-dev",
                    "libunwind-dev",
                    "libcap-dev",
                    "libslang2-dev",
                    "libnuma-dev",
                    "libzstd-dev",
                    "zlib1g-dev",
                    "libtraceevent-dev",
                    "libpfm4-dev",
                    "clang",
                    "lld",
                    "llvm",
                    "gnupg",
                ])
                .status()?;
            if !status.success() {
                return Err(crate::wsl::Error::Invalid(
                    "dependency installation failed".into(),
                ));
            }
            // Rust-for-Linux needs bindgen >= 0.71.1 (newer than older distro packages) and the rust-src component.
            let status = std::process::Command::new("cargo")
                .no_window()
                .args(["install", "--locked", "bindgen-cli"])
                .status()?;
            if !status.success() {
                return Err(crate::wsl::Error::Invalid(
                    "bindgen-cli installation failed".into(),
                ));
            }
            let status = std::process::Command::new("rustup")
                .no_window()
                .args(["component", "add", "rust-src"])
                .status()?;
            if !status.success() {
                return Err(crate::wsl::Error::Invalid(
                    "rust-src installation failed".into(),
                ));
            }
            doctor(&config)?
        }
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
