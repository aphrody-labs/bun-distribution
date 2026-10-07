// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { cli, root, quote, run } from "../../../../packages/discord/kit/src/lab/install.ts";

const unit = "aphrody-discord-debate.service";
const pin = "/home/ubuntu/.yolo/bin/pins/discord-c886d124e138/yolo";
const sha = "c886d124e1389167b0f1424b91bfc2902cc750c481d61fef6e97cd605493bf0b";

if (import.meta.main) {
  console.log(
    JSON.stringify({
      plan: {
        host: "vps",
        unit,
        runtime: pin,
        sha256: sha,
        change: "current qualified worker runtime only; natural turn drain before restart",
        preserve: "existing backend, policy, bundle, credentials and private state",
        rollback: "checksum-verified original unit; no native FFI activation",
      },
    }),
  );
  console.log(
    await run([
      process.execPath,
      resolve(root, "packages/engine/core/src/host/cli.ts"),
      "host-plan",
      unit,
      "--target",
      "vps",
    ]),
  );
  if (!process.argv.includes("--apply")) process.exit(0);
  const script = `
import { chmod, mkdir, copyFile } from "node:fs/promises";
const unit=${JSON.stringify(unit)}, pin=${JSON.stringify(pin)}, sha=${JSON.stringify(sha)};
const unitPath='/etc/systemd/system/'+unit;
const hash=async(path)=>new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex');
const invoke=async(args,env=process.env)=>{
 const child=Bun.spawn(args,{stdout:'pipe',stderr:'ignore',env});
 const [out,code]=await Promise.all([new Response(child.stdout).text(),child.exited]);
 if(code!==0)throw new Error('Runtime transition command failed');
 return out.trim();
};
if(await hash(pin)!==sha)throw new Error('Runtime pin checksum mismatch');
const env={...process.env,BUN_BE_BUN:'1'};
if(await invoke([pin,'--version'],env)!=='1.4.3')throw new Error('Runtime version mismatch');
const help=await invoke([pin,'/srv/aphrody-lab/debate.mjs','--help'],env);
if(!help.startsWith('Debate worker:'))throw new Error('Existing bundle runtime probe failed');
const before=await Bun.file(unitPath).text();
if(!/^ExecStart=\\S+ \\/srv\\/aphrody-lab\\/debate\\.mjs --policy \\/srv\\/aphrody-lab\\/debate-policy\\.json --env-file \\/etc\\/aphrody-discord\\.env --state \\/srv\\/aphrody-lab\\/state\\/debate\\/state\\.json$/m.test(before))throw new Error('Live worker unit identity mismatch');
if(before.includes('EnvironmentFile=/etc/aphrody-discord-native.env'))throw new Error('Native unit already owns activation');
const protectedBackup='/srv/aphrody-lab/state/debate/runtime-rollback-'+Date.now();
await mkdir(protectedBackup,{mode:0o700});
await copyFile(unitPath,protectedBackup+'/unit'); await chmod(protectedBackup+'/unit',0o600);
const originalSha=await hash(unitPath);
if(await hash(protectedBackup+'/unit')!==originalSha)throw new Error('Unit backup checksum mismatch');
const bundleSha=await hash('/srv/aphrody-lab/debate.mjs');
const policySha=await hash('/srv/aphrody-lab/debate-policy.json');
let updated=before.replace(/^ExecStart=\\S+ /m,'ExecStart='+pin+' ').replace(/^TimeoutStopSec=.*$/m,'TimeoutStopSec=450');
if(!/^Environment=BUN_BE_BUN=1$/m.test(updated))updated=updated.replace('[Service]','[Service]\\nEnvironment=BUN_BE_BUN=1');
let activated=false;
try {
 await Bun.write(unitPath,updated); await chmod(unitPath,0o644);
 await invoke(['systemd-analyze','verify',unitPath]);
 await invoke(['systemctl','daemon-reload']);
 // SIGTERM drains the active handler; no new turn starts after the signal.
 await invoke(['systemctl','stop',unit]);
 if(await hash('/srv/aphrody-lab/debate.mjs')!==bundleSha || await hash('/srv/aphrody-lab/debate-policy.json')!==policySha)throw new Error('Concurrent backend change detected');
 await invoke(['systemctl','start',unit]);
 if(await invoke(['systemctl','is-active',unit])!=='active')throw new Error('Worker not active');
 const pid=Number(await invoke(['systemctl','show',unit,'--property=MainPID','--value']));
 const executable=await Bun.file('/proc/'+pid+'/cmdline').text();
 if(!executable.startsWith(pin+'\\0'))throw new Error('Actual runtime process mismatch');
 const health=[];
 for(const port of [8798,8799]){
  const response=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Existing model health failed');
  health.push({port,status:response.status});
 }
 activated=true;
 console.log(JSON.stringify({runtimeOnly:true,active:true,pid,sha256:sha,bundleSha,policySha,health,nativeFFIActivated:false,privateStatePreserved:true}));
} finally {
 if(!activated){
  await copyFile(protectedBackup+'/unit',unitPath); await chmod(unitPath,0o644);
  if(await hash(unitPath)!==originalSha)throw new Error('Unit recovery checksum mismatch');
  await invoke(['systemctl','daemon-reload']); await invoke(['systemctl','restart',unit]);
 }
}
`;
  console.log(
    await run([
      cli,
      "infra",
      "ssh",
      "exec",
      "--host",
      "vps",
      "--cmd",
      `sudo -n env BUN_BE_BUN=1 ${quote(pin)} -e ${quote(script)}`,
    ]),
  );
}
