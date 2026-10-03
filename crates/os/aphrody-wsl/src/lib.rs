// SPDX-License-Identifier: Apache-2.0
//! Build workbench for the upstream WSL platform and the Aphrody OS guest.
//! Compilers remain owned by upstream; this library owns recipes and evidence.
mod recipes;
mod runner;
pub mod cli;

use std::{fs, path::{Path, PathBuf}, process::Command};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub use recipes::{Step, Target, plan};
pub use runner::{BuildReport, build};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Source { pub name: String, pub url: String, pub revision: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Config {
    pub source_root: PathBuf,
    pub output_root: PathBuf,
    pub workspace: PathBuf,
    pub jobs: usize,
    pub timeout_seconds: u64,
    pub distribution: String,
    pub suite: String,
    pub mirror: String,
    pub sources: Vec<Source>,
}
impl Config {
    pub fn read(path: &Path) -> Result<Self> {
        // <workspace>/config/os/wsl-build.json: the checkout is three levels above the file.
        let absolute = path.canonicalize()?;
        let workspace = absolute.ancestors().nth(3).ok_or_else(|| Error::Invalid("config must live under <workspace>/config/os".into()))?;
        Self::parse(&fs::read(path)?, workspace)
    }
    /// Parses a configuration whose roots may use `${workspace}`, `${home}` and `${data}`.
    pub fn parse(bytes: &[u8], workspace: &Path) -> Result<Self> {
        let mut config: Self = serde_json::from_slice(bytes)?;
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
        let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
            .or_else(|| home.as_ref().map(|home| home.join(".local/share")));
        for root in [&mut config.source_root, &mut config.output_root, &mut config.workspace] {
            let mut text = root.to_string_lossy().replace("${workspace}", &workspace.to_string_lossy());
            for (token, value) in [("${home}", &home), ("${data}", &data)] {
                if text.contains(token) {
                    let value = value.as_ref().ok_or_else(|| Error::Invalid(format!("{token} is not available on this host")))?;
                    text = text.replace(token, &value.to_string_lossy());
                }
            }
            *root = PathBuf::from(text);
        }
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        for path in [&self.source_root, &self.output_root, &self.workspace] {
            if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                return Err(Error::Invalid("build roots must be absolute without ..".into()));
            }
        }
        if self.output_root == self.source_root || self.output_root == self.workspace || self.output_root.starts_with(&self.workspace) {
            return Err(Error::Invalid("outputs must live outside the Aphrody checkout and source root itself".into()));
        }
        if !(1..=64).contains(&self.jobs) || !(1..=86400).contains(&self.timeout_seconds) {
            return Err(Error::Invalid("jobs must be 1..64 and timeoutSeconds 1..86400".into()));
        }
        for value in [&self.distribution, &self.suite] {
            if value.is_empty() || value.len()>64 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)) {
                return Err(Error::Invalid("distribution and suite must be simple nonempty names".into()));
            }
        }
        if !self.mirror.starts_with("https://") { return Err(Error::Invalid("rootfs mirror must use HTTPS".into())); }
        let expected = ["WSL", "wslg", "WSL2-Linux-Kernel", "terminal"];
        if self.sources.len()!=expected.len() || expected.iter().any(|name| self.sources.iter().filter(|s|s.name==*name).count()!=1) {
            return Err(Error::Invalid("exactly the four upstream source owners are required".into()));
        }
        for source in &self.sources {
            if source.revision.len()!=40 || !source.revision.bytes().all(|b|b.is_ascii_hexdigit()) || !source.url.starts_with("https://") {
                return Err(Error::Invalid("sources need an HTTPS URL and full 40-digit Git revision".into()));
            }
        }
        Ok(())
    }
    pub fn script(&self, name: &str) -> PathBuf { self.workspace.join("scripts/build/os").join(name) }
}

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct SourceState { pub name:String, pub revision:String, pub expected_revision:String, pub clean:bool, pub matches:bool }

