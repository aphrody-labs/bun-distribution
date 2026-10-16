// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import type { BuildFactoryConfig } from "../../src/automation/build-factory.ts";
import {
  factoryArtifacts,
  factoryInstallConfig,
  installFactoryArtifacts,
  type FactoryRemote,
} from "../../src/automation/build-factory-install.ts";

const roots: string[] = [];
const windows = process.platform === "win32";
const EXE = windows ? ".exe" : "";
/** A 1 KiB x64 console PE whose entry point returns 0 (Windows fixture for a runnable artifact). */
function tinyPe(): Uint8Array {
  const b = new Uint8Array(0x400);
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x5a]); // MZ
  v.setUint32(0x3c, 0x40, true); // e_lfanew
  b.set([0x50, 0x45, 0, 0], 0x40); // PE\0\0
  const coff = 0x44;
  v.setUint16(coff, 0x8664, true); // AMD64
  v.setUint16(coff + 2, 1, true); // sections
  v.setUint16(coff + 16, 0xf0, true); // optional header size
  v.setUint16(coff + 18, 0x22, true); // executable, large address aware
  const opt = coff + 20;
  v.setUint16(opt, 0x20b, true); // PE32+
  v.setUint32(opt + 16, 0x1000, true); // entry point
  v.setUint32(opt + 20, 0x1000, true); // base of code
  v.setBigUint64(opt + 24, 0x140000000n, true); // image base
  v.setUint32(opt + 32, 0x1000, true); // section alignment
  v.setUint32(opt + 36, 0x200, true); // file alignment
  v.setUint16(opt + 40, 6, true); // OS major
  v.setUint16(opt + 48, 6, true); // subsystem major
  v.setUint32(opt + 56, 0x2000, true); // size of image
  v.setUint32(opt + 60, 0x200, true); // size of headers
  v.setUint16(opt + 68, 3, true); // console subsystem
  v.setBigUint64(opt + 72, 0x100000n, true); // stack reserve
  v.setBigUint64(opt + 80, 0x1000n, true); // stack commit
  v.setBigUint64(opt + 88, 0x100000n, true); // heap reserve
  v.setBigUint64(opt + 96, 0x1000n, true); // heap commit
  v.setUint32(opt + 108, 16, true); // data directories
  const section = opt + 0xf0;
  b.set(new TextEncoder().encode(".text"), section);
  v.setUint32(section + 8, 0x1000, true); // virtual size
  v.setUint32(section + 12, 0x1000, true); // virtual address
  v.setUint32(section + 16, 0x200, true); // raw size
  v.setUint32(section + 20, 0x200, true); // raw pointer
  v.setUint32(section + 36, 0x60000020, true); // code, execute, read
  b.set([0x31, 0xc0, 0xc3], 0x200); // xor eax, eax; ret
  return b;
}
/** An executable whose `--version` succeeds: a shell script on POSIX, a minimal PE on Windows. */
const runnable = (script: string) => (windows ? tinyPe() : script);
const bytes = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());
const revision = "b".repeat(40);
const release = "factory-bbbbbbbbbbbb";
const config: BuildFactoryConfig = {
  schemaVersion: 1,
  enabled: true,
  target: "vps",
  cacheRoot: "/home/ubuntu/apps/factory/cache",
  artifactRoot: "/home/ubuntu/apps/factory/artifacts",
  lockPath: "/home/ubuntu/apps/factory/locks/heavy.lock",
  repositories: {
    aphrody: "/home/ubuntu/apps/factory/workspaces/aphrody",
    yolo: "/home/ubuntu/apps/factory/workspaces/yolo",
  },
  rust: { maxJobs: 6 },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => $`rm -rf ${root}`.quiet()));
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
  await Bun.write(`${root}/crates/infra/aphrody/Cargo.toml`, '[package]\nname = "aphrody-cli"\n');
  await Bun.write(`${root}/crates/infra/aphrody/src/main.rs`, "fn main() {}\n");
  return root;
}

