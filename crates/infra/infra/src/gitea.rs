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
    #[serde(default)]
    private: Option<bool>,
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
        || plan.repositories.iter().filter(|r| !r.mirror).any(|r| {
            !r.name.starts_with("bun-crate-") || r.private.unwrap_or(plan.private) != plan.private
        })
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
        "runnerKey":plan.runner_key,"repositories":plan.repositories.iter().map(|r| serde_json::json!({"name":r.name,"mirror":r.mirror,"upstream":r.upstream,"private":r.private.unwrap_or(plan.private)})).collect::<Vec<_>>(),
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
function sourceRefs(url){{
 const result=Bun.spawnSync(['git','ls-remote','--refs',url],{{timeout:12000}});
 if(result.exitCode!==0)bad('Gitea upstream ref query failed');
 return result.stdout.toString().trim().split('\n').filter(Boolean).map(line=>{{const [sha,ref]=line.trim().split(/\s+/);return {{ref,sha}};}}).sort((a,b)=>a.ref.localeCompare(b.ref));
}}
async function syncAndQualifyMirror(path,repo,privateState){{
 if(repo.upstream!=='https://github.com/aphrody-labs/bun-distribution.git')bad('Gitea mirror upstream is outside the approved source');
 const upstream=sourceRefs(repo.upstream);
 if(upstream.length!==1||upstream[0].ref!=='refs/heads/'+d.branch)bad('Gitea mirror upstream ref set is not the qualified default branch');
 const [status,current]=await req('GET',path,undefined,true);
 if(status===404){{
  await req('POST','/repos/migrate',{{clone_addr:repo.upstream,repo_name:repo.name,repo_owner:d.owner,service:'git',mirror:true,private:true,mirror_interval:'8h'}});
 }}else if(!current.mirror||current.original_url!==repo.upstream)bad('Existing Gitea mirror conflicts with upstream');
 const existing=(await req('GET',path))[1];if(!existing.private)await req('PATCH',path,{{private:true}});
 const before=(await req('GET',path))[1];if(before.has_actions!==d.actions)await req('PATCH',path,{{has_actions:d.actions}});
 await req('POST',path+'/mirror-sync');
 const branches=await req('GET',path+'/branches?limit=50&page=1');
 const tags=await req('GET',path+'/tags?limit=50&page=1');
 if(branches[1].length!==1||branches[1][0].name!==d.branch||branches[1][0].commit.id!==upstream[0].sha||tags[1].length!==0)bad('Gitea mirror refs diverge; repository remains private');
 const currentUpstream=sourceRefs(repo.upstream);if(currentUpstream.length!==upstream.length||currentUpstream[0].ref!==upstream[0].ref||currentUpstream[0].sha!==upstream[0].sha)bad('Gitea upstream moved during synchronization; repository remains private');
 const synced=(await req('GET',path))[1];if(!synced.mirror||synced.private!==true||synced.original_url!==repo.upstream||synced.default_branch!==d.branch||synced.has_actions!==d.actions)bad('Gitea private mirror verification failed');
 if(!privateState)await req('PATCH',path,{{private:false}});
 const published=(await req('GET',path))[1];if(!published.mirror||published.private!==privateState||published.original_url!==repo.upstream||published.default_branch!==d.branch||published.has_actions!==d.actions)bad('Gitea mirror visibility postcondition failed');
}}
const keyPath=d.runnerKey; await Bun.$`mkdir -p ${{keyPath.slice(0,keyPath.lastIndexOf('/'))}} && chmod 700 ${{keyPath.slice(0,keyPath.lastIndexOf('/'))}}`;
if(!(await Bun.file(keyPath).exists())){{const p=Bun.spawnSync(['ssh-keygen','-q','-t','ed25519','-N','','-C','bun-os-crate-runner','-f',keyPath],{{timeout:15000}});if(p.exitCode!==0)bad('VPS runner key generation failed');}}
else if(!(await Bun.file(keyPath+'.pub').exists())){{const p=Bun.spawnSync(['ssh-keygen','-y','-f',keyPath],{{timeout:15000}});if(p.exitCode!==0)bad('VPS runner public key repair failed');await Bun.write(keyPath+'.pub',p.stdout);}}
await Bun.$`chmod 600 ${{keyPath}}`;
const runner=(await Bun.file(keyPath+'.pub').text()).trim(); await ensureAccountKey(d.accountKey);
for(const repo of d.repositories){{
 const path='/repos/'+d.owner+'/'+repo.name; const targetPrivate=repo.private??d.private; const [status]=await req('GET',path,undefined,true);
 if(repo.mirror){{await syncAndQualifyMirror(path,repo,targetPrivate);continue;}}
 if(status===404)await req('POST','/user/repos',{{name:repo.name,private:targetPrivate,default_branch:d.branch,auto_init:false}});
 await req('PATCH',path,{{private:targetPrivate,has_actions:d.actions}});await ensureDeployKey(path,runner);
}}
console.log(JSON.stringify({{owner:d.owner,repositories:d.repositories.map(x=>x.name),actions:d.actions,account_key:'present',runner_key:'present'}}));
BUN
"#
    );
    let mut child = Command::new("ssh")
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
        .context("ssh vps indisponible")?;
    {
        use std::io::Write;
        child.stdin.take().context("stdin ssh absent")?.write_all(script.as_bytes())?;
    }
    let start = std::time::Instant::now();
    let output = loop {
        if let Some(status) = child.try_wait()? {
            let output = child.wait_with_output()?;
            if !status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let diagnostics: Vec<_> = stderr.lines().rev().take(8).collect();
                let diagnostic = diagnostics.into_iter().rev().collect::<Vec<_>>().join(" | ");
                bail!(
                    "provisionnement Gitea refusé ou échoué (code {}, diagnostic: {})",
                    status,
                    diagnostic
                );
            }
            break output;
        }
        if start.elapsed() > std::time::Duration::from_secs(120) {
            child.kill().context("arrêt ssh après délai dépassé")?;
            let _ = child.wait();
            bail!("provisionnement Gitea dépassant la limite de 120 secondes");
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    };
    let _: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("réponse Gitea distante invalide")?;
    report.applied = true;
    Ok(report)
}

