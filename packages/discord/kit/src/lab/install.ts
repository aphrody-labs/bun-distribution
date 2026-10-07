// SPDX-License-Identifier: Apache-2.0
// Host transport stays owned by Infra; this entry installs the canonical lab worker.
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

export const root = resolve(import.meta.dir, "../../../../..");
export const cli = "/home/aphro/.local/bin/aphrody";
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export async function run(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Infra operation failed (${code}): ${stderr}`);
  return stdout;
}
export async function remote(command: string): Promise<string> {
  return run([cli, "infra", "ssh", "exec", "--host", "vps", "--cmd", command]);
}

if (import.meta.main) {
  const plan = {
    host: "vps",
    target: "/srv/aphrody-lab",
    credentials: "/etc/aphrody-discord.env",
    stateSource: "/home/ubuntu/.aphrody/private/discord-ai-lab-state.json",
    unit: "aphrody-discord-ai-lab.service",
  };
  console.log(JSON.stringify(plan));
  if (!process.argv.includes("--apply")) process.exit(0);
  await remote("test ! -e /srv/aphrody-lab");
  const stage = await mkdtemp(resolve(tmpdir(), "aphrody-lab-"));
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "assistant.ts")],
    outdir: stage,
    naming: "assistant.mjs",
    target: "bun",
  });
  if (!built.success) throw new Error("Lab bundle failed");
  const files = [
    [resolve(stage, "assistant.mjs"), "assistant.mjs"],
    [resolve(root, "config/host/discord-ai-lab.json"), "policy.json"],
    [resolve(root, "config/host/systemd/aphrody/aphrody-discord-ai-lab.service"), plan.unit],
  ];
  const remoteStage = "/tmp/" + stage.split("/").at(-1);
  await remote(`mkdir -m 700 ${quote(remoteStage)}`);
  const hashes: Record<string, string> = {};
  // Upload and checksum depend on the previous mutation.
  /* oxlint-disable no-await-in-loop */
  for (const [local, name] of files) {
    hashes[name!] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(local!).arrayBuffer())
      .digest("hex");
    await run([
      cli,
      "infra",
      "ssh",
      "sftp",
      "--host",
      "vps",
      "--put",
      local!,
      "--path",
      `${remoteStage}/${name}`,
      "--json",
    ]);
  }
  const install = `import pathlib,hashlib,json,subprocess
stage=pathlib.Path(${JSON.stringify(remoteStage)})
hashes=json.loads(${JSON.stringify(JSON.stringify(hashes))})
for name,digest in hashes.items():
 assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==digest, name
target=pathlib.Path('/srv/aphrody-lab')
assert not target.exists(), 'Existing installation requires an explicit upgrade'
subprocess.run(['install','-d','-m','755',str(target)],check=True)
subprocess.run(['install','-d','-o','ubuntu','-g','ubuntu','-m','700',str(target/'state')],check=True)
for name in ['assistant.mjs','policy.json']:
 subprocess.run(['install','-m','644',str(stage/name),str(target/name)],check=True)
 assert hashlib.sha256((target/name).read_bytes()).hexdigest()==hashes[name]
subprocess.run(['install','-o','ubuntu','-g','ubuntu','-m','600','/home/ubuntu/.aphrody/private/discord-ai-lab-state.json',str(target/'state/discord.json')],check=True)
unit='aphrody-discord-ai-lab.service'
subprocess.run(['install','-m','644',str(stage/unit),'/etc/systemd/system/'+unit],check=True)
subprocess.run(['systemd-analyze','verify','/etc/systemd/system/'+unit],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now',unit],check=True)
print(json.dumps({'installed':True,'hashes':hashes}))`;
  console.log(await remote(`sudo python3 -c ${quote(install)}`));
}
