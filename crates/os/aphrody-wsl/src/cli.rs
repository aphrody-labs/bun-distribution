// SPDX-License-Identifier: Apache-2.0
use std::{fs,path::PathBuf};
use clap::Subcommand;
use crate::{Config,Result,Target,artifact,build,doctor,expected_artifacts,import,plan,sources};

#[derive(Debug,Clone,Subcommand)]
pub enum Action {
    /// Verify source pins and installed build tools.
    Doctor,
    /// Inspect source revisions and dirtiness.
    Sources,
    /// Show exact build commands without executing them.
    Plan {#[arg(value_enum)] target:Target},
    /// Install host Linux dependencies (Windows prerequisites use native setup).
    Dependencies,
    /// Compile an upstream component or assemble the guest root filesystem.
    Build {#[arg(value_enum)] target:Target},
    /// Build kernel, WSLg, Windows WSL and the Aphrody OS guest in sequence.
    All,
    /// Read build evidence; missing and failed reports remain visible.
    Status,
    /// Hash and validate expected nonempty artifacts.
    Verify {#[arg(value_enum)] target:Target},
    /// Import a new distro, preserving every existing distribution.
    Import {#[arg(long)] install_dir:PathBuf},
}
pub fn run(action:Action,config_path:PathBuf)->Result<()> {
    let config=Config::read(&config_path)?;
    let result=match action {
        Action::Doctor=>doctor(&config)?,
        Action::Sources=>serde_json::to_value(sources(&config)?)?,
        Action::Plan{target}=>serde_json::to_value(plan(&config,target)?)?,
        Action::Build{target}=>serde_json::to_value(build(&config,target)?)?,
        Action::All=>{let mut results=vec![];for target in [Target::Kernel,Target::Wslg,Target::Wsl,Target::Distro]{results.push(build(&config,target)?);}serde_json::to_value(results)?},
        Action::Status=>{
            let mut reports=serde_json::Map::new();for target in [Target::Kernel,Target::Wslg,Target::Wsl,Target::Distro]{let path=config.output_root.join(format!("{}-report.json",target.name()));reports.insert(target.name().into(),if path.exists(){serde_json::from_slice(&fs::read(path)?)?}else{serde_json::json!({"state":"not-built"})});}serde_json::Value::Object(reports)
        },
        Action::Verify{target}=>serde_json::to_value(expected_artifacts(&config,target).iter().map(|p|artifact(p)).collect::<Result<Vec<_>>>()?)?,
        Action::Import{install_dir}=>{import(&config,&install_dir)?;serde_json::json!({"imported":config.distribution})},
        Action::Dependencies=>{
            let status=std::process::Command::new("sudo").args(["-n","env","DEBIAN_FRONTEND=noninteractive","apt-get","install","-y","build-essential","flex","bison","dwarves","libssl-dev","libelf-dev","cpio","qemu-utils","rsync","bc","e2fsprogs","kmod","debootstrap","ubuntu-keyring","podman","golang-go","pkg-config","libdw-dev","libunwind-dev","libcap-dev","libslang2-dev","libnuma-dev","libzstd-dev","zlib1g-dev","libtraceevent-dev","libpfm4-dev"]).status()?;
            if !status.success(){return Err(crate::Error::Invalid("dependency installation failed".into()));}doctor(&config)?
        },
    };
    println!("{}",serde_json::to_string_pretty(&result)?);Ok(())
}
