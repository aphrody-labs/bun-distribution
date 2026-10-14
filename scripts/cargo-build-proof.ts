#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { hashFile, loadConfig, repositoryRoot, runNativeResult, runProcess } from "@aphrody/bun-workspace";

const receiptPath = join(repositoryRoot, "build/vendor/cargo-build-receipt.json");
const overridePath = join(repositoryRoot, "build/vendor/cargo-config.toml");
const digest = (value: unknown) => Bun.CryptoHasher.hash("sha256", JSON.stringify(value), "hex");
const sha = /^[a-f0-9]{64}$/;
const buildArgs = [
  "--config",
  overridePath,
  "build",
  "--locked",
  "--offline",
  "--workspace",
  "--all-features",
  "--message-format=json-render-diagnostics",
];

interface Toolchain {
  channel: string;
  cargo: string;
  cargoSHA256: string;
  rustc: string;
  rustcSHA256: string;
}
interface Inputs {
  schemaVersion: 1;
  rootRevision: string;
  platform: string;
  arch: string;
  toolchain: Toolchain;
  runtime: { version: string; revision: string; executable: string; sha256: string };
  files: Record<string, string>;
  members: { path: string; name: string; revision: string; treeSHA256: string; files: number }[];
  vendor: { treeSHA256: string; files: number };
  environment: Record<string, string>;
  activeSourceReplacement: boolean;
}
interface Artifact {
  member: string;
  path: string;
  sha256: string;
}
interface Receipt {
  schemaVersion: 1;
  owner: "root-cargo-build";
  startedAt: string;
  finishedAt: string;
  command: string[];
  exitCode: 0;
  buildFinished: true;
  outputSHA256: string;
  inputs: Inputs;
  inputsSHA256: string;
  artifacts: Artifact[];
  memberNames: string[];
}

function inputKey(inputs: Inputs): string {
  const { rootRevision: _rootRevision, ...bindings } = inputs;
  return digest(bindings);
}

function deadline(timeout = 30000) {
  const signal = AbortSignal.timeout(timeout);
  const expires = Date.now() + timeout;
  return {
    signal,
    remaining() {
      signal.throwIfAborted();
      const remaining = expires - Date.now();
      if (remaining < 1) throw new Error("Cargo proof deadline exceeded.");
      return remaining;
    },
  };
}
type Deadline = ReturnType<typeof deadline>;

async function inspect(argv: string[], bound: Deadline, cwd = repositoryRoot): Promise<string> {
  const result = await runProcess(argv, cwd, {
    timeoutMs: Math.min(15000, bound.remaining()),
    maxOutputBytes: 1048576,
    signal: bound.signal,
  });
  if (result.code !== 0) throw new Error("Cargo proof source inspection failed.");
  return result.stdout.trim();
}

async function tree(path: string, bound: Deadline): Promise<{ treeSHA256: string; files: number }> {
  const entries: string[] = [];
  for await (const entry of new Bun.Glob("**/*").scan({
    cwd: path,
    dot: true,
    onlyFiles: false,
    followSymlinks: false,
  })) {
    if (entry.split(/[\\/]/).includes(".git")) continue;
    const info = await lstat(join(path, entry));
    if (info.isSymbolicLink()) throw new Error("Cargo proof cannot omit linked source entries.");
    if (info.isFile()) entries.push(entry);
    bound.remaining();
  }
  entries.sort();
  const records: [string, string][] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(16, entries.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= entries.length) return;
        const entry = entries[index]!;
        const file = join(path, entry);
        bound.remaining();
        if ((await lstat(file)).isSymbolicLink() || (await realpath(file)) !== resolve(file))
          throw new Error("Cargo proof source ownership is ambiguous.");
        records[index] = [entry.replaceAll("\\", "/"), await hashFile(file, { signal: bound.signal })];
      }
    }),
  );
  return { treeSHA256: digest(records), files: records.length };
}