fn valid_repo(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorCatalog {
    schema_version: u32,
    source_owner: String,
    target_owner: String,
    source_catalog_count: usize,
    api_url: String,
    credential_file: String,
    credential_variable: String,
    bun_executable: String,
    mirror_interval: String,
    visibility_policy: String,
    actions_enabled: bool,
    batch_limit: usize,
    batches: std::collections::BTreeMap<String, Vec<String>>,
    repositories: Vec<MirrorEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorEntry {
    name: String,
    #[serde(default)]
    target_owner: Option<String>,
    source_url: String,
    visibility: String,
    archived: bool,
    default_branch: String,
    admission: String,
    #[serde(default)]
    source_qualification: Option<SourceQualification>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceQualification {
    #[serde(rename = "sha")]
    head: String,
    refs: Vec<String>,
    #[serde(default, rename = "refShas")]
    ref_shas: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct MirrorReport {
    pub applied: bool,
    pub batch: String,
    pub owner: String,
    pub repositories: Vec<String>,
    pub visibility: &'static str,
    pub capacity_free_kib: Option<u64>,
}

/// Plan by default; `--apply` creates and verifies one explicitly admitted batch.
pub fn mirrors(root: &Path, apply: bool, batch: &str) -> Result<MirrorReport> {
    let config = root.join("tools/config/host/apps/vps/gitea/aphrody-labs-mirrors.json");
    let catalog: MirrorCatalog = serde_json::from_slice(
        &fs::read(&config).with_context(|| format!("lecture {}", config.display()))?,
    )?;
    if catalog.schema_version != 1
        || catalog.source_owner != "aphrody-labs"
        || catalog.target_owner != "aphrody-labs"
        || catalog.source_catalog_count != 239
        || catalog.repositories.len() != catalog.source_catalog_count
        || catalog.api_url != "http://127.0.0.1:29020/api/v1"
        || catalog.credential_file != "/home/ubuntu/.aphrody/config/gitea.env"
        || catalog.credential_variable != "GITEA_TOKEN_LABS"
        || catalog.bun_executable != "/home/ubuntu/.bun/bin/bun-1.4.4"
        || catalog.mirror_interval != "8h"
        || catalog.visibility_policy != "match-source"
        || !catalog.actions_enabled
        || catalog.batch_limit == 0
        || catalog.batch_limit > 5
        || !valid_repo(batch)
    {
        bail!("catalogue de miroirs hors contrat autorisé");
    }
    let names = catalog.batches.get(batch).context("lot de miroirs inconnu")?;
    if names.is_empty() || names.len() > catalog.batch_limit {
        bail!("taille de lot de miroirs invalide");
    }
    let mut entries = Vec::with_capacity(names.len());
    for name in names {
        let entry = catalog
            .repositories
            .iter()
            .find(|repo| &repo.name == name)
            .context("dépôt absent du catalogue")?;
        let target_owner = entry.target_owner.as_deref().unwrap_or(&catalog.target_owner);
        if !matches!(target_owner, "aphrody-labs" | "aphrody-dev")
            || (target_owner == "aphrody-dev" && entry.name != "bun-distribution")
            || (entry.name == "bun-distribution" && target_owner != "aphrody-dev")
            || entry.visibility != "public"
            || entry.archived
            || entry.admission != batch
            || entry.source_url != format!("https://github.com/aphrody-labs/{}.git", entry.name)
            || !valid_repo(&entry.name)
        {
            bail!("entrée de miroir non admissible");
        }
        let qualification =
            entry.source_qualification.as_ref().context("qualification de source absente")?;
        let default_ref = format!("refs/heads/{}", entry.default_branch);
        let valid_sha =
            |sha: &str| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit());
        let unique_refs: std::collections::BTreeSet<_> =
            qualification.refs.iter().map(String::as_str).collect();
        let invalid_ref = qualification.refs.iter().any(|reference| {
            !(reference.starts_with("refs/heads/") || reference.starts_with("refs/tags/"))
                || reference.contains("..")
                || reference.ends_with('/')
        });
        let incomplete_ref_shas = if qualification.ref_shas.is_empty() {
            qualification.refs != [default_ref.clone()]
        } else {
            qualification.ref_shas.len() != qualification.refs.len()
                || qualification.refs.iter().any(|reference| {
                    qualification.ref_shas.get(reference).is_none_or(|sha| !valid_sha(sha))
                })
                || qualification.ref_shas.get(&default_ref) != Some(&qualification.head)
        };
        if !valid_sha(&qualification.head)
            || !qualification.refs.contains(&default_ref)
            || unique_refs.len() != qualification.refs.len()
            || invalid_ref
            || incomplete_ref_shas
        {
            bail!("qualification de source invalide");
        }
        entries.push(entry);
    }
    let mut report = MirrorReport {
        applied: false,
        batch: batch.to_owned(),
        owner: catalog.target_owner.clone(),
        repositories: entries.iter().map(|entry| entry.name.clone()).collect(),
        visibility: "public",
        capacity_free_kib: None,
    };
    if !apply {
        return Ok(report);
    }

    let payload = serde_json::json!({
        "owner": catalog.target_owner,
        "apiUrl": catalog.api_url,
        "tokenFile": catalog.credential_file,
        "tokenVariable": catalog.credential_variable,
        "bunExecutable": catalog.bun_executable,
        "mirrorInterval": catalog.mirror_interval,
        "actions": catalog.actions_enabled,
        "repositories": entries.iter().map(|entry| serde_json::json!({
            "name": entry.name,
            "targetOwner": entry.target_owner.as_deref().unwrap_or(&catalog.target_owner),
            "sourceUrl": entry.source_url,
            "defaultBranch": entry.default_branch,
            "head": entry.source_qualification.as_ref().map(|q| q.head.as_str()),
            "refs": entry.source_qualification.as_ref().map(|q| &q.refs),
            "refShas": entry.source_qualification.as_ref().map(|q| &q.ref_shas),
        })).collect::<Vec<_>>(),
    });
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        serde_json::to_vec(&payload)?,
    );
    let script = format!(
        r#"set -eu
export APHRODY_GITEA_MIRRORS_B64='{encoded}'
timeout 180s /home/ubuntu/.bun/bin/bun-1.4.4 - <<'BUN'
const d=JSON.parse(Buffer.from(process.env.APHRODY_GITEA_MIRRORS_B64,'base64').toString());
const bad=(m)=>{{console.error(m);process.exit(2)}};
const dir='/home/ubuntu/.aphrody/config';
await Bun.$`mkdir -p ${{dir}} && chmod 700 ${{dir}}`;
const tokenFile=Bun.file(d.tokenFile);
if(!(await tokenFile.exists()))await Bun.write(d.tokenFile,'');
await Bun.$`chmod 600 ${{d.tokenFile}}`;
const [ds,fs]=await Promise.all([Bun.file(dir).stat(),tokenFile.stat()]);
if((ds.mode&0o777)!==0o700||(fs.mode&0o777)!==0o600)bad('Gitea secret store permissions invalid');
const parsed=Object.fromEntries((await tokenFile.text()).split(/\r?\n/).filter(x=>x&&!x.trimStart().startsWith('#')).map(x=>{{const i=x.indexOf('=');return i<0?null:[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}}).filter(Boolean));
let token=parsed[d.tokenVariable];
if(d.apiUrl!=='http://127.0.0.1:29020/api/v1'||d.owner!=='aphrody-labs'||d.tokenVariable!=='GITEA_TOKEN_LABS')bad('Gitea mirror scope rejected');
async function saveToken(value){{
 const lines=(await tokenFile.text()).split(/\r?\n/).filter(x=>!x.startsWith(d.tokenVariable+'='));
 const tmp=d.tokenFile+'.mirror.tmp';await Bun.write(tmp,lines.concat(d.tokenVariable+'='+value,'').join('\n'));
 await Bun.$`chmod 600 ${{tmp}} && mv ${{tmp}} ${{d.tokenFile}}`;
}}
function generateToken(){{
 const p=Bun.spawnSync(['docker','exec','--user','git','aphrody-gitea','gitea','admin','user','generate-access-token','--username','aphrody-dev','--token-name','aphrody-labs-mirror-v2','--scopes','read:user,read:organization,write:organization,write:repository','--raw'],{{timeout:15000}});
 if(p.exitCode!==0)bad('Gitea organization token unavailable');
 const value=p.stdout.toString().trim();if(!value)bad('Gitea organization token generation failed');return value;
}}
if(!token){{token=generateToken();await saveToken(token)}}
let identityResponse;try{{identityResponse=await fetch(d.apiUrl+'/user',{{headers:{{Authorization:'token '+token}},signal:AbortSignal.timeout(12000)}})}}catch{{bad('Gitea API unavailable')}}
if(identityResponse.status===403){{
 const ownerToken=parsed.GITEA_TOKEN_OWNER;if(!ownerToken)bad('Gitea token rotation needs the protected owner credential');
 token=generateToken();await saveToken(token);
 try{{identityResponse=await fetch(d.apiUrl+'/user',{{headers:{{Authorization:'token '+token}},signal:AbortSignal.timeout(12000)}})}}catch{{bad('Gitea API unavailable')}}
 if(!identityResponse.ok)bad('Gitea API request failed: GET /user ('+identityResponse.status+')');
}}
if(!identityResponse.ok)bad('Gitea API request failed: GET /user ('+identityResponse.status+')');
let identity;try{{identity=await identityResponse.json()}}catch{{bad('Gitea API response invalid')}}
if(identity.login!=='aphrody-dev')bad('Gitea token owner mismatch');
const ownerToken=parsed.GITEA_TOKEN_OWNER;
if(ownerToken){{
 const ownerAuth='Basic '+btoa('aphrody-dev:'+ownerToken);
 let oldTokens;try{{const response=await fetch(d.apiUrl+'/users/aphrody-dev/tokens?limit=50&page=1',{{headers:{{Authorization:ownerAuth}},signal:AbortSignal.timeout(12000)}});if(!response.ok)bad('Gitea API request failed: GET /users/aphrody-dev/tokens ('+response.status+')');oldTokens=await response.json()}}catch(e){{if(String(e).includes('Gitea API request failed'))throw e;bad('Gitea token inventory unavailable')}}
 for(const old of oldTokens.filter(item=>item.name==='aphrody-labs-mirror')){{
  let response;try{{response=await fetch(d.apiUrl+'/users/aphrody-dev/tokens/'+old.id,{{method:'DELETE',headers:{{Authorization:ownerAuth}},signal:AbortSignal.timeout(12000)}})}}catch{{bad('Gitea token revocation unavailable')}}
  if(!response.ok&&response.status!==404)bad('Gitea API request failed: DELETE /users/aphrody-dev/tokens/'+old.id+' ('+response.status+')');
 }}
}}
async function req(method,path,payload,missing=false){{
 let r;try{{r=await fetch(d.apiUrl+path,{{method,headers:{{Authorization:'token '+token,'Content-Type':'application/json'}},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(12000)}})}}catch{{bad('Gitea API unavailable')}}
 if(missing&&r.status===404)return [404,null];
 if(!r.ok)bad('Gitea API request failed: '+method+' '+path+' ('+r.status+')');
 if(r.status===204)return [r.status,null];try{{return [r.status,await r.json()]}}catch{{bad('Gitea API response invalid')}}
}}
function gitRefs(url,authToken){{
 const env=authToken?{{...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraheader',GIT_CONFIG_VALUE_0:'Authorization: token '+authToken}}:process.env;
 const result=Bun.spawnSync(['git','ls-remote','--refs',url],{{timeout:12000,env}});
 if(result.exitCode!==0)bad('Gitea mirror ref query failed');
 const refs={{}};for(const line of result.stdout.toString().trim().split(String.fromCharCode(10)).filter(Boolean)){{const [sha,ref]=line.trim().split(/\s+/);refs[ref]=sha;}}
 return refs;
}}
function sameRefs(left,right){{const a=Object.keys(left).sort(),b=Object.keys(right).sort();return a.length===b.length&&a.every((key,index)=>key===b[index]&&left[key]===right[key]);}}
const org=await req('GET','/orgs/aphrody-labs');if(org[1].username!=='aphrody-labs')bad('Gitea organization missing or unauthorized');
if(org[1].visibility!=='public')await req('PATCH','/orgs/aphrody-labs',{{visibility:'public'}});
if((await req('GET','/orgs/aphrody-labs'))[1].visibility!=='public')bad('Gitea organization is not publicly readable');
const free=Number((await Bun.$`df -Pk /home/ubuntu/apps/gitea/data | tail -n 1`.text()).trim().split(/\s+/)[3]);
if(!Number.isFinite(free)||free<8*1024*1024)bad('Gitea storage admission below 8 GiB');
for(const repo of d.repositories){{
const owner=repo.targetOwner||d.owner;const path='/repos/'+owner+'/'+repo.name;const [status,current]=await req('GET',path,undefined,true);
 const expected=Object.keys(repo.refShas||{{}}).length?repo.refShas:{{['refs/heads/'+repo.defaultBranch]:repo.head}};
 if(!sameRefs(gitRefs(repo.sourceUrl),expected))bad('GitHub source ref set moved or incomplete: '+repo.name);
 if(status===404){{
  await req('POST','/repos/migrate',{{clone_addr:repo.sourceUrl,repo_name:repo.name,repo_owner:owner,service:'git',mirror:true,private:true,mirror_interval:d.mirrorInterval}});
 }}else if(!current.mirror||current.original_url!==repo.sourceUrl)bad('Existing Gitea repository conflicts with source policy: '+repo.name);
 else if(!current.private)await req('PATCH',path,{{private:true}});
 const before=(await req('GET',path))[1];if(before.has_actions!==true)await req('PATCH',path,{{has_actions:true}});
 await req('POST',path+'/mirror-sync');
 const info=await req('GET',path);if(!info[1].mirror||info[1].private!==true||info[1].original_url!==repo.sourceUrl||info[1].default_branch!==repo.defaultBranch||info[1].has_actions!==true)bad('Gitea mirror policy verification failed: '+repo.name);
 const targetUrl='http://127.0.0.1:29020/'+owner+'/'+repo.name+'.git';
 const sourceNow=gitRefs(repo.sourceUrl),targetNow=gitRefs(targetUrl,token);
 if(!sameRefs(sourceNow,expected)||!sameRefs(targetNow,expected))bad('Gitea mirror refs diverge; repository remains private: '+repo.name);
 await req('PATCH',path,{{private:false}});
 const published=await req('GET',path);if(!published[1].mirror||published[1].private!==false||published[1].original_url!==repo.sourceUrl||published[1].default_branch!==repo.defaultBranch||published[1].has_actions!==true)bad('Gitea public mirror verification failed: '+repo.name);
}}
console.log(JSON.stringify({{owner:d.owner,repositories:d.repositories.map(x=>x.name),visibility:'public',freeKiB:free,verified:true}}));
BUN
"#
    );
    let mut child = Command::new("ssh")
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
        .context("ssh vps indisponible")?;
    use std::io::Write;
    child.stdin.take().context("stdin ssh absent")?.write_all(script.as_bytes())?;
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            let output = child.wait_with_output()?;
            if !status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let diagnostic = stderr
                    .lines()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join(" | ");
                bail!(
                    "synchronisation Gitea refusée ou échouée (code {}, diagnostic: {})",
                    status,
                    diagnostic
                );
            }
            let remote: serde_json::Value = serde_json::from_slice(&output.stdout)
                .context("réponse Gitea distante invalide")?;
            report.capacity_free_kib = remote.get("freeKiB").and_then(serde_json::Value::as_u64);
            report.applied = true;
            return Ok(report);
        }
        if start.elapsed() > std::time::Duration::from_secs(210) {
            child.kill().context("arrêt ssh après délai dépassé")?;
            let _ = child.wait();
            bail!("synchronisation Gitea dépassant la limite de 210 secondes");
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}
