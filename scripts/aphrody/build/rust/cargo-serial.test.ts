// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures: string[] = [];
// Linux factories own this Bash/flock wrapper; Windows owns the PowerShell one.
const linuxTest = test.skipIf(process.platform !== "linux");
afterEach(() => {
  for (const path of fixtures.splice(0))
    rmSync(path, { recursive: true, force: true });
});

async function run(
  host: string,
  held = false,
  extra: Record<string, string | undefined> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "aphrody-cargo-routing-"));
  fixtures.push(root);
  const wrapper = join(root, "scripts/build/rust/cargo-serial.sh");
  const factory = join(root, "packages/bun-workspace/src/automation/build-factory.ts");
  const bin = join(root, "bin");
  for (const dir of [
    join(root, "scripts/build/rust"),
    join(root, "tools", "config"),
    join(root, "packages/bun-workspace/src"),
    bin,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(
    wrapper,
    await Bun.file(join(import.meta.dir, "cargo-serial.sh")).text(),
  );
  await Bun.write(join(root, "tools/config/build-factory.json"), "{}");
  await Bun.write(factory, 'console.log("factory");\n');
  await Bun.write(
    join(root, "packages/bun-workspace/src/automation/build-factory-cleanup.ts"),
    `
if (Bun.argv[2] === "--held") process.exit(${held ? 0 : 1});
if (Bun.argv[2] === "--sccache") { console.log("fixture-shared-cache-prewarm"); process.exit(0); }
console.log("fixture-resource-owner");
const child = Bun.spawn(Bun.argv.slice(3), { env: { ...process.env, APHRODY_BUILD_HOST: "", APHRODY_FACTORY_RESOURCE: "", APHRODY_LOCAL_CARGO: "1" }, stdout: "inherit", stderr: "inherit" });
process.exitCode = await child.exited;
`,
  );
  const sccache = join(bin, "sccache");
  await Bun.write(sccache, "#!/bin/sh\nexit 0\n");
  chmodSync(sccache, 0o700);
  const nproc = join(bin, "nproc");
  await Bun.write(
    nproc,
    '#!/bin/sh\nprintf "%s\\n" "${APHRODY_TEST_CPU_COUNT:-12}"\n',
  );
  chmodSync(nproc, 0o700);
  const cargo = join(bin, "cargo");
  await Bun.write(
    cargo,
    '#!/bin/sh\nprintf "fixture-cargo:%s\\n" "$*"\nprintf "fixture-incremental:%s\\n" "${CARGO_INCREMENTAL-unset}"\nprintf "fixture-jobs:%s\\n" "$CARGO_BUILD_JOBS"\n',
  );
  chmodSync(cargo, 0o700);
  return Bun.spawnSync(["bash", wrapper, "check", "-p", "fixture"], {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      APHRODY_BUILD_HOST: host,
      APHRODY_FACTORY_RESOURCE: held ? join(root, "transient") : "",
      RUSTC_WRAPPER: "sccache",
      APHRODY_LOCAL_CARGO: "0",
      APHRODY_CLOUD: "0",
      CLAUDE_CODE_REMOTE: "false",
      APHRODY_CARGO_JOBS: "1",
      APHRODY_CARGO_LOCK_DIR: join(root, "locks"),
      APHRODY_CARGO_LOCK_TIMEOUT_SECS: "5",
      APHRODY_CARGO_TARGET_DIR: "",
      ...extra,
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
    expect(result.stdout.toString()).toContain(
      "fixture-cargo:check -p fixture",
    );
    expect(result.stderr.toString()).toContain("[cargo-serial] waiting for");
    if (host === "vps")
      expect(result.stdout.toString()).toContain("fixture-resource-owner");
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

linuxTest(
  "inherited heavy resource prewarms the shared daemon immediately before Cargo",
  async () => {
    const result = await run("vps", true);
    const output = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(output).toContain("fixture-shared-cache-prewarm");
    expect(output.indexOf("fixture-shared-cache-prewarm")).toBeLessThan(
      output.indexOf("fixture-cargo"),
    );
    expect(output).not.toContain("fixture-resource-owner");
  },
);

linuxTest(
  "heavy Cargo forces non-incremental builds unless the opt-in unsets it",
  async () => {
    const strict = await run("vps");
    expect(strict.stdout.toString()).toContain("fixture-incremental:0");
    expect(strict.exitCode).toBe(0);
    const loop = await run("vps", false, {
      CARGO_INCREMENTAL: "0",
      APHRODY_CARGO_INCREMENTAL: "1",
    });
    expect(loop.stdout.toString()).toContain("fixture-incremental:unset");
    expect(loop.exitCode).toBe(0);
  },
);

linuxTest(
  "explicit auto uses every available CPU and retains serialization",
  async () => {
    const result = await run("dbfr", false, { APHRODY_CARGO_JOBS: "auto" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("fixture-jobs:12");
    expect(result.stderr.toString()).toContain("[cargo-serial] waiting for");
  },
);

linuxTest(
  "auto refuses an invalid CPU probe before starting Cargo",
  async () => {
    const result = await run("dbfr", false, {
      APHRODY_CARGO_JOBS: "auto",
      APHRODY_TEST_CPU_COUNT: "invalid",
    });
    expect(result.exitCode).toBe(64);
    expect(result.stdout.toString()).not.toContain("fixture-cargo");
  },
);

linuxTest(
  "twelve explicit jobs reach Cargo under the inherited VPS lease",
  async () => {
    const result = await run("vps", true, { APHRODY_CARGO_JOBS: "12" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("fixture-jobs:12");
    expect(result.stdout.toString()).toContain("fixture-shared-cache-prewarm");
    expect(result.stderr.toString()).toContain("[cargo-serial] waiting for");
  },
);

linuxTest.each([
  { APHRODY_CARGO_JOBS: "12", APHRODY_TEST_CPU_COUNT: "6" },
  { APHRODY_CARGO_JOBS: "1025" },
  { APHRODY_CARGO_JOBS: "0" },
  { APHRODY_CARGO_JOBS: "1.5" },
])(
  "explicit jobs refuse unavailable affinity and invalid counts before Cargo: %j",
  async (env) => {
    const result = await run("dbfr", false, env);
    expect(result.exitCode).toBe(64);
    expect(result.stdout.toString()).not.toContain("fixture-cargo");
  },
);