async function sourceReplacementAt(path: string): Promise<boolean> {
  const config = Bun.TOML.parse(await Bun.file(path).text()) as {
    source?: Record<string, { "replace-with"?: string; directory?: string; git?: string; rev?: string }>;
  };
  const lock = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "Cargo.lock")).text()) as {
    package: { source?: string }[];
  };
  const owner = config.source?.["crates-io"]?.["replace-with"];
  const directory = owner && config.source?.[owner]?.directory;
  if (!directory || resolve(repositoryRoot, directory) !== join(repositoryRoot, "vendor/cargo")) return false;
  for (const pkg of lock.package) {
    if (!pkg.source?.startsWith("git+")) continue;
    const key = pkg.source.split("#")[0]!;
    if (config.source?.[key]?.["replace-with"] !== owner) return false;
  }
  return true;
}

export async function activeCargoSourceReplacement(): Promise<boolean> {
  return sourceReplacementAt(join(repositoryRoot, ".cargo/config.toml"));
}

async function capture(bound: Deadline): Promise<Inputs> {
  const rootRevision = await inspect(["git", "rev-parse", "HEAD"], bound);
  const rootManifest = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "Cargo.toml")).text()) as {
    workspace: { members: string[] };
  };
  const toolchainFile = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "rust-toolchain.toml")).text()) as {
    toolchain: { channel: string };
  };
  const channel = toolchainFile.toolchain.channel;
  if (!channel) throw new Error("Root Rust toolchain is unavailable.");
  const cargo = await realpath(await inspect(["rustup", "which", "--toolchain", channel, "cargo"], bound));
  const rustc = await realpath(await inspect(["rustup", "which", "--toolchain", channel, "rustc"], bound));
  const files: Record<string, string> = {};
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "sources.lock.json",
    ".gitmodules",
    ".cargo/config.toml",
    "scripts/cargo-build-proof.ts",
    "scripts/vendor-cargo.ts",
    "scripts/cargo-serial.ps1",
    "scripts/native-worker.ts",
    "packages/bun-workspace/src/index.ts",
    "packages/bun-workspace/src/process.ts",
    "aphrody.config.json",
    "build/vendor/cargo-config.toml",
  ])
    files[path] = await hashFile(join(repositoryRoot, path), { signal: bound.signal });
  const cargoHome = Bun.env.CARGO_HOME ?? join(Bun.env.USERPROFILE ?? Bun.env.HOME ?? "", ".cargo");
  for (const name of ["config", "config.toml"]) {
    const path = join(cargoHome, name);
    if (await Bun.file(path).exists()) files["cargo-home:" + name] = await hashFile(path, { signal: bound.signal });
  }
  for (let parent = dirname(repositoryRoot); ; parent = dirname(parent)) {
    for (const name of ["config", "config.toml"]) {
      const path = join(parent, ".cargo", name);
      if (await Bun.file(path).exists())
        files["ancestor-config:" + path] = await hashFile(path, { signal: bound.signal });
    }
    if (dirname(parent) === parent) break;
  }
  for (const name of ["sccache", "cl", "link", "cc", "ar", "clang"]) {
    const executable = Bun.which(name);
    if (executable) files["native-tool:" + name] = await hashFile(executable, { signal: bound.signal });
  }
  for (const name of ["RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"]) {
    const value = Bun.env[name];
    const executable = value && Bun.which(value);
    if (executable) files["native-wrapper:" + name] = await hashFile(executable, { signal: bound.signal });
  }
  const members: Inputs["members"] = [];
  for (const path of [...rootManifest.workspace.members].sort()) {
    if (!/^crates\/[A-Za-z0-9_-]+$/.test(path)) throw new Error("Cargo proof requires flat crate members.");
    const member = join(repositoryRoot, path);
    const manifest = Bun.TOML.parse(await Bun.file(join(member, "Cargo.toml")).text()) as { package: { name: string } };
    members.push({
      path,
      name: manifest.package.name,
      revision: await inspect(["git", "rev-parse", "HEAD"], bound, member),
      ...(await tree(member, bound)),
    });
  }
  const environment: Record<string, string> = {};
  for (const name of Object.keys(Bun.env).sort()) {
    if (
      /^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|CARGO_BUILD_TARGET|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_[A-Z0-9_]+_(LINKER|RUSTFLAGS)|CC|CXX|AR|CFLAGS|CXXFLAGS|LDFLAGS|PATH|LIB|INCLUDE|LIBPATH)$/.test(
        name,
      )
    )
      environment[name] = digest(Bun.env[name]);
  }
  const vendor = await tree(join(repositoryRoot, "vendor/cargo"), bound);
  if ((await inspect(["git", "rev-parse", "HEAD"], bound)) !== rootRevision)
    throw new Error("Cargo proof root revision changed.");
  return {
    schemaVersion: 1,
    rootRevision,
    platform: process.platform,
    arch: process.arch,
    toolchain: {
      channel,
      cargo,
      cargoSHA256: await hashFile(cargo, { signal: bound.signal }),
      rustc,
      rustcSHA256: await hashFile(rustc, { signal: bound.signal }),
    },
    runtime: {
      version: Bun.version,
      revision: Bun.revision,
      executable: process.execPath,
      sha256: await hashFile(process.execPath, { signal: bound.signal }),
    },
    files,
    members,
    vendor,
    environment,
    activeSourceReplacement: await activeCargoSourceReplacement(),
  };
}

