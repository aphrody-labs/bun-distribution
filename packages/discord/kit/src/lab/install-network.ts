// SPDX-License-Identifier: Apache-2.0
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { root, cli, quote, run, remote } from "./install.ts";

if (import.meta.main) {
  console.log(
    JSON.stringify({
      host: "vps",
      component: "wireguard-and-service-telemetry",
      destination: "/srv/aphrody-lab",
      intervalSeconds: 120,
    }),
  );
  if (!process.argv.includes("--apply")) process.exit(0);
  await remote("test -f /srv/aphrody-lab/assistant.mjs");
  const stage = await mkdtemp(resolve(tmpdir(), "aphrody-lab-network-"));
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "network.ts"), resolve(import.meta.dir, "telemetry.ts")],
    target: "bun",
    outdir: stage,
    naming: "[name].mjs",
  });
  if (!build.success) throw new Error("Network telemetry bundle failed");
  const files: [string, string][] = [
    [resolve(stage, "network.mjs"), "network.mjs"],
    [resolve(stage, "telemetry.mjs"), "telemetry.mjs"],
    [resolve(root, "tools/config/host/wireguard/aphrody-tunnel.json"), "network.json"],
    ...["service", "timer"].map((kind): [string, string] => [
      resolve(root, `tools/config/host/systemd/aphrody/aphrody-discord-lab-telemetry.${kind}`),
      `aphrody-discord-lab-telemetry.${kind}`,
    ]),
  ];
  const remoteStage = "/tmp/" + stage.split("/").at(-1);
  await remote(`mkdir -m 700 ${quote(remoteStage)}`);
  const hashes: Record<string, string> = {};
  // Each upload depends on its staging directory and is checksum-qualified before activation.
  /* oxlint-disable no-await-in-loop */
  for (const [local, name] of files) {
    hashes[name] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(local).arrayBuffer())
      .digest("hex");
    await run([
      cli,
      "infra",
      "ssh",
      "sftp",
      "--host",
      "vps",
      "--put",
      local,
      "--path",
      `${remoteStage}/${name}`,
      "--json",
    ]);
  }
  const program = `import pathlib,json,hashlib,subprocess
stage=pathlib.Path(${JSON.stringify(remoteStage)})
hashes=json.loads(${JSON.stringify(JSON.stringify(hashes))})
destinations={name:pathlib.Path('/etc/systemd/system' if name.endswith(('.service','.timer')) else '/srv/aphrody-lab')/name for name in hashes}
for name,digest in hashes.items():
 assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==digest, name
 dest=destinations[name]
 assert not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest()==digest, 'Existing telemetry installation differs: '+name
for name,dest in destinations.items():
 subprocess.run(['install','-m','644',str(stage/name),str(dest)],check=True)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==hashes[name]
subprocess.run(['systemd-analyze','verify','/etc/systemd/system/aphrody-discord-lab-telemetry.service','/etc/systemd/system/aphrody-discord-lab-telemetry.timer'],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','aphrody-discord-lab-telemetry.timer'],check=True)
subprocess.run(['systemctl','start','aphrody-discord-lab-telemetry.service'],check=True)
print(json.dumps({'installed':True,'hashes':hashes}))`;
  console.log(await remote(`sudo python3 -c ${quote(program)}`));
}
