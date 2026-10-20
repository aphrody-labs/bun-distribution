#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * aphrody:toolbox (tools/config/container/toolbox/Dockerfile) from the toolbox build of the vps. Runs ON the vps:
 *
 *   bun scripts/release/toolbox-image.ts [--binary ~/.local/bin/aphrody] [--ship dbfr-wg]...
 *
 * Stages the Dockerfile and the binary (installed by aphrody-sync, features jobs,mcp-toolbox), builds
 * aphrody:toolbox-<sha256[:12] of the binary> and aphrody:toolbox, then for each --ship host streams
 * `docker save | gzip -1 | ssh HOST 'gunzip | docker load'` and retags aphrody:toolbox there. The tag is the binary
 * digest, so shipping the same build twice is a no-op on the target.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../");
const DOCKERFILE = join(ROOT, "tools/config/container/toolbox/Dockerfile");

export function parseArgs(argv: string[]) {
  const options = {
    binary: join(homedir(), ".local/bin/aphrody"),
    ship: [] as string[],
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--binary") options.binary = value;
    else if (flag === "--ship") {
      if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`invalid host: ${value}`);
      options.ship.push(value);
    } else throw new Error(`unknown option: ${flag}`);
  }
  return options;
}

function run(cmd: string[], cwd = ROOT): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed (${r.exitCode})`);
  return r.stdout.toString();
}

if (import.meta.main) {
  const { binary, ship } = parseArgs(Bun.argv.slice(2));
  const stage = mkdtempSync(join(tmpdir(), "aphrody-toolbox-"));
  let tag = "";
  try {
    await copyFile(DOCKERFILE, join(stage, "Dockerfile"));
    // aphrody-sync replaces the binary by rename: hash the staged copy, not the live path.
    await copyFile(binary, join(stage, "aphrody"));
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of Bun.file(join(stage, "aphrody")).stream()) hasher.update(chunk);
    tag = `toolbox-${hasher.digest("hex").slice(0, 12)}`;
    run(["docker", "build", "-q", "-t", `aphrody:${tag}`, "-t", "aphrody:toolbox", stage]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  for (const host of ship) {
    const present = Bun.spawnSync(["ssh", "-o", "BatchMode=yes", host, `docker image inspect -f . aphrody:${tag}`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (present.exitCode !== 0)
      run([
        "sh",
        "-c",
        `docker save aphrody:${tag} | gzip -1 | ssh -o BatchMode=yes ${host} 'gunzip | docker load -q'`,
      ]);
    run(["ssh", "-o", "BatchMode=yes", host, `docker tag aphrody:${tag} aphrody:toolbox`]);
    console.log(`${host}: aphrody:${tag} -> aphrody:toolbox`);
  }
  console.log(`aphrody:${tag}`);
}