/** A receipt is evidence only while source, toolchain, command and built artifacts still match. */
export async function cargoBuildQualification(): Promise<{
  compiled: boolean;
  activeSourceReplacement: boolean;
  buildProof: "missing" | "invalid" | "valid";
  receiptSHA256?: string;
}> {
  const activeSourceReplacement = await activeCargoSourceReplacement();
  if (!(await Bun.file(receiptPath).exists()))
    return { compiled: false, activeSourceReplacement, buildProof: "missing" };
  try {
    const bound = deadline();
    const file = Bun.file(receiptPath);
    if (file.size > 8 * 1024 * 1024) throw new Error("Cargo proof receipt exceeds its bound.");
    const receiptSHA256 = await hashFile(receiptPath, { signal: bound.signal });
    const receipt = (await file.json()) as Receipt;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.owner !== "root-cargo-build" ||
      receipt.exitCode !== 0 ||
      receipt.buildFinished !== true ||
      !sha.test(receipt.outputSHA256) ||
      !sha.test(receipt.inputsSHA256) ||
      inputKey(receipt.inputs) !== receipt.inputsSHA256 ||
      !Array.isArray(receipt.artifacts) ||
      !receipt.artifacts.length ||
      !Array.isArray(receipt.memberNames) ||
      !Number.isFinite(Date.parse(receipt.startedAt)) ||
      !Number.isFinite(Date.parse(receipt.finishedAt)) ||
      Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)
    )
      throw new Error("Cargo proof receipt is invalid.");
    const actual = await capture(bound);
    if (
      inputKey(actual) !== receipt.inputsSHA256 ||
      JSON.stringify(receipt.command) !== JSON.stringify([actual.toolchain.cargo, ...buildArgs]) ||
      JSON.stringify(receipt.memberNames) !== JSON.stringify(actual.members.map(member => member.name).sort())
    )
      throw new Error("Cargo proof inputs or command changed.");
    await inspect(["git", "merge-base", "--is-ancestor", receipt.inputs.rootRevision, actual.rootRevision], bound);
    const artifactMembers = new Set<string>();
    const artifactPaths = new Set<string>();
    for (const artifact of receipt.artifacts) {
      if (
        !sha.test(artifact.sha256) ||
        !receipt.memberNames.includes(artifact.member) ||
        artifactPaths.has(artifact.path) ||
        !artifact.path.startsWith("target/") ||
        artifact.path.split(/[\\/]/).includes("..")
      )
        throw new Error("Cargo proof artifact is invalid.");
      artifactMembers.add(artifact.member);
      artifactPaths.add(artifact.path);
      if ((await hashFile(join(repositoryRoot, artifact.path), { signal: bound.signal })) !== artifact.sha256)
        throw new Error("Cargo proof artifact changed.");
    }
    if (artifactMembers.size !== actual.members.length) throw new Error("Cargo proof omits workspace artifacts.");
    if (
      inputKey(await capture(bound)) !== receipt.inputsSHA256 ||
      (await hashFile(receiptPath, { signal: bound.signal })) !== receiptSHA256
    )
      throw new Error("Cargo proof changed during qualification.");
    return {
      compiled: true,
      activeSourceReplacement,
      buildProof: "valid",
      receiptSHA256,
    };
  } catch {
    return { compiled: false, activeSourceReplacement, buildProof: "invalid" };
  }
}

