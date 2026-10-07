// SPDX-License-Identifier: Apache-2.0
import { cli, quote, run } from "../../../../packages/discord/kit/src/lab/install.ts";

const host = "dbfr";
const transport = "/tmp/aphrody-yolo-c886d124e138.zst";
const transportSha = "4a52ed182d139e3dcaf154672816f33ce77165ff8c985cd84aca62c9da5e5a72";
const binarySha = "c886d124e1389167b0f1424b91bfc2902cc750c481d61fef6e97cd605493bf0b";
const pin = "/home/ubuntu/.yolo/bin/pins/discord-c886d124e138";
const remote = (command: string) =>
  run([cli, "infra", "ssh", "exec", "--host", host, "--cmd", command]);

if (import.meta.main) {
  console.log(
    JSON.stringify({
      plan: {
        host,
        pin,
        binarySha,
        transportSha,
        source: "existing installed Yolo native engine",
        activation: "sidepin only; no existing service or alias replacement",
        invocation: "BUN_BE_BUN=1",
      },
    }),
  );
  if (!process.argv.includes("--apply")) process.exit(0);
  if (
    new Bun.CryptoHasher("sha256").update(await Bun.file(transport).arrayBuffer()).digest("hex") !==
    transportSha
  )
    throw new Error("Existing compressed Yolo artifact checksum mismatch");
  const stage = `/home/ubuntu/.yolo/transfers/discord-c886d124e138-${Date.now()}`;
  await remote(`install -d -m 700 ${quote(stage)}`);
  const uploaded = `${stage}/yolo.zst`;
  await run([cli, "infra", "ssh", "sftp", "--host", host, "--put", transport, "--path", uploaded]);
  const install = `import pathlib,hashlib,subprocess,json,os,datetime
stage=pathlib.Path(${JSON.stringify(stage)})
archive=stage/'yolo.zst'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==${JSON.stringify(transportSha)}
binary=stage/'yolo'
subprocess.run(['zstd','--quiet','--decompress','--output',str(binary),str(archive)],check=True)
assert binary.stat().st_size==324884560
assert hashlib.sha256(binary.read_bytes()).hexdigest()==${JSON.stringify(binarySha)}
os.chmod(binary,0o555)
probe=subprocess.run([str(binary),'--version'],env={**os.environ,'BUN_BE_BUN':'1'},capture_output=True,text=True,timeout=10)
assert probe.returncode==0 and probe.stdout.strip()=='1.4.3'
js=subprocess.run([str(binary),'-e','if (2+2!==4) process.exit(1); console.log("YOLO_JS_OK")'],env={**os.environ,'BUN_BE_BUN':'1'},capture_output=True,text=True,timeout=10)
assert js.returncode==0 and js.stdout.strip()=='YOLO_JS_OK'
pin=pathlib.Path(${JSON.stringify(pin)})
pin.mkdir(parents=True,exist_ok=True,mode=0o750)
target=pin/'yolo'
if target.exists():
 assert hashlib.sha256(target.read_bytes()).hexdigest()==${JSON.stringify(binarySha)}
else:os.replace(binary,target)
os.chmod(target,0o555)
provenance={'schemaVersion':1,'installedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'existing installed Yolo CLI/native engine','sha256':${JSON.stringify(binarySha)},'bytes':324884560,'transportSha256':${JSON.stringify(transportSha)},'invocation':'BUN_BE_BUN=1','engineVersion':probe.stdout.strip(),'exactForkGitStampVerified':False,'serviceActivation':False}
receipt=pin/'provenance.json'
if not receipt.exists():
 fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o444)
 with os.fdopen(fd,'w') as stream:json.dump(provenance,stream)
print(json.dumps({'forkPinInstalled':True,'host':${JSON.stringify(host)},'sha256':${JSON.stringify(binarySha)},'version':probe.stdout.strip(),'javascriptVerified':True,'serviceActivation':False}))`;
  console.log(await remote(`python3 -c ${quote(install)}`));
}
