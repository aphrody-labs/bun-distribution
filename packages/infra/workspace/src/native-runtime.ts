// SPDX-License-Identifier: Apache-2.0
/** Activate a pinned precompiled buv runtime through its SDK release owner. */
import { lstat, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ArtifactPin {
  target: string;
  version: string;
  abi: string;
  revision: string;
  manifestSha256: string;
}
interface RuntimeContract {
  requiredCapabilities: string[];
  artifacts: ArtifactPin[];
}
interface NativeManifest {
  name: string;
  version: string;
  target: string;
  abi: string;
  files: Record<string, { bytes: number; sha256: string }>;
  sources: {
    bun?: { rev: string; dirty: boolean };
    yolo?: { rev: string; dirty: boolean };
  };
  build: { panicRecovery: boolean };
}
interface NativeBuild {
  name: string;
  version: string;
  abi: string;
  target: string;
  git_rev: string;
  panic_recovery: boolean;
}
interface RuntimeSdk {
  hostTarget(): string;
  runtimeHome(): string;
  verifyArtifactAsync(directory: string): Promise<unknown>;
  loadArtifactAsync(directory: string): Promise<{
    buildInfo(): NativeBuild;
    capabilities(): string[];
    close(): void;
  }>;
  installArtifact(
    directory: string,
    options: { home: string; manifestSha256: string },
  ): Promise<string>;
  rollbackArtifact(options: { home: string; manifestSha256: string }): Promise<unknown>;
}
export interface NativeRuntimeOptions {
  root: string;
  action: "install" | "verify" | "rollback";
  artifact?: string;
  runtimeHome?: string;
  yolo?: string;
  bunCheckout?: string;
  apply?: boolean;
}

const digest = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function regular(path: string) {
  const status = await lstat(path);
  if (!status.isFile()) throw new Error("Expected a regular runtime file: " + path);
  return status;
}
async function realDirectory(path: string) {
  if (!(await lstat(path)).isDirectory()) throw new Error("Expected a real directory: " + path);
}
async function runtimeSdk(root: string, checkout?: string): Promise<RuntimeSdk> {
  const selected = checkout || process.env["APHRODY_BUN_CHECKOUT"];
  let artifact: string;
  let release: string;
  if (selected) {
    const sdk = resolve(root, selected, "packages/bun-runtime-sdk/src");
    artifact = pathToFileURL(join(sdk, "artifact.ts")).href;
    release = pathToFileURL(join(sdk, "release.ts")).href;
  } else {
    artifact = import.meta.resolve("@aphrody/buv/runtime-artifact");
    release = import.meta.resolve("@aphrody/buv/runtime-release");
  }
  const modules = await Promise.all([import(artifact), import(release)]);
  return { ...modules[0], ...modules[1] } as RuntimeSdk;
}

function readContract(value: unknown): RuntimeContract {
  const contract = value as RuntimeContract | undefined;
  if (
    !contract ||
    !Array.isArray(contract.requiredCapabilities) ||
    !contract.requiredCapabilities.length ||
    contract.requiredCapabilities.some(
      (capability) => typeof capability !== "string" || !capability,
    ) ||
    !Array.isArray(contract.artifacts) ||
    !contract.artifacts.length ||
    contract.artifacts.some(
      (pin) =>
        !pin ||
        !/^[a-z0-9_-]+$/.test(pin.target) ||
        !/^\d+\.\d+\.\d+$/.test(pin.version) ||
        !/^\d+\.\d+$/.test(pin.abi) ||
        !/^[a-f0-9]{40}$/.test(pin.revision) ||
        !/^[a-f0-9]{64}$/.test(pin.manifestSha256),
    )
  )
    throw new Error("Missing or invalid pinned native runtime contract");
  return contract;
}

async function inspectArtifact(directory: string, contract: RuntimeContract, sdk: RuntimeSdk) {
  await realDirectory(directory);
  const manifestPath = join(directory, "manifest.json");
  await regular(manifestPath);
  const bytes = await readFile(manifestPath);
  const manifestSha256 = digest(bytes);
  const pin = contract.artifacts.find(
    (candidate) =>
      candidate.target === sdk.hostTarget() && candidate.manifestSha256 === manifestSha256,
  );
  if (!pin) throw new Error("Runtime artifact is not pinned for this host");
  const manifest = JSON.parse(bytes.toString()) as NativeManifest;
  const source = manifest.name === "buv-runtime" ? manifest.sources?.bun : manifest.sources?.yolo;
  if (
    (manifest.name !== "buv-runtime" && manifest.name !== "yolo-runtime") ||
    manifest.target !== pin.target ||
    manifest.version !== pin.version ||
    manifest.abi !== pin.abi ||
    source?.rev !== pin.revision ||
    source?.dirty !== false ||
    manifest.build?.panicRecovery !== true
  )
    throw new Error("Runtime manifest differs from the pinned clean, recoverable build");
  await Promise.all(
    Object.entries(manifest.files).map(async ([name, file]) => {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..")
        throw new Error("Unsafe runtime manifest path");
      const status = await regular(join(directory, name));
      if (status.size !== file.bytes) throw new Error("Runtime file size differs: " + name);
    }),
  );
  // The SDK owns file checksums, target validation and ABI negotiation.
  const runtime = await sdk.loadArtifactAsync(directory);
  try {
    const build = runtime.buildInfo();
    const capabilities = runtime.capabilities();
    if (
      build.name !== manifest.name ||
      build.version !== pin.version ||
      build.target !== pin.target ||
      build.abi !== pin.abi ||
      !/^[a-f0-9]{12,40}$/.test(build.git_rev) ||
      !pin.revision.startsWith(build.git_rev) ||
      !build.panic_recovery
    )
      throw new Error("Loaded runtime differs from its pinned manifest");
    const missing = contract.requiredCapabilities.filter(
      (capability) => !capabilities.includes(capability),
    );
    if (missing.length) throw new Error("Runtime capabilities missing: " + missing.join(", "));
    const library = Object.entries(manifest.files).find(([name]) => /\.(so|dylib|dll)$/.test(name));
    if (!library) throw new Error("Runtime manifest has no shared library");
    const installationName = pin.version + "-" + library[1].sha256.slice(0, 8);
    return {
      directory,
      installationName,
      manifestSha256,
      revision: pin.revision,
      build,
      capabilities,
    };
  } finally {
    runtime.close();
  }
}

async function selectedDirectory(home: string, target: string, which: "current" | "previous") {
  const name = await readlink(join(home, target, which)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("No installed " + which + " native runtime");
    throw error;
  });
  const slot = basename(name);
  if (
    !/^\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(slot) ||
    (isAbsolute(name) ? resolve(name) !== resolve(home, target, slot) : name !== slot)
  )
    throw new Error("Unsafe runtime slot target");
  return join(home, target, slot);
}

