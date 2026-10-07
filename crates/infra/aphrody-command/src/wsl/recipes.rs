// SPDX-License-Identifier: Apache-2.0
use crate::wsl::{Config, MAINLINE_SOURCE, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Kernel,
    Mainline,
    Wslg,
    Wsl,
    Distro,
}
impl Target {
    pub const ALL: [Self; 5] = [Self::Kernel, Self::Mainline, Self::Wslg, Self::Wsl, Self::Distro];
    pub fn name(self) -> &'static str {
        match self {
            Self::Kernel => "kernel",
            Self::Mainline => "mainline",
            Self::Wslg => "wslg",
            Self::Wsl => "wsl",
            Self::Distro => "distro",
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub name: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
}
impl Step {
    pub fn new(name: &str, program: impl Into<PathBuf>, args: Vec<String>, cwd: PathBuf) -> Self {
        Self { name: name.into(), program: program.into(), args, cwd, env: BTreeMap::new() }
    }
}
pub fn plan(config: &Config, target: Target) -> Result<Vec<Step>> {
    config.validate()?;
    let path = |p: &std::path::Path| p.to_string_lossy().into_owned();
    let output = config.output_root.join(target.name());
    // Mainline reuses Microsoft's WSL configuration and turns on Rust; Microsoft-only drivers such as dxgkrnl drop out.
    let wsl_tree = config.source_root.join("WSL2-Linux-Kernel");
    let args = match target {
        Target::Kernel => vec![
            path(&wsl_tree),
            path(&output),
            config.jobs.to_string(),
            path(&wsl_tree),
            "gcc".into(),
        ],
        Target::Mainline => vec![
            path(&config.source_root.join(MAINLINE_SOURCE)),
            path(&output),
            config.jobs.to_string(),
            path(&wsl_tree),
            "rust".into(),
        ],
        Target::Wslg => vec![
            "--source-root".into(),
            path(&config.source_root),
            "--output".into(),
            path(&output),
        ],
        Target::Wsl => vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            "@WINDOWS_SCRIPT@".into(),
            "-Source".into(),
            "@WINDOWS_SOURCE@".into(),
            "-OutputRoot".into(),
            "@WINDOWS_OUTPUT@".into(),
        ],
        Target::Distro => {
            let mut args = vec![
                path(&output),
                config.distribution.clone(),
                config.suite.clone(),
                config.mirror.clone(),
                config.distro_packages()?.join(","),
            ];
            args.extend(config.distro.repositories.iter().map(|r| {
                format!("{}|{}|{}|{}|{}", r.name, r.url, r.suite, r.components, r.fingerprint)
            }));
            args
        },
    };
    let (program, script) = match target {
        Target::Kernel | Target::Mainline => {
            (PathBuf::from("bash"), Some(config.script("build-wsl-kernel.sh")))
        },
        Target::Wslg => (PathBuf::from("python3"), Some(config.script("build-wslg.py"))),
        Target::Wsl => {
            (crate::wsl::windows_executable("WindowsPowerShell/v1.0/powershell.exe"), None)
        },
        Target::Distro => (PathBuf::from("sudo"), Some(config.script("build-wsl-distro.sh"))),
    };
    let mut complete = Vec::new();
    if target == Target::Distro {
        complete.extend(["-n".into(), "bash".into()]);
    }
    if let Some(script) = script {
        complete.push(path(&script));
    }
    complete.extend(args);
    Ok(vec![Step::new(target.name(), program, complete, config.workspace.clone())])
}
