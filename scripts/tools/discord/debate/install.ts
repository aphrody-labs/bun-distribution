// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop */
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { root, cli, quote, run } from "../../../../packages/discord/kit/src/lab/install.ts";

const remote = (host: string, cmd: string) =>
  run([cli, "infra", "ssh", "exec", "--host", host, "--cmd", cmd]);

if (import.meta.main) {
  const exchangeIndex = process.argv.indexOf("--exchange");
  const exchangeTopic = exchangeIndex < 0 ? undefined : process.argv[exchangeIndex + 1];
  if (exchangeIndex >= 0 && (!exchangeTopic?.trim() || exchangeTopic.startsWith("--")))
    throw new Error("--exchange requires a topic");
  const plan = {
    host: "vps",
    unit: "aphrody-discord-debate.service",
    target: "/srv/aphrody-lab",
    backendHost: "dbfr",
    backend: "shared in-process native inference and MCP RAG bindings",
    credentials: "existing Discord/MCP protected environment files on each owner host; no transfer",
    privateStore: "/srv/aphrody-lab/state/debate",
    existingServices: "preserved",
  };
  console.log(JSON.stringify({ plan }));
  const hostCli = resolve(root, "packages/engine/core/src/host/cli.ts");
  console.log(await run([process.execPath, hostCli, "host-plan", plan.unit, "--target", "vps"]));
  if (!process.argv.includes("--apply")) process.exit(0);
  const stage = await mkdtemp(resolve(tmpdir(), "aphrody-debate-"));
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "worker.ts")],
    outdir: stage,
    naming: "debate.mjs",
    target: "bun",
  });
  if (!built.success) throw new Error("Debate bundle failed");
  const discord = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "shenron-discord.ts")],
    outdir: stage,
    naming: "aphrody-debate-discord.mjs",
    target: "bun",
  });
  if (!discord.success) throw new Error("Canonical Discord bridge bundle failed");
  const files: { host: string; source: string; name: string }[] = [
    {
      host: "dbfr",
      source: resolve(stage, "aphrody-debate-discord.mjs"),
      name: "aphrody-debate-discord.mjs",
    },
    { host: "vps", source: resolve(stage, "debate.mjs"), name: "debate.mjs" },
    {
      host: "vps",
      source: resolve(root, "tools/config/host/discord-debate.json"),
      name: "debate-policy.json",
    },
  ];
  const hashes: Record<string, string> = {};
  const remoteStage = `/tmp/${stage.split("/").at(-1)}`;
  for (const host of ["dbfr", "vps"]) await remote(host, `mkdir -m 700 ${quote(remoteStage)}`);
  for (const file of files) {
    hashes[file.name] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(file.source).arrayBuffer())
      .digest("hex");
    await run([
      cli,
      "infra",
      "ssh",
      "sftp",
      "--host",
      file.host,
      "--put",
      file.source,
      "--path",
      `${remoteStage}/${file.name}`,
      "--json",
    ]);
  }
  const verifyInstall = (names: string[], target: string) => `import pathlib,hashlib,json,subprocess
stage=pathlib.Path(${JSON.stringify(remoteStage)})
hashes=json.loads(${JSON.stringify(JSON.stringify(hashes))})
target=pathlib.Path(${JSON.stringify(target)})
subprocess.run(['install','-d','-m','755',str(target)],check=True)
for name in ${JSON.stringify(names)}:
 assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==hashes[name]
 subprocess.run(['install','-o','root','-g','root','-m','644',str(stage/name),str(target/name)],check=True)
 assert hashlib.sha256((target/name).read_bytes()).hexdigest()==hashes[name]
print(json.dumps({'verified':True,'files':${JSON.stringify(names)}}))`;
  const backup = `/srv/aphrody-lab/state/debate/rollback-${stage.split("/").at(-1)}`;
  const preserve = `import pathlib,hashlib,shutil,json,os
target=pathlib.Path(${JSON.stringify(backup)})
target.mkdir(mode=0o700)
for name,source in {'state.json':'/srv/aphrody-lab/state/debate/state.json','debate.mjs':'/srv/aphrody-lab/debate.mjs','debate-policy.json':'/srv/aphrody-lab/debate-policy.json','unit':'/etc/systemd/system/${plan.unit}'}.items():
 p=pathlib.Path(source)
 if p.exists():
  dest=target/name
  shutil.copy2(p,dest)
  os.chmod(dest,0o600)
  assert hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(dest.read_bytes()).digest()
print(json.dumps({'verifiedBackup':True}))`;
  let qualified = false;
  try {
    await remote(
      "vps",
      `if systemctl is-active --quiet ${plan.unit}; then sudo -n systemctl stop ${plan.unit}; fi`,
    );
    await remote(
      "vps",
      "sudo -n install -d -o ubuntu -g ubuntu -m 700 /srv/aphrody-lab/state/debate",
    );
    await remote("vps", "sudo -n -u ubuntu install -d -m 700 /home/ubuntu/.aphrody/locks");
    console.log(await remote("vps", `sudo -n -u ubuntu python3 -c ${quote(preserve)}`));
    await remote(
      "dbfr",
      `sudo -n python3 -c ${quote(verifyInstall(["aphrody-debate-discord.mjs"], "/usr/local/libexec"))}`,
    );
    await remote(
      "vps",
      `sudo -n python3 -c ${quote(verifyInstall(["debate.mjs", "debate-policy.json"], plan.target))}`,
    );
    const nativeWorker = (args: string[]) => {
      const invoke = `import pathlib,os,subprocess,json
env=dict(os.environ)
allowed={'APHRODY_FFI_LIB','APHRODY_INFERENCE_LIBRARY','APHRODY_MCP_HTTP_TOKEN'}
env['BUN_BE_BUN']='1'
for path in ['/etc/aphrody-discord-native.env','/etc/aphrody/aphrody-mcp-http.env']:
 for line in pathlib.Path(path).read_text().splitlines():
  if '=' in line and not line.startswith('#'):
   key,value=line.split('=',1)
   if key in allowed:env[key]=value.strip().strip('"'+chr(39))
assert env.get('APHRODY_FFI_LIB')==env.get('APHRODY_INFERENCE_LIBRARY')
assert pathlib.Path(env['APHRODY_FFI_LIB']).is_file()
command=['sudo','-n','-u','ubuntu','--preserve-env=BUN_BE_BUN,APHRODY_FFI_LIB,APHRODY_INFERENCE_LIBRARY,APHRODY_MCP_HTTP_TOKEN','/home/ubuntu/.yolo/bin/pins/discord-c886d124e138/yolo','/srv/aphrody-lab/debate.mjs','--policy','/srv/aphrody-lab/debate-policy.json','--env-file','/etc/aphrody-discord.env','--state','/srv/aphrody-lab/state/debate/state.json']+${JSON.stringify(args)}
child=subprocess.run(command,env=env,check=True)
print(json.dumps({'nativeWorkerCompleted':True}))`;
      return remote("vps", `sudo -n python3 -c ${quote(invoke)}`);
    };
    console.log(await nativeWorker(["--configure", "--apply"]));
    console.log(await nativeWorker(["--probe"]));
    console.log(await nativeWorker(["--guide"]));
    if (exchangeTopic) console.log(await nativeWorker(["--exchange", exchangeTopic]));
    // The declared unit passes Infra's composition plan and apply, then activation.
    console.log(
      await run([process.execPath, hostCli, "host-apply", plan.unit, "--target", "vps", "--apply"]),
    );
    qualified = true;
  } finally {
    // A failed probe leaves the last private session intact and never strands
    // the existing service stopped. Backups remain in the protected host store.
    if (!qualified) {
      const recover = `import pathlib,subprocess,hashlib,json
backup=pathlib.Path(${JSON.stringify(backup)})
for name,target in {'debate.mjs':'/srv/aphrody-lab/debate.mjs','debate-policy.json':'/srv/aphrody-lab/debate-policy.json','unit':'/etc/systemd/system/${plan.unit}'}.items():
 source=backup/name
 if source.exists():
  subprocess.run(['install','-m','644',str(source),target],check=True)
  assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(pathlib.Path(target).read_bytes()).digest()
subprocess.run(['systemctl','daemon-reload'],check=True)
print(json.dumps({'previousWorkerRecovered':True,'privateSessionPreserved':True}))`;
      console.log(await remote("vps", `sudo -n python3 -c ${quote(recover)}`));
    }
    await remote("vps", `sudo -n systemctl restart ${plan.unit}`);
  }
  console.log(await remote("vps", `systemctl is-active ${plan.unit}`));
  console.log(JSON.stringify({ installed: true, hashes }));
}