export async function acquireNativeRuntime(options: NativeRuntimeOptions) {
  const root = resolve(options.root);
  const contract = readContract(
    JSON.parse(await readFile(join(root, "tools/config/native-runtime.json"), "utf8")),
  );
  if (options.action !== "install" && options.action !== "verify" && options.action !== "rollback")
    throw new Error("Expected install, verify or rollback");
  if (options.action === "install" && !options.artifact)
    throw new Error("install requires --artifact");
  const sdk = await runtimeSdk(root, options.bunCheckout);
  const home = resolve(options.runtimeHome ?? sdk.runtimeHome());
  let lock: string | undefined;
  try {
    const target = sdk.hostTarget();
    if (!contract.artifacts.some((pin) => pin.target === target))
      throw new Error("No qualified native runtime pin for " + target);
    if (options.apply && options.action !== "verify") {
      await mkdir(home, { recursive: true });
      await realDirectory(home);
      const candidate = join(home, ".consumer-acquisition.lock");
      await mkdir(candidate);
      lock = candidate;
    }
    const before =
      options.action === "install"
        ? await inspectArtifact(resolve(options.artifact!), contract, sdk)
        : await inspectArtifact(
            await selectedDirectory(
              home,
              target,
              options.action === "rollback" ? "previous" : "current",
            ),
            contract,
            sdk,
          );
    if (!options.apply || options.action === "verify")
      return {
        schema: "aphrody.native-runtime/1",
        action: options.action,
        applied: false,
        runtime: before,
      };
    if (options.action === "install") {
      const destination = join(home, target, before.installationName);
      const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing) {
        const installed = await inspectArtifact(destination, contract, sdk);
        if (installed.manifestSha256 !== before.manifestSha256)
          throw new Error("Installed runtime directory conflicts with the requested artifact");
      }
    }
    if (options.action === "install")
      await sdk.installArtifact(before.directory, {
        home,
        manifestSha256: before.manifestSha256,
      });
    else
      await sdk.rollbackArtifact({
        home,
        manifestSha256: before.manifestSha256,
      });
    const after = await inspectArtifact(
      await selectedDirectory(home, target, "current"),
      contract,
      sdk,
    );
    if (after.manifestSha256 !== before.manifestSha256)
      throw new Error("buv release owner selected an unexpected runtime");
    return {
      schema: "aphrody.native-runtime/1",
      action: options.action,
      applied: true,
      runtime: after,
    };
  } finally {
    if (lock) await rm(lock, { recursive: true, force: true });
  }
}

export async function runNativeRuntime(input: readonly string[]): Promise<number> {
  const args = [...input];
  if (args.includes("--help")) {
    console.log(
      "Usage: yolo ops native-runtime install|verify|rollback [--root DIR] [--artifact DIR] [--runtime-home DIR] [--bun-checkout DIR] [--apply]. Uses pinned artifacts and the buv SDK directly. Default: verify without activation.",
    );
    return 0;
  }
  const options: NativeRuntimeOptions = {
    root: process.cwd(),
    action: (args.shift() ?? "verify") as NativeRuntimeOptions["action"],
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--apply") options.apply = true;
    else {
      const keys: Record<string, "root" | "artifact" | "runtimeHome" | "yolo" | "bunCheckout"> = {
        "--root": "root",
        "--artifact": "artifact",
        "--runtime-home": "runtimeHome",
        "--yolo": "yolo",
        "--bun-checkout": "bunCheckout",
      };
      const key = keys[arg ?? ""];
      if (!key) throw new Error("Unknown option: " + arg);
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
      options[key] = value;
    }
  }
  console.log(JSON.stringify(await acquireNativeRuntime(options), null, 2));
  return 0;
}

if (import.meta.main) process.exit(await runNativeRuntime(Bun.argv.slice(2)));