pub fn sources(config:&Config) -> Result<Vec<SourceState>> {
    config.validate()?;
    config.sources.iter().map(|source| {
        let root=config.source_root.join(&source.name);
        let revision=git(&root, &["rev-parse","HEAD"])?;
        let clean=git(&root,&["status","--porcelain"] )?.is_empty();
        Ok(SourceState{name:source.name.clone(), matches:revision==source.revision, revision,expected_revision:source.revision.clone(),clean})
    }).collect()
}
fn git(path:&Path,args:&[&str])->Result<String> {
    let output=Command::new("git").arg("-C").arg(path).args(args).output()?;
    if !output.status.success() { return Err(Error::Invalid(format!("git {} failed at {}",args.join(" "),path.display()))); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Artifact {pub path:PathBuf,pub bytes:u64,pub sha256:String}
pub fn artifact(path:&Path) -> Result<Artifact> {
    use std::io::Read;
    let mut file=fs::File::open(path)?;
    let bytes=file.metadata()?.len();
    if bytes==0 {return Err(Error::Invalid(format!("empty artifact: {}",path.display())));}
    let mut hasher=Sha256::new();
    let mut buffer=vec![0;1024*1024];
    loop { let read=file.read(&mut buffer)?;if read==0{break;} hasher.update(&buffer[..read]); }
    Ok(Artifact{path:path.into(),bytes,sha256:hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()})
}

pub fn expected_artifacts(config:&Config,target:Target)->Vec<PathBuf> {
    let root=&config.output_root;
    match target {
        Target::Kernel=>vec![root.join("kernel/arch/x86/boot/bzImage"),root.join("kernel/modules.vhdx")],
        Target::Wslg=>vec![root.join("wslg/system_x64.vhd")],
        Target::Wsl=>vec![root.join("wsl/artifacts.json")],
        Target::Distro=>vec![root.join(format!("distro/{}.wsl",config.distribution)),root.join("distro/packages.txt")],
    }
}

#[derive(Debug, Serialize)]
pub struct Dependency {pub command:String,pub available:bool}
pub fn doctor(config:&Config)->Result<serde_json::Value> {
    let dependencies=["git","make","gcc","flex","bison","pahole","bc","cpio","rsync","qemu-img","mke2fs","podman","go","debootstrap","cargo","wslpath"]
        .into_iter().map(|name|Dependency{command:name.into(),available:find_executable(name).is_some()}).collect::<Vec<_>>();
    let source_state=sources(config);
    Ok(serde_json::json!({"dependencies":dependencies,"sources":source_state.as_ref().ok(),"sourceError":source_state.err().map(|e|e.to_string()),"outputRoot":config.output_root}))
}
pub(crate) fn find_executable(name:&str)->Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path|std::env::split_paths(&path).map(|dir|dir.join(name)).find(|p|p.is_file()))
}

pub fn import(config:&Config,install_dir:&Path)->Result<()> {
    config.validate()?;
    let image=config.output_root.join(format!("distro/{}.wsl",config.distribution));
    artifact(&image)?;
    let windows_path=|path:&Path|->Result<String>{
        if cfg!(windows){return Ok(path.to_string_lossy().into_owned());}
        let out=Command::new("wslpath").arg("-w").arg(path).output()?;
        if !out.status.success(){return Err(Error::Invalid("wslpath failed".into()));}
        Ok(String::from_utf8_lossy(&out.stdout).trim().into())
    };
    let executable=PathBuf::from("wsl.exe"); // resolved through PATH: WSL interop appends the Windows directories
    let status=Command::new(executable).args(["--import",&config.distribution,&windows_path(install_dir)?,&windows_path(&image)?,"--version","2"]).status()?;
    if !status.success(){return Err(Error::Invalid("WSL import failed; existing distributions are never unregistered".into()));}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config()->Config {Config::parse(include_bytes!("../../../../config/os/wsl-build.json"), Path::new("/aphrody-workspace")).unwrap()}
    #[test] fn rejects_unsafe_roots_and_names(){let mut c=config();c.output_root=c.workspace.clone();assert!(c.validate().is_err());c=config();c.distribution="../Ubuntu".into();assert!(c.validate().is_err());c=config();c.sources[0].revision="main".into();assert!(c.validate().is_err());}
    #[test] fn hashes_nonempty_artifacts_and_rejects_empty(){let dir=tempfile::tempdir().unwrap();let p=dir.path().join("artifact");fs::write(&p,b"abc").unwrap();assert_eq!(artifact(&p).unwrap().sha256,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");fs::write(p.clone(),[]).unwrap();assert!(artifact(&p).is_err());}
}
