//! First-party Gitea provisioning for the Bun OS workspace.
use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

#[derive(Debug, Deserialize)]
struct Plan {
    owner: String,
    branch: String,
    private: bool,
    actions: bool,
    #[serde(rename = "apiUrl")]
    api_url: String,
    #[serde(rename = "tokenFile")]
    token_file: String,
    #[serde(rename = "tokenVariable")]
    token_variable: String,
    #[serde(rename = "bunExecutable")]
    bun_executable: String,
    #[serde(rename = "runnerKey")]
    runner_key: String,
    repositories: Vec<Repository>,
}
#[derive(Debug, Deserialize)]
struct Repository {
    name: String,
    mirror: bool,
    upstream: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub applied: bool,
    pub owner: String,
    pub repositories: Vec<String>,
    pub actions: bool,
    pub runner_key: String,
}

/// Plan by default; apply uses the VPS-local protected credential and runner key.
pub fn provision(root: &Path, apply: bool) -> Result<Report> {
    let config = root.join("tools/config/host/apps/vps/gitea/bun-os-repositories.json");
    let plan: Plan = serde_json::from_slice(
        &fs::read(&config).with_context(|| format!("lecture {}", config.display()))?,
    )?;
    if plan.repositories.is_empty() || plan.repositories.iter().any(|r| !valid_repo(&r.name)) {
        bail!("liste de dépôts Gitea invalide");
    }
    if plan.owner != "aphrody-dev"
        || plan.branch != "os"
        || plan.api_url != "http://127.0.0.1:29020/api/v1"
        || plan.token_file != "/home/ubuntu/.aphrody/config/gitea.env"
        || plan.token_variable != "GITEA_TOKEN_OWNER"
        || plan.bun_executable != "/home/ubuntu/.bun/bin/bun-1.4.4"
        || plan.runner_key != "/home/ubuntu/.aphrody/secrets/gitea/bun-os-crate-runner"
        || plan.repositories.iter().filter(|r| r.mirror).any(|r| {
            r.name != "bun-distribution"
                || r.upstream.as_deref()
                    != Some("https://github.com/aphrody-labs/bun-distribution.git")
        })
        || plan.repositories.iter().filter(|r| !r.mirror).any(|r| !r.name.starts_with("bun-crate-"))
    {
        bail!("plan Gitea hors périmètre autorisé");
    }
    let mut report = Report {
        applied: false,
        owner: plan.owner.clone(),
        repositories: plan.repositories.iter().map(|r| r.name.clone()).collect(),
        actions: plan.actions,
        runner_key: "VPS protected deploy key".into(),
    };
    if !apply {
        return Ok(report);
    }
    let profile = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .context("profil utilisateur absent")?;
    let public_key_path = Path::new(&profile).join(".ssh/id_ed25519_aphrody.pub");
    let account_key = fs::read_to_string(&public_key_path)
        .with_context(|| format!("clé publique absente: {}", public_key_path.display()))?;
    if !account_key.starts_with("ssh-ed25519 ") {
        bail!("clé publique workstation invalide");
    }
    let data = serde_json::json!({
        "owner":plan.owner,"branch":plan.branch,"private":plan.private,"actions":plan.actions,
        "apiUrl":plan.api_url,"tokenFile":plan.token_file,"tokenVariable":plan.token_variable,"bunExecutable":plan.bun_executable,
        "runnerKey":plan.runner_key,"repositories":plan.repositories.iter().map(|r| serde_json::json!({"name":r.name,"mirror":r.mirror,"upstream":r.upstream})).collect::<Vec<_>>(),
        "accountKey":account_key.trim()
    });
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        serde_json::to_vec(&data)?,
    );
    let script = format!(
        r#"set -eu
export APHRODY_GITEA_PLAN_B64='{encoded}'
timeout 90s /home/ubuntu/.bun/bin/bun-1.4.4 - <<'BUN'
const d = JSON.parse(Buffer.from(process.env.APHRODY_GITEA_PLAN_B64, 'base64').toString());
const bad = (message) => {{ console.error(message); process.exit(2); }};
const tokenFile = Bun.file(d.tokenFile);
const tokenDir = Bun.file('/home/ubuntu/.aphrody/config');
await Bun.$`mkdir -p /home/ubuntu/.aphrody/config && chmod 700 /home/ubuntu/.aphrody/config`;
if(!(await tokenFile.exists()))await Bun.write(d.tokenFile,'');
await Bun.$`chmod 600 /home/ubuntu/.aphrody/config/gitea.env`;
const [fileStat, dirStat] = await Promise.all([tokenFile.stat(), tokenDir.stat()]);
if ((fileStat.mode & 0o777) !== 0o600 || (dirStat.mode & 0o777) !== 0o700) bad('Gitea credential store permissions invalid');
const parsed = Object.fromEntries((await tokenFile.text()).split(/\r?\n/).filter(x => x && !x.trimStart().startsWith('#')).map(x => {{ const i=x.indexOf('='); return i<0?null:[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]; }}).filter(Boolean));
let token = parsed[d.tokenVariable];
if(!token){{
 const issued=Bun.spawnSync(['docker','exec','--user','git','aphrody-gitea','gitea','admin','user','generate-access-token','--username',d.owner,'--token-name','bun-os-infra','--scopes','write:user,write:repository','--raw'],{{timeout:15000}});
 if(issued.exitCode!==0)bad('Gitea token missing and official admin token generation unavailable');
 token=issued.stdout.toString().trim(); if(!token)bad('Gitea admin returned no token');
 const updated=(await tokenFile.text()).split(/\r?\n/).filter(x=>!x.startsWith(d.tokenVariable+'=')).concat(d.tokenVariable+'='+token,'').join('\n');
 const temp=d.tokenFile+'.bun-os.tmp'; await Bun.write(temp,updated); await Bun.$`chmod 600 ${{temp}} && mv ${{temp}} ${{d.tokenFile}}`;
}}
const base = d.apiUrl;
async function req(method,path,payload,missing=false) {{
 const response=await fetch(base+path,{{method,headers:{{Authorization:'token '+token,'Content-Type':'application/json'}},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(12000)}});
 if(missing&&response.status===404)return [404,null];
 if(!response.ok)bad('Gitea API request failed: '+response.status);
 return [response.status,response.status===204?null:await response.json()];
}}
async function ensureAccountKey(key) {{
 const [,items]=await req('GET','/user/keys'); if(items.some(x=>x.key.trim()===key))return;
 await req('POST','/user/keys',{{title:'aphrody workstation Bun OS',key}});
}}
async function ensureDeployKey(path,key) {{
 const [,items]=await req('GET',path+'/keys'); const found=items.find(x=>x.key.trim()===key);
 if(!found){{await req('POST',path+'/keys',{{title:'bun-os VPS runner',key,read_only:false}});return;}}
 if(found.read_only)await req('PATCH',path+'/keys/'+found.id,{{read_only:false}});
}}
const identity=await req('GET','/user'); if(identity[1].login!==d.owner)bad('Gitea token owner mismatch');
const keyPath=d.runnerKey; await Bun.$`mkdir -p ${{keyPath.slice(0,keyPath.lastIndexOf('/'))}} && chmod 700 ${{keyPath.slice(0,keyPath.lastIndexOf('/'))}}`;
if(!(await Bun.file(keyPath).exists())){{const p=Bun.spawnSync(['ssh-keygen','-q','-t','ed25519','-N','','-C','bun-os-crate-runner','-f',keyPath],{{timeout:15000}});if(p.exitCode!==0)bad('VPS runner key generation failed');}}
else if(!(await Bun.file(keyPath+'.pub').exists())){{const p=Bun.spawnSync(['ssh-keygen','-y','-f',keyPath],{{timeout:15000}});if(p.exitCode!==0)bad('VPS runner public key repair failed');await Bun.write(keyPath+'.pub',p.stdout);}}
await Bun.$`chmod 600 ${{keyPath}}`;
const runner=(await Bun.file(keyPath+'.pub').text()).trim(); await ensureAccountKey(d.accountKey);
for(const repo of d.repositories){{
 const path='/repos/'+d.owner+'/'+repo.name; const [status]=await req('GET',path,undefined,true);
 if(status===404){{if(repo.mirror){{await req('POST','/repos/migrate',{{clone_addr:repo.upstream,repo_name:repo.name,repo_owner:d.owner,service:'git',mirror:true,private:d.private,mirror_interval:'8h'}});}}else{{await req('POST','/user/repos',{{name:repo.name,private:d.private,default_branch:d.branch,auto_init:false}});}}}}
 await req('PATCH',path,{{private:d.private,has_actions:d.actions}});
 if(repo.mirror)await req('POST',path+'/mirror-sync'); else await ensureDeployKey(path,runner);
}}
console.log(JSON.stringify({{owner:d.owner,repositories:d.repositories.map(x=>x.name),actions:d.actions,account_key:'present',runner_key:'present'}}));
BUN
"#
    );
    let output = Command::new("ssh")
        .no_window()
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            "-o",
            "ServerAliveInterval=5",
            "-o",
            "ServerAliveCountMax=2",
            "vps",
            "bash",
            "-s",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().expect("stdin piped").write_all(script.as_bytes())?;
            child.wait_with_output()
        })
        .context("ssh vps indisponible")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let diagnostics: Vec<_> = stderr.lines().rev().take(8).collect();
        let diagnostic = diagnostics.into_iter().rev().collect::<Vec<_>>().join(" | ");
        bail!(
            "provisionnement Gitea refusé ou échoué (code {}, diagnostic: {})",
            output.status,
            diagnostic
        );
    }
    let _: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("réponse Gitea distante invalide")?;
    report.applied = true;
    Ok(report)
}

fn valid_repo(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
