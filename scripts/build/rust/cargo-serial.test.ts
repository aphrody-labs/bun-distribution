// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures: string[] = [];
// Linux factories own this Bash/flock wrapper; Windows owns the PowerShell one.
const linuxTest = test.skipIf(process.platform !== "linux");
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function run(host: string) {
  const root = mkdtempSync(join(tmpdir(), "aphrody-cargo-routing-"));
  fixtures.push(root);
  const wrapper = join(root, "scripts/build/rust/cargo-serial.sh");
  const factory = join(root, "packages/infra/workspace/src/build-factory.ts");
  const bin = join(root, "bin");
  for (const dir of [
    join(root, "scripts/build/rust"),
    join(root, "tools", "config"),
    join(root, "packages/infra/workspace/src"),
    bin,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(wrapper, await Bun.file(join(import.meta.dir, "cargo-serial.sh")).text());
  await Bun.write(join(root, "tools/config/build-factory.json"), "{}");
  await Bun.write(factory, 'console.log("factory");\n');
  await Bun.write(
    join(root, "packages/infra/workspace/src/build-factory-cleanup.ts"),
    `
if (Bun.argv[2] === "--held") process.exit(1);
console.log("fixture-resource-owner");
const child = Bun.spawn(Bun.argv.slice(3), { env: { ...process.env, APHRODY_BUILD_HOST: "", APHRODY_FACTORY_RESOURCE: "", APHRODY_LOCAL_CARGO: "1" }, stdout: "inherit", stderr: "inherit" });
process.exitCode = await child.exited;
`,
  );
  const cargo = join(bin, "cargo");
  await Bun.write(cargo, '#!/bin/sh\nprintf "fixture-cargo:%s\\n" "$*"\n');
  chmodSync(cargo, 0o700);
  return Bun.spawnSync(["bash", wrapper, "check", "-p", "fixture"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      APHRODY_BUILD_HOST: host,
      APHRODY_FACTORY_RESOURCE: "",
      APHRODY_LOCAL_CARGO: "0",
      APHRODY_CLOUD: "0",
      CLAUDE_CODE_REMOTE: "false",
      APHRODY_CARGO_JOBS: "1",
      APHRODY_CARGO_LOCK_DIR: join(root, "locks"),
      APHRODY_CARGO_LOCK_TIMEOUT_SECS: "5",
      APHRODY_CARGO_TARGET_DIR: "",
    },
    timeout: 10_000,
    stdout: "pipe",
    stderr: "pipe",
  });
}

linuxTest.each(["vps", "dbfr"])(
  "declared factory host %s executes Cargo under the serialized wrapper",
  async (host) => {
    const result = await run(host);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("fixture-cargo:check -p fixture");
    expect(result.stderr.toString()).toContain("[cargo-serial] waiting for");
    if (host === "vps") expect(result.stdout.toString()).toContain("fixture-resource-owner");
  },
);

linuxTest.each(["", "wsl", "dbfr-untrusted"])(
  "non-factory host %s keeps the heavy Cargo routing refusal",
  async (host) => {
    const result = await run(host);
    expect(result.exitCode).toBe(64);
    expect(result.stdout.toString()).not.toContain("fixture-cargo");
    expect(result.stderr.toString()).toContain("Heavy Cargo never runs in WSL");
  },
);
