// SPDX-License-Identifier: Apache-2.0
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cli, root, quote, run } from "../../../../packages/discord/kit/src/lab/install.ts";

const remote = (command: string) =>
  run([cli, "infra", "ssh", "exec", "--host", "vps", "--cmd", command]);
const unit = "aphrody-mcp-http.service";
const config = "/srv/aphrody-lab/debate-mcp.toml";

async function applyOwnerUnit(hostCli: string): Promise<void> {
  const child = Bun.spawn(
    [process.execPath, hostCli, "host-apply", unit, "--target", "vps", "--apply"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  console.log(
    stdout
      .split("\n")
      .filter((line) => /^(?:ok\s|fail\s|FAIL\s|applied\b)/.test(line))
      .join("\n"),
  );
  if (code !== 0) {
    console.log(JSON.stringify({ ownerApplyCode: code, stderrBytes: Buffer.byteLength(stderr) }));
    throw new Error("Native MCP owner apply failed");
  }
}

if (import.meta.main) {
  const hostCli = resolve(root, "packages/engine/core/src/host/cli.ts");
  console.log(
    JSON.stringify({
      plan: {
        host: "vps",
        unit,
        config,
        credentialOwner: "existing /etc/aphrody/aphrody-mcp-http.env; token unchanged",
        databaseOwner: "existing /etc/rose-griffon/shenron-bot.env via shenron-pg-tunnel",
        environment: "/etc/aphrody/discord-debate-rag.env",
        readOnly: true,
        lifecycle: "bounded pause of the MCP owner unit, checked backup and automatic recovery",
        database: "Shenron native RAG schema only; no corpus or credentials transfer",
      },
    }),
  );
  console.log(await run([process.execPath, hostCli, "host-plan", unit, "--target", "vps"]));
  if (!process.argv.includes("--apply")) process.exit(0);
  const stage = await mkdtemp(resolve(tmpdir(), "aphrody-native-rag-"));
  const source = resolve(root, "tools/config/host/discord-debate-mcp.toml");
  const hash = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(source).arrayBuffer())
    .digest("hex");
  const remoteSource = `/tmp/${stage.split("/").at(-1)}.toml`;
  const backup = `/var/lib/aphrody/private/${stage.split("/").at(-1)}`;
  await run([
    cli,
    "infra",
    "ssh",
    "sftp",
    "--host",
    "vps",
    "--put",
    source,
    "--path",
    remoteSource,
  ]);
  const preserve = `import pathlib,json,hashlib,shutil,os
backup=pathlib.Path(${JSON.stringify(backup)})
backup.mkdir(parents=True,mode=0o700)
os.chmod(backup,0o700)
paths={'unit':'/etc/systemd/system/${unit}','environment':'/etc/aphrody/discord-debate-rag.env','config':${JSON.stringify(config)}}
present={}
for name,path in paths.items():
 source=pathlib.Path(path);present[name]=source.exists()
 if source.exists():
  target=backup/name;shutil.copy2(source,target);os.chmod(target,0o600)
  assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest()
(backup/'manifest.json').write_text(json.dumps({'paths':paths,'present':present}))
os.chmod(backup/'manifest.json',0o600)
print(json.dumps({'verifiedProtectedBackup':True}))`;
  console.log(await remote(`sudo -n python3 -c ${quote(preserve)}`));
  const prepare = `import pathlib,json,urllib.parse,os,hashlib,subprocess,time,shutil
def read_env(path):
 env={}
 for line in pathlib.Path(path).read_text().splitlines():
  if '=' in line and not line.startswith('#'):
   key,value=line.split('=',1);env[key]=value.strip().strip('"'+chr(39))
 return env
source=read_env('/etc/rose-griffon/shenron-bot.env')['DATABASE_URL']
url=urllib.parse.urlparse(source)
assert url.hostname=='127.0.0.1' and url.port==15433 and url.path=='/shenron_site' and url.username=='shenron'
pg={**os.environ,'PGHOST':url.hostname,'PGPORT':str(url.port),'PGUSER':urllib.parse.unquote(url.username),'PGPASSWORD':urllib.parse.unquote(url.password or ''),'PGDATABASE':url.path.lstrip('/'),'PGCONNECT_TIMEOUT':'5'}
check=subprocess.run(['psql','--no-psqlrc','--tuples-only','--no-align','--command',"BEGIN READ ONLY; SELECT count(*) FROM shenron_compute.aphrody_rag_documents WHERE corpus='shenron'; ROLLBACK;"],env=pg,capture_output=True,timeout=10)
assert check.returncode==0
counts=[int(row) for row in check.stdout.decode().splitlines() if row.isdigit()]
assert counts and counts[0]>0
params=urllib.parse.parse_qs(url.query)
params['options']=['-c search_path=shenron_compute,public -c default_transaction_read_only=on']
readonly=urllib.parse.urlunparse(url._replace(query=urllib.parse.urlencode(params,doseq=True,quote_via=urllib.parse.quote)))
preflight=subprocess.run(['psql','--no-psqlrc','--tuples-only','--no-align','--command',"SELECT current_setting('search_path'),current_setting('default_transaction_read_only'); SELECT count(*) FROM aphrody_rag_documents WHERE corpus='shenron';"],env={**pg,'PGOPTIONS':params['options'][0]},capture_output=True,timeout=10)
assert preflight.returncode==0 and 'shenron_compute' in preflight.stdout.decode() and '|on' in preflight.stdout.decode() and str(counts[0]) in preflight.stdout.decode()
target=pathlib.Path('/etc/aphrody/discord-debate-rag.env')
if target.exists():
 backup=target.with_name(target.name+'.before-'+str(time.time_ns()))
 shutil.copy2(target,backup);os.chmod(backup,0o600)
 assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(backup.read_bytes()).digest()
temporary=target.with_name(target.name+'.'+str(os.getpid())+'.tmp')
fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream:stream.write('APHRODY_MCP_DATABASE_URL='+json.dumps(readonly)+'\\n')
os.replace(temporary,target)
stage=pathlib.Path(${JSON.stringify(remoteSource)})
assert hashlib.sha256(stage.read_bytes()).hexdigest()==${JSON.stringify(hash)}
subprocess.run(['install','-o','root','-g','ubuntu','-m','640',str(stage),${JSON.stringify(config)}],check=True)
print(json.dumps({'readOnlyDatabaseVerified':True,'nativeRagDocuments':counts[0],'configChecksumVerified':True}))`;
  const probe = `import pathlib,json,os,subprocess
env=dict(os.environ)
for line in pathlib.Path('/etc/aphrody/aphrody-mcp-http.env').read_text().splitlines():
 if line.startswith('APHRODY_MCP_HTTP_TOKEN='):env['APHRODY_MCP_HTTP_TOKEN']=line.split('=',1)[1].strip().strip('"'+chr(39))
child=subprocess.run(['/home/ubuntu/.local/bin/aphrody','mcp','call','shenron-rag','aphrody_shenron_rag_search','--config',${JSON.stringify(config)},'--args',json.dumps({'q':'Son Goku','limit':6})],env=env,capture_output=True,timeout=30)
assert child.returncode==0
envelope=json.loads(child.stdout)
result=envelope['result']
assert not result.get('isError')
payload=result.get('structuredContent')
if payload is None:payload=json.loads('\\n'.join(item['text'] for item in result['content'] if item['type']=='text'))
allowed={'RAG database unavailable','RAG search unavailable','q must contain 1..=512 bytes'}
error=payload.get('error');message=error.get('message') if isinstance(error,dict) else error
print(json.dumps({'probePayloadKeys':list(payload),'sourceCount':len(payload.get('results',[])),'safeError':message if isinstance(message,str) and message in allowed else ('other' if 'error' in payload else None),'errorKeys':list(error) if isinstance(error,dict) else []}))
verified='error' not in payload and len(payload.get('results',[]))==6
print(json.dumps({'nativeRagRpcVerified':verified,'sourceCount':len(payload.get('results',[])),'sourceIds':[item['sourceId'] for item in payload.get('results',[])]}))`;
  let qualified = false;
  try {
    console.log(await remote(`sudo -n python3 -c ${quote(prepare)}`));
    await remote(`sudo -n systemctl stop ${unit}`);
    await applyOwnerUnit(hostCli);
    await remote(`sudo -n systemctl restart ${unit}`);
    const receipt = await remote(`sudo -n python3 -c ${quote(probe)}`);
    console.log(receipt);
    const status = JSON.parse(receipt.trim().split("\n").at(-1)!) as {
      nativeRagRpcVerified: boolean;
    };
    if (!status.nativeRagRpcVerified) throw new Error("Native RAG six-source parity failed");
    qualified = true;
  } finally {
    if (!qualified) {
      const recover = `import pathlib,json,shutil,hashlib,subprocess
backup=pathlib.Path(${JSON.stringify(backup)})
manifest=json.loads((backup/'manifest.json').read_text())
for name,path in manifest['paths'].items():
 target=pathlib.Path(path)
 if manifest['present'][name]:
  shutil.copy2(backup/name,target)
  assert hashlib.sha256((backup/name).read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest()
 elif target.exists():target.unlink()
subprocess.run(['systemctl','daemon-reload'],check=True)
print(json.dumps({'protectedRecoveryVerified':True}))`;
      console.log(await remote(`sudo -n python3 -c ${quote(recover)}`));
    }
    await remote(`sudo -n systemctl restart ${unit}`);
  }
  console.log(await remote(`systemctl is-active ${unit}`));
}