async function build(): Promise<void> {
  const beforeBound = deadline();
  const before = await capture(beforeBound);
  const committed = await inspect(
    ["git", "rev-parse", `${before.rootRevision}:scripts/cargo-build-proof.ts`],
    beforeBound,
  );
  if (
    committed !==
    (await inspect(["git", "hash-object", "--path=scripts/cargo-build-proof.ts", import.meta.path], beforeBound))
  )
    throw new Error("Commit the Cargo proof owner before executing it.");
  if (!(await sourceReplacementAt(overridePath)))
    throw new Error("Cargo build must use the root vendor source replacement.");
  const command = [before.toolchain.cargo, ...buildArgs];
  const startedAt = new Date().toISOString();
  // Cargo is the direct child of the existing serialized native owner; no nested Bun worker.
  const result = await runNativeResult(
    await loadConfig(),
    command,
    { root: repositoryRoot, timeoutMs: 300000, env: { RUSTC: before.toolchain.rustc } },
    true,
  );
  if (result.code !== 0) throw new Error("Cargo build did not succeed; no build receipt was issued.");
  const bound = deadline();
  const outputs = new Map<string, Artifact>();
  const completedMembers = new Set<string>();
  let finished = false;
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const message = JSON.parse(line) as {
      reason?: string;
      success?: boolean;
      manifest_path?: string;
      filenames?: string[];
    };
    if (message.reason === "build-finished" && message.success === true) finished = true;
    if (message.reason !== "compiler-artifact" || !message.manifest_path || !Array.isArray(message.filenames)) continue;
    const member = before.members.find(
      member => resolve(message.manifest_path!) === join(repositoryRoot, member.path, "Cargo.toml"),
    );
    if (!member) continue;
    if (!message.filenames.length) continue;
    for (const filename of message.filenames) {
      const file = await realpath(filename);
      const path = relative(repositoryRoot, file).replaceAll("\\", "/");
      // Cargo also reports metadata from the root's configured intermediate build directory.
      // Only final target artifacts establish a completed member in the release receipt.
      if (path.startsWith("build/rust/") && path.endsWith(".rmeta")) continue;
      if (!path.startsWith("target/") || path.split("/").includes(".."))
        throw new Error("Cargo artifact leaves the root target owner.");
      completedMembers.add(member.name);
      outputs.set(path, { member: member.name, path, sha256: await hashFile(file, { signal: bound.signal }) });
    }
  }
  if (!finished || completedMembers.size !== before.members.length || !outputs.size)
    throw new Error("Cargo build did not provide all workspace artifact evidence.");
  const after = await capture(bound);
  if (inputKey(before) !== inputKey(after)) throw new Error("Cargo build inputs changed; no receipt was issued.");
  await inspect(["git", "merge-base", "--is-ancestor", before.rootRevision, after.rootRevision], bound);
  const receipt: Receipt = {
    schemaVersion: 1,
    owner: "root-cargo-build",
    startedAt,
    finishedAt: new Date().toISOString(),
    command,
    exitCode: 0,
    buildFinished: true,
    outputSHA256: digest(result.stdout),
    inputs: before,
    inputsSHA256: inputKey(before),
    artifacts: [...outputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
    memberNames: [...completedMembers].sort(),
  };
  if ((await inspect(["git", "rev-parse", "HEAD"], bound)) !== after.rootRevision)
    throw new Error("Cargo proof root changed before receipt issuance.");
  await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify({
      compiled: true,
      members: completedMembers.size,
      activeSourceReplacement: before.activeSourceReplacement,
      receipt: "build/vendor/cargo-build-receipt.json",
    }),
  );
}

if (import.meta.main) {
  const action = Bun.argv[2] ?? "help";
  if (action === "status") console.log(JSON.stringify(await cargoBuildQualification()));
  else if (action === "plan") {
    const inputs = await capture(deadline());
    console.log(
      JSON.stringify({
        compiled: false,
        members: inputs.members.length,
        sourceFiles: inputs.members.reduce((count, member) => count + member.files, 0),
        vendorFiles: inputs.vendor.files,
        inputsSHA256: inputKey(inputs),
        activeSourceReplacement: inputs.activeSourceReplacement,
        command: [inputs.toolchain.cargo, ...buildArgs],
      }),
    );
  } else if (action === "build") await build();
  else if (action === "help")
    console.log(
      "cargo-build-proof.ts status|plan|build; build observes actual serialized offline Cargo output before issuing a bound receipt.",
    );
  else throw new Error("Use status, plan or build.");
}
