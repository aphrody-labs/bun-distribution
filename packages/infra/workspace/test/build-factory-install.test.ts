// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import type { BuildFactoryConfig } from "../src/build-factory.ts";
import {
  factoryArtifacts,
  factoryInstallConfig,
  installFactoryArtifacts,
  type FactoryRemote,
} from "../src/build-factory-install.ts";

const roots: string[] = [];
const revision = "b".repeat(40);
const release = "factory-bbbbbbbbbbbb";
const config: BuildFactoryConfig = {
  schemaVersion: 1,
  enabled: true,
  target: "vps",
  cacheRoot: "/srv/factory/cache",
  artifactRoot: "/srv/factory/artifacts",
  lockPath: "/srv/factory/locks/heavy.lock",
  repositories: {
    aphrody: "/srv/factory/workspaces/aphrody",
    yolo: "/srv/factory/workspaces/yolo",
  },
  rust: { maxJobs: 6 },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => $`rm -rf ${root}`.quiet()));
});

async function scratch(prefix: string) {
  const root = `${Bun.env.TMPDIR ?? "/tmp"}/${prefix}-${crypto.randomUUID()}`;
  await $`mkdir -p ${root}`.quiet();
  roots.push(root);
  return root;
}

async function checkout() {
  const root = await scratch("factory-install");
  await Bun.write(
    `${root}/crates/ai/mcp/Cargo.toml`,
    '[package]\nname = "aphrody-mcp"\n\n[[bin]]\nname = "aphrody-mcp"\npath = "src/main.rs"\n',
  );
  await Bun.write(`${root}/apps/cli/Cargo.toml`, '[package]\nname = "aphrody-cli"\n');
  await Bun.write(`${root}/apps/cli/src/main.rs`, "fn main() {}\n");
  return root;
}

test("derives artifacts from --bin, packages, profiles and targets", async () => {
  const root = await checkout();
  const serial = "scripts/build/rust/cargo-serial.sh";
  expect(
    await factoryArtifacts(
      config,
      "aphrody",
      [serial, "build", "--release", "-p", "aphrody-mcp"],
      root,
    ),
  ).toEqual([
    { name: "aphrody-mcp", remotePath: "/srv/factory/cache/cargo/aphrody/release/aphrody-mcp" },
  ]);
  expect(
    await factoryArtifacts(
      config,
      "aphrody",
      ["cargo", "build", "--package=aphrody-cli", "--target", "x86_64-unknown-linux-gnu"],
      root,
    ),
  ).toEqual([
    {
      name: "aphrody-cli",
      remotePath: "/srv/factory/cache/cargo/aphrody/x86_64-unknown-linux-gnu/debug/aphrody-cli",
    },
  ]);
  expect(
    await factoryArtifacts(
      config,
      "yolo",
      ["cargo", "build", "--profile", "dist", "--bin", "yolo"],
      root,
    ),
  ).toEqual([{ name: "yolo", remotePath: "/srv/factory/workspaces/yolo/target/dist/yolo" }]);
  await expect(
    factoryArtifacts(config, "aphrody", ["cargo", "check", "-p", "aphrody-mcp"], root),
  ).rejects.toThrow("Cargo build command");
  await expect(
    factoryArtifacts(config, "aphrody", ["cargo", "build", "-p", "aphrody-mcp"], root, ["other"]),
  ).rejects.toThrow("not produced");
});

async function remoteFixture(script: string) {
  const root = await scratch("factory-remote");
  const source = `${root}/remote-bin`;
  await Bun.write(source, script, { mode: 0o755 });
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(source).arrayBuffer());
  const digest = hasher.digest("hex");
  let fetches = 0;
  const remote: FactoryRemote = {
    describe: async () => ({ sha256: digest, size: Bun.file(source).size }),
    fetch: async (_path, local) => {
      fetches++;
      await Bun.write(local, Bun.file(source));
    },
  };
  const install = factoryInstallConfig({
    binDir: `${root}/bin`,
    libRoot: `${root}/lib`,
    stateFile: `${root}/state/installs.jsonl`,
    probeTimeoutSeconds: 5,
  });
  return { root, remote, install, fetches: () => fetches };
}

const artifact = [{ name: "tool", remotePath: "/x/tool" }];

test("verifies, probes and atomically replaces; reinstall is unchanged", async () => {
  const { root, remote, install, fetches } = await remoteFixture("#!/bin/sh\necho tool 1.0\n");
  await Bun.write(`${install.binDir}/tool`, "#!/bin/sh\necho old\n", { mode: 0o755 });
  const [first] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(first!.status).toBe("installed");
  expect(await Bun.file(`${install.binDir}/tool`).text()).toBe("#!/bin/sh\necho tool 1.0\n");
  expect(first!.previous).toBe(`${install.libRoot}/${release}/previous/tool`);
  expect(await Bun.file(first!.previous!).text()).toBe("#!/bin/sh\necho old\n");
  expect(await Bun.file(`${root}/state/installs.jsonl`).text()).toContain('"status":"installed"');
  const [second] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(second!.status).toBe("unchanged");
  expect(fetches()).toBe(1);
});

test("refuses an artifact that cannot start here and keeps the active binary", async () => {
  const { remote, install } = await remoteFixture(
    "#!/bin/sh\necho 'GLIBC_2.43 not found' >&2\nexit 1\n",
  );
  await Bun.write(`${install.binDir}/tool`, "#!/bin/sh\necho ok\n", { mode: 0o755 });
  const [record] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(record!.status).toBe("refused");
  expect(record!.error).toContain("GLIBC_2.43");
  expect(await Bun.file(`${install.binDir}/tool`).text()).toBe("#!/bin/sh\necho ok\n");
});

test("rejects a download whose digest differs from the factory copy", async () => {
  const { remote, install } = await remoteFixture("#!/bin/sh\necho tool\n");
  const tampered: FactoryRemote = {
    describe: remote.describe,
    fetch: async (_path, local) => {
      await Bun.write(local, "#!/bin/sh\necho evil\n");
    },
  };
  const [record] = await installFactoryArtifacts(artifact, revision, tampered, install);
  expect(record!.status).toBe("refused");
  expect(record!.error).toContain("mismatch");
  expect(await Bun.file(`${install.binDir}/tool`).exists()).toBe(false);
});
