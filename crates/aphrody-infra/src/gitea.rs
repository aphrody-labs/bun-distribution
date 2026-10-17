//! First-party Gitea provisioning for the Bun OS workspace.
use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

#[derive(Debug, Deserialize, Serialize)]
pub struct Report {
    pub applied: bool,
    pub owner: String,
    pub repositories: Vec<String>,
    pub actions: bool,
    pub runner_key: String,
}

/// Shared Bun owner: local plan by default; apply admits one named private source repository.
/// Protected VPS credentials are never returned; the dedicated mirror owner remains separate.
pub fn provision(root: &Path, apply: bool, repository: Option<&str>) -> Result<Report> {
    let client = include_str!("../../../scripts/aphrody/tools/infra/gitea-provision.ts");
    let remote_program =
        include_str!("../../../scripts/aphrody/tools/infra/gitea-provision-remote.ts");
    let mut command = Command::new("bun").no_window();
    command
        .current_dir(root)
        .args(["-e", client, "--", "--root"])
        .arg(root)
        .arg("--json")
        .env("APHRODY_GITEA_REMOTE_PROGRAM", remote_program)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if apply {
        command.arg("--apply");
    }
    if let Some(repository) = repository {
        command.args(["--repository", repository]);
    }
    let mut child = command
        .spawn()
        .context("propriétaire Bun Infra indisponible")?;
    let start = std::time::Instant::now();
    let output = loop {
        if let Some(status) = child.try_wait()? {
            let output = child.wait_with_output()?;
            if !status.success() {
                bail!("provisionnement Gitea refusé ou échoué; diagnostics de credentials masqués");
            }
            break output;
        }
        if start.elapsed() > std::time::Duration::from_secs(120) {
            child
                .kill()
                .context("arrêt propriétaire Bun après délai dépassé")?;
            let _ = child.wait();
            bail!("provisionnement Gitea dépassant la limite de 120 secondes");
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    };
    serde_json::from_slice(&output.stdout)
        .context("réponse publique du propriétaire Gitea invalide")
}

fn valid_repo(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorCatalog {
    schema_version: u32,
    source_owner: String,
    target_owner: String,
    source_catalog_count: usize,
    api_url: String,
    public_base_url: String,
    credential_file: String,
    credential_variable: String,
    source_credential_file: String,
    source_credential_user: String,
    repository_root: String,
    bun_executable: String,
    mirror_interval: String,
    visibility_policy: String,
    actions_enabled: bool,
    batch_limit: usize,
    #[serde(rename = "nativeStorage")]
    native_storage: NativeStorage,
    batches: std::collections::BTreeMap<String, Vec<String>>,
    repositories: Vec<MirrorEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeStorage {
    owner: String,
    repository: String,
    volume_name: String,
    physical_path: String,
    host_mount_path: String,
    container_path: String,
    repository_size_kib: u64,
    root_reserve_kib: u64,
    data_reserve_kib: u64,
    owner_uid: u32,
    owner_gid: u32,
    directory_mode: String,
    mount_unit: String,
    lfs_requirement: String,
    runner_requirement: String,
    runner_scope: String,
    instance_runner_status: String,
    runner_job_qualification: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorEntry {
    name: String,
    #[serde(default)]
    target_owner: Option<String>,
    source_url: String,
    #[serde(default)]
    size_kib: Option<u64>,
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
    head: Option<String>,
    refs: Vec<String>,
    #[serde(default, rename = "refShas")]
    ref_shas: std::collections::BTreeMap<String, String>,
    #[serde(default, rename = "lfsApplicable")]
    lfs_applicable: bool,
    #[serde(default)]
    lfs_status: Option<String>,
    #[serde(default)]
    runner_status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MirrorReport {
    pub applied: bool,
    pub batch: String,
    pub owner: String,
    pub repositories: Vec<String>,
    pub visibility: &'static str,
    pub capacity_free_kib: Option<u64>,
    pub organization_runner_available: Option<bool>,
    pub runner_job_qualification: &'static str,
}

/// Plan by default; `--apply` creates and verifies one explicitly admitted batch.
pub fn mirrors(root: &Path, apply: bool, batch: &str) -> Result<MirrorReport> {
    let config = root.join("infra/config/host/apps/vps/gitea/aphrody-labs-mirrors.json");
    let catalog: MirrorCatalog = serde_json::from_slice(
        &fs::read(&config).with_context(|| format!("lecture {}", config.display()))?,
    )?;
    if catalog.schema_version != 1
        || catalog.source_owner != "aphrody-labs"
        || catalog.target_owner != "aphrody-labs"
        || catalog.source_catalog_count != 239
        || catalog.repositories.len() != catalog.source_catalog_count
        || catalog.api_url != "http://127.0.0.1:29020/api/v1"
        || catalog.public_base_url != "https://source.aphrody.app"
        || catalog.credential_file != "/home/ubuntu/.aphrody/config/gitea.env"
        || catalog.credential_variable != "GITEA_TOKEN_LABS"
        || catalog.source_credential_file != "/home/ubuntu/.config/gh/hosts.yml"
        || catalog.source_credential_user != "aphrody-code"
        || catalog.repository_root != "/data/git/repositories"
        || catalog.bun_executable != "/home/ubuntu/.bun/bin/bun-1.4.4"
        || catalog.mirror_interval != "8h"
        || catalog.visibility_policy != "match-source"
        || !catalog.actions_enabled
        || catalog.batch_limit == 0
        || catalog.batch_limit > 5
        || catalog.native_storage.owner != "aphrody-labs-native"
        || catalog.native_storage.repository != "chromium"
        || catalog.native_storage.volume_name != "aphrody-gitea-native-storage"
        || catalog.native_storage.physical_path != "/home/ubuntu/forge-storage/aphrody-labs-native"
        || catalog.native_storage.host_mount_path != "/home/ubuntu/build/apps/gitea/native-storage"
        || catalog.native_storage.container_path != "/data/git/repositories/aphrody-labs-native"
        || catalog.native_storage.repository_size_kib != 57_002_469
        || catalog.native_storage.root_reserve_kib != 20 * 1024 * 1024
        || catalog.native_storage.data_reserve_kib != 8 * 1024 * 1024
        || catalog.native_storage.owner_uid != 1000
        || catalog.native_storage.owner_gid != 1000
        || catalog.native_storage.directory_mode != "0750"
        || catalog.native_storage.mount_unit
            != r"home-ubuntu-build-apps-gitea-native\x2dstorage.mount"
        || catalog.native_storage.lfs_requirement != "qualified-before-apply"
        || catalog.native_storage.runner_requirement != "org-runner-active-or-idle-after-clone"
        || catalog.native_storage.runner_scope != "organization-only"
        || catalog.native_storage.instance_runner_status != "unavailable-with-scoped-token"
        || catalog.native_storage.runner_job_qualification != "not-run"
        || !valid_repo(batch)
    {
        bail!("catalogue de miroirs hors contrat autorisé");
    }
    let names = catalog
        .batches
        .get(batch)
        .context("lot de miroirs inconnu")?;
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
        let target_owner = entry
            .target_owner
            .as_deref()
            .unwrap_or(&catalog.target_owner);
        if !matches!(
            target_owner,
            "aphrody-labs" | "aphrody-dev" | "aphrody-labs-native"
        ) || (target_owner == "aphrody-dev" && entry.name != "bun-distribution")
            || (entry.name == "bun-distribution" && target_owner != "aphrody-dev")
            || (target_owner == "aphrody-labs-native"
                && (entry.name != catalog.native_storage.repository
                    || entry.size_kib != Some(catalog.native_storage.repository_size_kib)
                    || !entry.source_qualification.as_ref().is_some_and(|q| {
                        matches!(
                            q.lfs_status.as_deref(),
                            Some("unqualified" | "not-applicable" | "verified")
                        )
                    })))
            || (entry.name == catalog.native_storage.repository
                && target_owner != catalog.native_storage.owner)
            || !matches!(entry.visibility.as_str(), "public" | "private")
            || entry.admission != batch
            || entry.source_url != format!("https://github.com/aphrody-labs/{}.git", entry.name)
            || !valid_repo(&entry.name)
        {
            bail!("entrée de miroir non admissible");
        }
        let qualification = entry
            .source_qualification
            .as_ref()
            .context("qualification de source absente")?;
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
            !qualification.refs.is_empty() && qualification.refs != [default_ref.clone()]
        } else {
            qualification.ref_shas.len() != qualification.refs.len()
                || qualification.refs.iter().any(|reference| {
                    qualification
                        .ref_shas
                        .get(reference)
                        .is_none_or(|sha| !valid_sha(sha))
                })
                || qualification.ref_shas.get(&default_ref) != qualification.head.as_ref()
        };
        let empty_source = qualification.refs.is_empty()
            && qualification.ref_shas.is_empty()
            && qualification.head.is_none();
        if (!empty_source
            && (!qualification.head.as_deref().is_some_and(valid_sha)
                || !qualification.refs.contains(&default_ref)))
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
        visibility: "match-source",
        capacity_free_kib: None,
        organization_runner_available: None,
        runner_job_qualification: "not-run",
    };
    if !apply {
        return Ok(report);
    }

    let payload = serde_json::json!({
        "owner": catalog.target_owner,
        "apiUrl": catalog.api_url,
        "publicBaseUrl": catalog.public_base_url,
        "tokenFile": catalog.credential_file,
        "tokenVariable": catalog.credential_variable,
        "sourceCredentialFile": catalog.source_credential_file,
        "sourceCredentialUser": catalog.source_credential_user,
        "repositoryRoot": catalog.repository_root,
        "bunExecutable": catalog.bun_executable,
        "mirrorInterval": catalog.mirror_interval,
        "actions": catalog.actions_enabled,
        "nativeStorage": {
            "owner": catalog.native_storage.owner,
            "repository": catalog.native_storage.repository,
            "volumeName": catalog.native_storage.volume_name,
            "physicalPath": catalog.native_storage.physical_path,
            "hostMountPath": catalog.native_storage.host_mount_path,
            "containerPath": catalog.native_storage.container_path,
            "repositorySizeKiB": catalog.native_storage.repository_size_kib,
            "rootReserveKiB": catalog.native_storage.root_reserve_kib,
            "dataReserveKiB": catalog.native_storage.data_reserve_kib,
            "ownerUid": catalog.native_storage.owner_uid,
            "ownerGid": catalog.native_storage.owner_gid,
            "directoryMode": catalog.native_storage.directory_mode,
            "lfsRequirement": catalog.native_storage.lfs_requirement,
            "runnerRequirement": catalog.native_storage.runner_requirement,
            "runnerScope": catalog.native_storage.runner_scope,
            "instanceRunnerStatus": catalog.native_storage.instance_runner_status,
            "runnerJobQualification": catalog.native_storage.runner_job_qualification
        },
        "repositories": entries.iter().map(|entry| serde_json::json!({
            "name": entry.name,
            "targetOwner": entry.target_owner.as_deref().unwrap_or(&catalog.target_owner),
            "sizeKiB": entry.size_kib,
            "sourceUrl": entry.source_url,
            "visibility": entry.visibility,
            "archived": entry.archived,
            "defaultBranch": entry.default_branch,
            "head": entry.source_qualification.as_ref().and_then(|q| q.head.as_deref()),
            "refs": entry.source_qualification.as_ref().map(|q| &q.refs),
            "refShas": entry.source_qualification.as_ref().map(|q| &q.ref_shas),
            "lfsApplicable": entry.source_qualification.as_ref().map(|q| q.lfs_applicable),
            "lfsStatus": entry.source_qualification.as_ref().and_then(|q| q.lfs_status.as_deref()),
            "runnerStatus": entry.source_qualification.as_ref().and_then(|q| q.runner_status.as_deref()),
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
 let r;try{{const timeout=method==='POST'&&(path==='/repos/migrate'||path.endsWith('/mirror-sync'))?120000:12000;r=await fetch(d.apiUrl+path,{{method,headers:{{Authorization:'token '+token,'Content-Type':'application/json'}},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)}})}}catch{{bad('Gitea API unavailable: '+method+' '+path)}}
 if(missing&&r.status===404)return [404,null];
 if(!r.ok)bad('Gitea API request failed: '+method+' '+path+' ('+r.status+')');
 if(r.status===204)return [r.status,null];try{{return [r.status,await r.json()]}}catch{{bad('Gitea API response invalid')}}
}}
const needsGitHubAuth=d.repositories.length>0;
let githubToken=null;
if(needsGitHubAuth){{
 const authDir=Bun.file('/home/ubuntu/.config/gh'),authFile=Bun.file(d.sourceCredentialFile);
 const [dirStat,fileStat]=await Promise.all([authDir.stat(),authFile.stat()]);
 if((dirStat.mode&0o777)!==0o700||(fileStat.mode&0o777)!==0o600)bad('GitHub credential store permissions invalid');
 const auth=Bun.spawnSync(['gh','auth','token','--hostname','github.com','--user',d.sourceCredentialUser],{{timeout:10000}});
 if(auth.exitCode!==0)bad('GitHub repo-scope credential unavailable');
 githubToken=auth.stdout.toString().trim();if(!githubToken)bad('GitHub repo-scope credential unavailable');
}}
function gitRefs(url,authorization){{
 const env=authorization?{{...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraheader',GIT_CONFIG_VALUE_0:authorization}}:process.env;
 const result=Bun.spawnSync(['git','ls-remote','--refs',url],{{timeout:12000,env}});
 if(result.exitCode!==0)bad('Git mirror ref query failed');
 const refs={{}};for(const line of result.stdout.toString().trim().split(String.fromCharCode(10)).filter(Boolean)){{const [sha,ref]=line.trim().split(/\s+/);if(ref.startsWith('refs/heads/')||ref.startsWith('refs/tags/'))refs[ref]=sha;}}
 return refs;
}}
function sameRefs(left,right){{const a=Object.keys(left).sort(),b=Object.keys(right).sort();return a.length===b.length&&a.every((key,index)=>key===b[index]&&left[key]===right[key]);}}
const org=await req('GET','/orgs/aphrody-labs');if(org[1].username!=='aphrody-labs')bad('Gitea organization missing or unauthorized');
if(org[1].visibility!=='public')await req('PATCH','/orgs/aphrody-labs',{{visibility:'public'}});
if((await req('GET','/orgs/aphrody-labs'))[1].visibility!=='public')bad('Gitea organization is not publicly readable');
const nativeEntry=d.repositories.find(repo=>repo.targetOwner===d.nativeStorage.owner);
if(nativeEntry){{
 // Organization creation is idempotent and precedes source gates; it grants no clone permission.
 const owner=d.nativeStorage.owner;
 const [,nativeOrg]=await req('GET','/orgs/'+owner,undefined,true);
 if(!nativeOrg)await req('POST','/orgs',{{username:owner,visibility:'public'}});
 const [,verifiedOrg]=await req('GET','/orgs/'+owner);
 if(verifiedOrg.username!==owner||verifiedOrg.visibility!=='public')bad('Gitea native organization provision failed');
 const [,orgRepos]=await req('GET','/orgs/'+owner+'/repos?limit=2&page=1');
 if(!Array.isArray(orgRepos)||orgRepos.length>1||orgRepos.some(item=>item.name!==d.nativeStorage.repository))bad('Gitea native organization contains repositories outside its declared scope');
}}
let free=null;
let organizationRunnerAvailable=null;
function admitNativeStorage(repo){{
 const s=d.nativeStorage;
 if(repo.name!==s.repository||repo.sizeKiB!==s.repositorySizeKiB||s.owner!=='aphrody-labs-native'||s.containerPath!=='/data/git/repositories/aphrody-labs-native')bad('Gitea native storage scope rejected');
 const check=Bun.spawnSync(['docker','exec','aphrody-gitea','sh','-ec','p="$1"; test -d "$p"; data_device=$(stat -c %d /data); repo_device=$(stat -c %d "$p"); test "$data_device" != "$repo_device"; set -- $(df -Pk "$p" | tail -n 1); root_free="$4"; set -- $(df -Pk /data | tail -n 1); data_free="$4"; printf "%s %s" "$root_free" "$data_free"','native-storage',s.containerPath],{{timeout:10000}});
 if(check.exitCode!==0)bad('Gitea native storage mount is absent or shares the /data filesystem');
 const [rootFree,dataFree]=check.stdout.toString().trim().split(/\s+/).map(Number);
 if(!Number.isFinite(rootFree)||rootFree<s.repositorySizeKiB+s.rootReserveKiB||!Number.isFinite(dataFree)||dataFree<s.dataReserveKiB)bad('Gitea native storage admission below repository size and reserves');
}}
for(const repo of d.repositories){{
const owner=repo.targetOwner||d.owner;const path='/repos/'+owner+'/'+repo.name;const [status,current]=await req('GET',path,undefined,true);
 const expected=Object.keys(repo.refShas||{{}}).length?repo.refShas:(repo.refs.length?{{['refs/heads/'+repo.defaultBranch]:repo.head}}:{{}});
 const sourceAuth=repo.visibility==='private'?'Authorization: Basic '+btoa('x-access-token:'+githubToken):null;
 const metadataResponse=await fetch('https://api.github.com/repos/aphrody-labs/'+repo.name,{{headers:githubToken?{{Authorization:'Bearer '+githubToken,Accept:'application/vnd.github+json'}}:{{Accept:'application/vnd.github+json'}},signal:AbortSignal.timeout(12000)}});
 if(!metadataResponse.ok)bad('GitHub repository identity unavailable: '+repo.name);
 const metadata=await metadataResponse.json();
 if(metadata.full_name!=='aphrody-labs/'+repo.name||metadata.private!==(repo.visibility==='private')||metadata.archived!==repo.archived||(repo.refs.length&&metadata.default_branch!==repo.defaultBranch)||(owner===d.nativeStorage.owner&&metadata.size!==d.nativeStorage.repositorySizeKiB))bad('GitHub repository policy changed: '+repo.name);
 // This gate remains before capacity admission and migration, including on retries after org creation.
 if(owner===d.nativeStorage.owner&&(!['not-applicable','verified'].includes(repo.lfsStatus)||repo.lfsApplicable&&repo.lfsStatus!=='verified'))bad('Gitea native repository LFS status is not qualified');
 if(!sameRefs(gitRefs(repo.sourceUrl,sourceAuth),expected))bad('GitHub source ref set moved or incomplete: '+repo.name);
 free=Number((await Bun.$`df -Pk /home/ubuntu/apps/gitea/data | tail -n 1`.text()).trim().split(/\s+/)[3]);
 if(!Number.isFinite(free)||free<8*1024*1024)bad('Gitea storage admission below 8 GiB');
 const isMirror=!repo.archived;
 if(owner===d.nativeStorage.owner)admitNativeStorage(repo);
 if(status===404){{
  await req('POST','/repos/migrate',{{clone_addr:repo.sourceUrl,repo_name:repo.name,repo_owner:owner,service:'github',auth_token:repo.visibility==='private'?githubToken:undefined,mirror:isMirror,lfs:repo.lfsApplicable,private:true,mirror_interval:d.mirrorInterval}});
 }}else if(current.mirror!==isMirror||current.original_url!==repo.sourceUrl)bad('Existing Gitea repository conflicts with source policy: '+repo.name);
 else if(!current.private)await req('PATCH',path,{{private:true}});
 const before=(await req('GET',path))[1];if(before.has_actions!==!repo.archived)await req('PATCH',path,{{has_actions:!repo.archived}});
 if(isMirror)await req('POST',path+'/mirror-sync');
 if(repo.visibility==='private'&&isMirror){{
  const repoPath=d.repositoryRoot+'/'+owner+'/'+repo.name+'.git';
  const dir=Bun.spawnSync(['docker','exec','aphrody-gitea','chmod','700',repoPath],{{timeout:10000}});
  const file=Bun.spawnSync(['docker','exec','aphrody-gitea','chmod','600',repoPath+'/config'],{{timeout:10000}});
  if(dir.exitCode!==0||file.exitCode!==0)bad('Gitea private mirror credential storage protection failed: '+repo.name);
 }}
 const targetUrl='http://127.0.0.1:29020/'+owner+'/'+repo.name+'.git';
 const sourceNow=gitRefs(repo.sourceUrl,sourceAuth),targetNow=gitRefs(targetUrl,'Authorization: token '+token);
 if(!sameRefs(sourceNow,expected)||!sameRefs(targetNow,expected))bad('Gitea mirror refs diverge; repository remains private: '+repo.name);
 if(owner===d.nativeStorage.owner){{
  const [,runnerList]=await req('GET','/orgs/'+owner+'/actions/runners');
  organizationRunnerAvailable=Array.isArray(runnerList.runners)&&runnerList.runners.some(runner=>!runner.disabled&&['active','idle'].includes(runner.status));
  if(!organizationRunnerAvailable)bad('Gitea native repository is cloned, but no active or idle organization runner is available');
  // API presence is not a Cargo/Bun workflow execution; the receipt keeps that qualification pending.
 }}
 const publishPayload={{private:repo.visibility==='private',archived:repo.archived}};
 if(repo.archived){{
  if(isMirror)bad('archived source cannot be a pull mirror');
  const [,snapshot]=await req('GET',path);
  if(snapshot.private!==publishPayload.private)await req('PATCH',path,{{private:publishPayload.private}});
  if(snapshot.archived!==true)await req('PATCH',path,{{archived:true}});
 }}else if((await req('GET',path))[1].private!==publishPayload.private)await req('PATCH',path,{{private:publishPayload.private}});
 const published=(await req('GET',path))[1];if(published.mirror!==isMirror||published.private!==publishPayload.private||published.archived!==repo.archived||published.original_url!==repo.sourceUrl||published.default_branch!==repo.defaultBranch||published.has_actions!==!repo.archived)bad('Gitea mirror policy verification failed: '+repo.name);
 const anonymous=await fetch(d.publicBaseUrl+'/api/v1/repos/'+owner+'/'+repo.name,{{signal:AbortSignal.timeout(10000)}});
 if((repo.visibility==='private'&&anonymous.status!==404)||(repo.visibility==='public'&&anonymous.status!==200))bad('Gitea anonymous visibility mismatch: '+repo.name);
}}
console.log(JSON.stringify({{owner:d.owner,repositories:d.repositories.map(x=>x.name),freeKiB:free,organizationRunnerAvailable,runnerJobQualification:'not-run',verified:true}}));
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
    child
        .stdin
        .take()
        .context("stdin ssh absent")?
        .write_all(script.as_bytes())?;
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
            report.organization_runner_available = remote
                .get("organizationRunnerAvailable")
                .and_then(serde_json::Value::as_bool);
            if remote
                .get("runnerJobQualification")
                .and_then(serde_json::Value::as_str)
                != Some("not-run")
            {
                bail!("qualification d'un job runner absente du reçu distant");
            }
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
