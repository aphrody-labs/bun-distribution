// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop */
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { root, cli, quote, run } from "../../../../packages/discord/kit/src/lab/install.ts";

const remote = (host: string, cmd: string) =>
  run([cli, "infra", "ssh", "exec", "--host", host, "--cmd", cmd]);

if (import.meta.main) {
  const plan = {
    host: "vps",
    unit: "aphrody-discord-debate.service",
    target: "/srv/aphrody-lab",
    backendHost: "dbfr",
    backend: "/usr/local/libexec/aphrody-debate-backend.py",
    credentials:
      "existing /etc/aphrody-discord.env and /etc/aphrody/shenron-compute.env; no transfer",
    privateStore: "/srv/aphrody-lab/state/debate",
    existingServices: "preserved",
  };
  console.log(JSON.stringify({ plan }));
  const hostCli = resolve(root, "packages/engine/core/src/host/cli.ts");
  console.log(await run(["bun", hostCli, "host-plan", plan.unit, "--target", "vps"]));
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
    {
      host: "dbfr",
      source: resolve(import.meta.dir, "backend.py"),
      name: "aphrody-debate-backend.py",
    },
    { host: "vps", source: resolve(stage, "debate.mjs"), name: "debate.mjs" },
    {
      host: "vps",
      source: resolve(root, "config/host/discord-debate.json"),
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
  await remote(
    "dbfr",
    `sudo -n python3 -c ${quote(verifyInstall(["aphrody-debate-backend.py", "aphrody-debate-discord.mjs"], "/usr/local/libexec"))}`,
  );
  await remote(
    "vps",
    `sudo -n python3 -c ${quote(verifyInstall(["debate.mjs", "debate-policy.json"], plan.target))}`,
  );
  await remote(
    "vps",
    `if systemctl is-active --quiet ${plan.unit}; then sudo -n systemctl stop ${plan.unit}; fi`,
  );
  await remote(
    "vps",
    "sudo -n install -d -o ubuntu -g ubuntu -m 700 /srv/aphrody-lab/state/debate",
  );
  const worker =
    "/home/ubuntu/.bun/bin/bun /srv/aphrody-lab/debate.mjs --policy /srv/aphrody-lab/debate-policy.json --env-file /etc/aphrody-discord.env --state /srv/aphrody-lab/state/debate/state.json";
  console.log(await remote("vps", `${worker} --configure --apply`));
  console.log(await remote("vps", `${worker} --probe`));
  // The declared unit passes Infra's composition plan and apply, then activation.
  console.log(await remote("vps", `${worker} --guide`));
  console.log(await run(["bun", hostCli, "host-apply", plan.unit, "--target", "vps", "--apply"]));
  await remote("vps", `sudo -n systemctl restart ${plan.unit}`);
  console.log(await remote("vps", `systemctl is-active ${plan.unit}`));
  console.log(JSON.stringify({ installed: true, hashes }));
}