test("derives artifacts from --bin, packages, profiles and targets", async () => {
  const root = await checkout();
  const serial = "scripts/build/rust/cargo-serial.sh";
  expect(await factoryArtifacts(config, "aphrody", [serial, "build", "--release", "-p", "aphrody-mcp"], root)).toEqual([
    {
      name: "aphrody-mcp",
      remotePath: "/home/ubuntu/apps/factory/cache/cargo/aphrody/release/aphrody-mcp",
    },
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
      remotePath: "/home/ubuntu/apps/factory/cache/cargo/aphrody/x86_64-unknown-linux-gnu/debug/aphrody-cli",
    },
  ]);
  expect(
    await factoryArtifacts(config, "yolo", ["cargo", "build", "--profile", "dist", "--bin", "yolo"], root),
  ).toEqual([
    {
      name: "yolo",
      remotePath: "/home/ubuntu/apps/factory/workspaces/yolo/target/dist/yolo",
    },
  ]);
  await expect(factoryArtifacts(config, "aphrody", ["cargo", "check", "-p", "aphrody-mcp"], root)).rejects.toThrow(
    "Cargo build command",
  );
  await expect(
    factoryArtifacts(config, "aphrody", ["cargo", "build", "-p", "aphrody-mcp"], root, ["other"]),
  ).rejects.toThrow("not produced");
});

async function remoteFixture(script: string | Uint8Array) {
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
  const tool = runnable("#!/bin/sh\necho tool 1.0\n");
  const { root, remote, install, fetches } = await remoteFixture(tool);
  await Bun.write(`${install.binDir}/tool${EXE}`, "#!/bin/sh\necho old\n", {
    mode: 0o755,
  });
  const [first] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(first!.error).toBeUndefined();
  expect(first!.status).toBe("installed");
  expect(await bytes(`${install.binDir}/tool${EXE}`)).toEqual(
    typeof tool === "string" ? new TextEncoder().encode(tool) : tool,
  );
  expect(first!.previous).toBe(`${install.libRoot}/${release}/previous/tool${EXE}`);
  expect(await Bun.file(first!.previous!).text()).toBe("#!/bin/sh\necho old\n");
  expect(await Bun.file(`${root}/state/installs.jsonl`).text()).toContain('"status":"installed"');
  const [second] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(second!.error).toBeUndefined();
  expect(second!.status).toBe("unchanged");
  expect(fetches()).toBe(1);
});

test("refuses an artifact that cannot start here and keeps the active binary", async () => {
  const { remote, install } = await remoteFixture("#!/bin/sh\necho 'GLIBC_2.43 not found' >&2\nexit 1\n");
  await Bun.write(`${install.binDir}/tool${EXE}`, "#!/bin/sh\necho ok\n", {
    mode: 0o755,
  });
  const [record] = await installFactoryArtifacts(artifact, revision, remote, install);
  expect(record!.status).toBe("refused");
  // Windows cannot start the foreign (non-PE) artifact at all; POSIX runs it and reports its error.
  expect(record!.error).toContain(windows ? "Artifact cannot run on this host" : "GLIBC_2.43");
  expect(await Bun.file(`${install.binDir}/tool${EXE}`).text()).toBe("#!/bin/sh\necho ok\n");
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
  expect(await Bun.file(`${install.binDir}/tool${EXE}`).exists()).toBe(false);
});

test("serializes concurrent host installs and removes its owned lock on completion", async () => {
  const { remote, install } = await remoteFixture(runnable("#!/bin/sh\necho tool 1.0\n"));
  let entered!: () => void;
  let releaseGate!: () => void;
  const waiting = new Promise<void>(resolve => (entered = resolve));
  const gate = new Promise<void>(resolve => (releaseGate = resolve));
  const delayed: FactoryRemote = {
    describe: async path => {
      entered();
      await gate;
      return remote.describe(path);
    },
    fetch: (path, local) => remote.fetch(path, local),
  };
  const first = installFactoryArtifacts(artifact, revision, delayed, install);
  await waiting;
  await expect(installFactoryArtifacts(artifact, revision, remote, install)).rejects.toThrow(
    "Factory installation lock exists",
  );
  releaseGate();
  const [record] = await first;
  expect(record!.status).toBe("installed");
  expect(await Bun.file(join(install.binDir, ".aphrody-factory-install.lock")).exists()).toBe(false);
});

test("preserves a preexisting host install lock without touching the active binary", async () => {
  const { remote, install } = await remoteFixture(runnable("#!/bin/sh\necho tool 1.0\n"));
  const lockPath = join(install.binDir, ".aphrody-factory-install.lock");
  const lock = JSON.stringify({ pid: 123, revision });
  await Bun.write(lockPath, lock);
  await expect(installFactoryArtifacts(artifact, revision, remote, install)).rejects.toThrow(
    "Factory installation lock exists",
  );
  expect(await Bun.file(lockPath).text()).toBe(lock);
  expect(await Bun.file(join(install.binDir, `tool${EXE}`)).exists()).toBe(false);
});
