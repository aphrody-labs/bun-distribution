#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { hashFile, loadConfig, repositoryRoot, runNative, runProcess } from "@aphrody/bun-workspace";
import { cargoBuildQualification } from "./cargo-build-proof.ts";

interface LockedPackage {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
}
interface Snapshot {
  lockSHA256: string;
  manifestSHA256: string;
  toolchainChannel: string;
  toolchainSHA256: string;
  sourceLockSHA256: string;
  gitmodulesSHA256: string;
  activeConfigSHA256: string;
  members: string[];
  memberSHA256: Record<string, string>;
  packages: LockedPackage[];
}
interface CargoPackage {
  id: string;
  name: string;
  version: string;
  source: string | null;
  license: string | null;
  license_file: string | null;
  manifest_path: string;
}
interface Metadata {
  workspace_root: string;
  workspace_members: string[];
  packages: CargoPackage[];
}
const state = join(repositoryRoot, "build/vendor");
const destination = join(repositoryRoot, "vendor/cargo");
const proposal = join(repositoryRoot, "docs/vendor/source-replacement.toml");

async function snapshot(): Promise<Snapshot> {
  const manifest = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "Cargo.toml")).text()) as {
    workspace: { members: string[] };
  };
  const lock = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "Cargo.lock")).text()) as {
    package: LockedPackage[];
  };
  const memberSHA256: Record<string, string> = {};
  const toolchain = Bun.TOML.parse(await Bun.file(join(repositoryRoot, "rust-toolchain.toml")).text()) as {
    toolchain: { channel: string };
  };
  for (const member of manifest.workspace.members) {
    if (!/^crates\/[A-Za-z0-9_-]+$/.test(member))
      throw new Error("Cargo member is outside the flat product crate owner.");
    memberSHA256[member] = await hashFile(join(repositoryRoot, member, "Cargo.toml"));
  }
  return {
    lockSHA256: await hashFile(join(repositoryRoot, "Cargo.lock")),
    manifestSHA256: await hashFile(join(repositoryRoot, "Cargo.toml")),
    toolchainChannel: toolchain.toolchain.channel,
    toolchainSHA256: await hashFile(join(repositoryRoot, "rust-toolchain.toml")),
    sourceLockSHA256: await hashFile(join(repositoryRoot, "sources.lock.json")),
    gitmodulesSHA256: await hashFile(join(repositoryRoot, ".gitmodules")),
    activeConfigSHA256: await hashFile(join(repositoryRoot, ".cargo/config.toml")),
    members: manifest.workspace.members,
    memberSHA256,
    packages: lock.package,
  };
}
async function unchanged(expected: Snapshot): Promise<void> {
  const actual = await snapshot();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Cargo owner manifests or locked graph changed; prepare a new vendor plan.");
}
async function cargo(args: string[]): Promise<string> {
  const executable = Bun.which("cargo");
  if (!executable) throw new Error("Cargo is unavailable.");
  const result = await runProcess([executable, ...args], repositoryRoot, {
    timeoutMs: 25000,
    maxOutputBytes: 64 * 1024 * 1024,
    env: { ...Bun.env, CARGO_TERM_COLOR: "never" },
  });
  if (result.code) {
    await Bun.write(join(state, "cargo-failure.log"), result.stderr);
    throw new Error("Cargo operation failed; inspect build/vendor/cargo-failure.log.");
  }
  return result.stdout;
}
async function plan(): Promise<void> {
  const inputs = await snapshot();
  const external = inputs.packages.filter(pkg => pkg.source);
  const wanted = new Map(
    external
      .filter(pkg => pkg.source!.startsWith("registry+"))
      .map(pkg => [pkg.name + "-" + pkg.version + ".crate", pkg]),
  );
  const cargoHome = Bun.env.CARGO_HOME ?? join(Bun.env.USERPROFILE ?? Bun.env.HOME ?? "", ".cargo");
  const cached = new Set<string>();
  let cachedCompressedBytes = 0;
  for await (const path of new Bun.Glob("registry/cache/*/*.crate").scan({ cwd: cargoHome, onlyFiles: true })) {
    const name = basename(path);
    if (!wanted.has(name) || cached.has(name)) continue;
    cached.add(name);
    cachedCompressedBytes += Bun.file(join(cargoHome, path)).size;
  }
  const summary = {
    members: inputs.members.length,
    lockedPackages: inputs.packages.length,
    remotePackages: external.length,
    registryPackages: wanted.size,
    gitPackages: external.filter(pkg => pkg.source!.startsWith("git+")).length,
    cachedPackages: cached.size,
    missingRegistryArchives: [...wanted.keys()].filter(name => !cached.has(name)),
    cachedCompressedBytes,
    volumePolicy: { maxExpandedBytes: 2 * 1024 ** 3, installSources: "vendor/cargo", downloadsStarted: false },
  };
  await Bun.write(
    join(state, "cargo-plan.json"),
    JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), inputs, summary }, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
}
async function planned(): Promise<Snapshot> {
  const value = (await Bun.file(join(state, "cargo-plan.json")).json()) as { inputs: Snapshot };
  await unchanged(value.inputs);
  return value.inputs;
}
async function prepare(): Promise<void> {
  const inputs = await planned();
  // Keep partial copies resumable; do not purge any cache or imported vendor owner.
  const config = await cargo(["vendor", "--locked", "--versioned-dirs", "--no-delete", destination]);
  if (!config.includes("[source.")) throw new Error("Cargo did not emit its source replacement configuration.");
  await unchanged(inputs);
  await mkdir(join(repositoryRoot, "docs/vendor"), { recursive: true });
  const staged = config.replace(/^directory\s*=.*$/gm, 'directory = "vendor/cargo"');
  await Bun.write(proposal, staged);
  const temporary = staged.replace(
    /directory = "[^"]+"/,
    "directory = " + JSON.stringify(destination.replaceAll("\\", "/")),
  );
  await Bun.write(join(state, "cargo-config.toml"), temporary);
  console.log(
    JSON.stringify({
      prepared: true,
      activeSourceReplacement: false,
      remotePackages: inputs.packages.filter(pkg => pkg.source).length,
    }),
  );
}
async function verify(): Promise<void> {
  const inputs = await planned();
  const metadata = JSON.parse(
    await cargo([
      "--config",
      join(state, "cargo-config.toml"),
      "metadata",
      "--locked",
      "--offline",
      "--all-features",
      "--format-version",
      "1",
    ]),
  ) as Metadata;
  await Bun.write(join(state, "cargo-metadata.json"), JSON.stringify(metadata));
  if (resolve(metadata.workspace_root) !== resolve(repositoryRoot))
    throw new Error("Offline Cargo workspace owner differs.");
  if (metadata.workspace_members.length !== inputs.members.length)
    throw new Error("Offline workspace member count differs.");
  const expected = inputs.packages.map(pkg => JSON.stringify([pkg.name, pkg.version, pkg.source ?? null])).sort();
  const observed = metadata.packages.map(pkg => JSON.stringify([pkg.name, pkg.version, pkg.source])).sort();
  if (JSON.stringify(expected) !== JSON.stringify(observed))
    throw new Error("Offline vendored graph differs from Cargo.lock.");
  const records = [];
  let bytes = 0;
  let files = 0;
  for (const pkg of metadata.packages.filter(pkg => pkg.source)) {
    const packageRoot = resolve(pkg.manifest_path, "..");
    const local = relative(destination, packageRoot);
    if (local.startsWith("..") || local.includes("/") || local.includes("\\"))
      throw new Error("Vendored package leaves its source directory.");
    const checksum = (await Bun.file(join(packageRoot, ".cargo-checksum.json")).json()) as {
      package: string | null;
      files: Record<string, string>;
    };
    const locked = inputs.packages.find(
      value => value.name === pkg.name && value.version === pkg.version && value.source === pkg.source,
    )!;
    if (locked.checksum && checksum.package !== locked.checksum)
      throw new Error("Vendored package archive checksum differs.");
    const licenses = [];
    for (const [path, digest] of Object.entries(checksum.files)) {
      if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
        throw new Error("Source checksum path leaves its package.");
      const file = join(packageRoot, path);
      const info = await stat(file);
      bytes += info.size;
      files++;
      if (bytes > 2 * 1024 ** 3) throw new Error("Vendor snapshot exceeds the expanded source volume policy.");
      if (path === "Cargo.toml" || /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)([^/]*$)/i.test(path)) {
        if ((await hashFile(file)) !== digest) throw new Error("Vendored manifest or source notice checksum differs.");
        if (path !== "Cargo.toml") licenses.push({ path, sha256: digest });
      }
    }
    if (pkg.license_file) {
      const licenseFile = resolve(packageRoot, pkg.license_file);
      const license = relative(packageRoot, licenseFile).replaceAll("\\", "/");
      if (license.startsWith("..") || !checksum.files[license])
        throw new Error("Declared source license file is unavailable.");
      if ((await hashFile(licenseFile)) !== checksum.files[license])
        throw new Error("Declared source license file differs.");
    }
    records.push({
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      license: pkg.license,
      licenseFile: pkg.license_file
        ? relative(packageRoot, resolve(packageRoot, pkg.license_file)).replaceAll("\\", "/")
        : null,
      directory: local,
      archiveSHA256: checksum.package,
      notices: licenses,
      manifestSHA256: checksum.files["Cargo.toml"],
    });
  }
  const directories = (await readdir(destination, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  if (JSON.stringify(directories) !== JSON.stringify(records.map(pkg => pkg.directory).sort()))
    throw new Error("Vendor contains unowned packages outside the locked graph.");
  await unchanged(inputs);
  const buildQualification = await cargoBuildQualification();
  const receipt = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    lockSHA256: inputs.lockSHA256,
    manifestSHA256: inputs.manifestSHA256,
    toolchainChannel: inputs.toolchainChannel,
    toolchainSHA256: inputs.toolchainSHA256,
    cargoVersion: (await cargo(["--version"])).trim(),
    sourceLockSHA256: inputs.sourceLockSHA256,
    gitmodulesSHA256: inputs.gitmodulesSHA256,
    activeConfigSHA256: inputs.activeConfigSHA256,
    memberCount: inputs.members.length,
    packageCount: records.length,
    sourceBytes: bytes,
    sourceFiles: files,
    packages: records,
    qualification: {
      cargoMetadataOffline: true,
      manifestsAndNoticesVerified: true,
      ...buildQualification,
      scope: "root product Cargo workspace only",
    },
  };
  await Bun.write(join(repositoryRoot, "docs/vendor/cargo-inventory.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify({
      verified: true,
      packages: records.length,
      bytes,
      files,
      memberCount: inputs.members.length,
      ...buildQualification,
    }),
  );
}

if (import.meta.main) {
  const [action = "help", worker] = Bun.argv.slice(2);
  if (!["plan", "prepare", "verify"].includes(action)) {
    if (action !== "help") throw new Error("Use plan, prepare or verify.");
    console.log("vendor-cargo.ts plan|prepare|verify; source replacement remains staged.");
  } else if (worker === "--worker") {
    await mkdir(state, { recursive: true });
    if (action === "plan") await plan();
    else if (action === "prepare") await prepare();
    else await verify();
  } else {
    const config = await loadConfig();
    process.exitCode = await runNative(config, [process.execPath, import.meta.path, action, "--worker"], {
      root: repositoryRoot,
      timeoutMs: 30000,
    });
  }
}
