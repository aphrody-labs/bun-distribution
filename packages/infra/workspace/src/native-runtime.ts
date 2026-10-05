// SPDX-License-Identifier: Apache-2.0
/** Activate a precompiled Yolo runtime verified by the workspace SDK and the Yolo release owner. */
import { lstat, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as workspaceSdk from "@aphrody/runtime-sdk/artifact";

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
  sources: { yolo: { rev: string; dirty: boolean } };
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
  verifyArtifact(directory: string): unknown;
  loadArtifact(directory: string): {
    buildInfo(): NativeBuild;
    capabilities(): string[];
    close(): void;
  };
}
const sdk: RuntimeSdk = workspaceSdk;
export interface NativeRuntimeOptions {
  root: string;
  action: "install" | "verify" | "rollback";
  artifact?: string;
  runtimeHome?: string;
  yolo?: string;
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
async function command(argv: string[], root: string, env?: NodeJS.ProcessEnv) {
  const child = Bun.spawn(argv, {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv[0]} ${argv[1]} failed: ${stderr.trim()}`);
  return stdout.trim();
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

async function inspectArtifact(directory: string, contract: RuntimeContract) {
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
  if (
    manifest.name !== "yolo-runtime" ||
    manifest.target !== pin.target ||
    manifest.version !== pin.version ||
    manifest.abi !== pin.abi ||
    manifest.sources?.yolo?.rev !== pin.revision ||
    manifest.sources.yolo.dirty !== false ||
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
  sdk.verifyArtifact(directory);
  const runtime = sdk.loadArtifact(directory);
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

async function selectedDirectory(home: string, target: string, slot: "current" | "previous") {
  const name = await readlink(join(home, target, slot)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("No installed " + slot + " native runtime");
    throw error;
  });
  if (!/^\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(name)) throw new Error("Unsafe runtime slot target");
  return join(home, target, name);
}

export async function acquireNativeRuntime(options: NativeRuntimeOptions) {
  const root = resolve(options.root);
  const contract = readContract(
    JSON.parse(await readFile(join(root, "config/native-runtime.json"), "utf8")),
  );
  if (options.action !== "install" && options.action !== "verify" && options.action !== "rollback")
    throw new Error("Expected install, verify or rollback");
  if (options.action === "install" && !options.artifact)
    throw new Error("install requires --artifact");
  const home = resolve(
    options.runtimeHome ??
      (process.env["YOLO_RUNTIME_HOME"] ||
        join(process.env["YOLO_HOME"] || join(homedir(), ".yolo"), "runtime")),
  );
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
        ? await inspectArtifact(resolve(options.artifact!), contract)
        : await inspectArtifact(
            await selectedDirectory(
              home,
              target,
              options.action === "rollback" ? "previous" : "current",
            ),
            contract,
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
        const installed = await inspectArtifact(destination, contract);
        if (installed.manifestSha256 !== before.manifestSha256)
          throw new Error("Installed runtime directory conflicts with the requested artifact");
      }
    }
    const executable =
      options.yolo ??
      process.env["APHRODY_YOLO_BIN"] ??
      Bun.which("yolo") ??
      join(root, "bin", process.platform === "win32" ? "yolo.exe" : "yolo");
    await command(
      options.action === "install"
        ? [executable, "runtime", "install", before.directory]
        : [executable, "runtime", "rollback"],
      root,
      { ...process.env, YOLO_RUNTIME_HOME: home },
    );
    const after = await inspectArtifact(await selectedDirectory(home, target, "current"), contract);
    if (after.manifestSha256 !== before.manifestSha256)
      throw new Error("Yolo release owner selected an unexpected runtime");
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
      "Usage: yolo ops native-runtime install|verify|rollback [--root DIR] [--artifact DIR] [--runtime-home DIR] [--yolo BIN] [--apply]. Uses the runtime pins of config/native-runtime.json, the workspace SDK and the Yolo release owner; no source checkout, Cargo or engine rebuild. Default: verify without activation.",
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
      const keys: Record<string, "root" | "artifact" | "runtimeHome" | "yolo"> = {
        "--root": "root",
        "--artifact": "artifact",
        "--runtime-home": "runtimeHome",
        "--yolo": "yolo",
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
