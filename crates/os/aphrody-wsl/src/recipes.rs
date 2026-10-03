// SPDX-License-Identifier: Apache-2.0
use std::{collections::BTreeMap,path::PathBuf};
use serde::{Serialize,Deserialize};
use crate::{Config,Result};

#[derive(Debug,Clone,Copy,PartialEq,Eq,clap::ValueEnum,Serialize,Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Target { Kernel, Wslg, Wsl, Distro }
impl Target {
    pub fn name(self)->&'static str {match self{Self::Kernel=>"kernel",Self::Wslg=>"wslg",Self::Wsl=>"wsl",Self::Distro=>"distro"}}
}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Step {pub name:String,pub program:PathBuf,pub args:Vec<String>,pub cwd:PathBuf,pub env:BTreeMap<String,String>}
impl Step {
    pub fn new(name:&str,program:impl Into<PathBuf>,args:Vec<String>,cwd:PathBuf)->Self { Self{name:name.into(),program:program.into(),args,cwd,env:BTreeMap::new()} }
}
pub fn plan(config:&Config,target:Target)->Result<Vec<Step>> {
    config.validate()?;
    let path=|p:&std::path::Path|p.to_string_lossy().into_owned();
    let output=config.output_root.join(target.name());
    let args=match target {
        Target::Kernel=>vec![path(&config.source_root.join("WSL2-Linux-Kernel")),path(&output),config.jobs.to_string()],
        Target::Wslg=>vec!["--source-root".into(),path(&config.source_root),"--output".into(),path(&output)],
        Target::Wsl=>vec!["-NoProfile".into(),"-NonInteractive".into(),"-ExecutionPolicy".into(),"Bypass".into(),"-File".into(),"@WINDOWS_SCRIPT@".into(),"-Source".into(),"@WINDOWS_SOURCE@".into(),"-OutputRoot".into(),"@WINDOWS_OUTPUT@".into()],
        Target::Distro=>vec![path(&output),config.distribution.clone(),config.suite.clone(),config.mirror.clone(),path(&config.workspace)],
    };
    let (program,script)=match target {
        Target::Kernel=>(PathBuf::from("bash"),Some(config.script("build-wsl-kernel.sh"))),
        Target::Wslg=>(PathBuf::from("python3"),Some(config.script("build-wslg.py"))),
        Target::Wsl=>(crate::windows_executable("WindowsPowerShell/v1.0/powershell.exe"),None),
        Target::Distro=>(PathBuf::from("sudo"),Some(config.script("build-wsl-distro.sh"))),
    };
    let mut complete=Vec::new();
    if target==Target::Distro {complete.extend(["-n".into(),"bash".into()]);}
    if let Some(script)=script {complete.push(path(&script));}
    complete.extend(args);
    Ok(vec![Step::new(target.name(),program,complete,config.workspace.clone())])
}
