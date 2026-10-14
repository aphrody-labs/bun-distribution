import { exportPinnedSources, type SourceExportOptions } from "../factory/source-export.ts";
import { hashStream } from "@aphrody/bun-workspace/hash";
import { runProcess } from "@aphrody/bun-workspace/process";
import { mkdir, lstat, copyFile, open, unlink, cp } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { sourceIntegrity } from "../container/source-integrity.ts";
import { inspectLinuxABI } from "./elf.ts";

export const packageRoot = resolve(import.meta.dir, "..");
export function materialCheckout(config: Config = {}): string {
  const checkout = resolve(config.checkouts?.material ?? join(packageRoot, "libraries/material"));
  if (
    !existsSync(join(checkout, "crates/libm3/Cargo.toml")) ||
    !existsSync(join(checkout, "crates/m3-tokens/Cargo.toml"))
  )
    throw new Error("Configure checkouts.material with the canonical Material Rust workspace");
  return checkout;
}
export function runtimeCheckout(config: Config = {}): string {
  const explicitCheckout = config.checkouts?.bun;
  const configured = explicitCheckout ?? Bun.env.APHRODY_BUN_CHECKOUT;
  const workspaceCheckout = resolve(packageRoot, "toolchains/bun");
  if (configured) {
    const root = resolve(configured);
    if (!existsSync(join(root, "scripts/build.ts")))
      throw new Error("Configured Bun checkout has no native build owner");
    if (!explicitCheckout && existsSync(join(workspaceCheckout, "scripts/build.ts"))) {
      try {
        if (realpathSync.native(root) === realpathSync.native(workspaceCheckout))
          return workspaceCheckout;
      } catch {
        // Keep the explicit checkout when its physical path cannot be resolved.
      }
    }
    return root;
  }
  if (existsSync(join(workspaceCheckout, "scripts/build.ts"))) return workspaceCheckout;
  let root = dirname(process.execPath);
  for (let depth = 0; depth < 8; depth++) {
    if (
      existsSync(join(root, "scripts/build.ts")) &&
      existsSync(join(root, "src/runtime/Cargo.toml"))
    )
      return root;
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  throw new Error(
    "Configure checkouts.bun or APHRODY_BUN_CHECKOUT; no runtime checkout could be resolved",
  );
}
export type Profile = "full" | "perf";
export type Target = "linux-x64" | "linux-arm64" | "windows-x64" | "macos-arm64" | "wasm";
export interface Source {
  id: string;
  repository: string;
  revision: string;
  mount: string;
  parent?: string;
  submodulePath?: string;
  branch?: string;
  gitlinks: { path: string; revision: string; repository: string }[];
}
export interface SourceLock {
  schemaVersion: 1;
  repositories: Source[];
}
export interface Config {
  checkouts?: Record<string, string>;
  cargoCommand?: string[];
  sourceExport?: Omit<SourceExportOptions, "lock" | "checkouts">;
}

async function inspectLockedCheckout(checkout: string, revision: string) {
  try {
    const [head, status] = await Promise.all([
      runProcess(["git", "rev-parse", "HEAD"], checkout, {
        timeoutMs: 15_000,
        maxOutputBytes: 4096,
      }),
      runProcess(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
        checkout,
        {
          timeoutMs: 15_000,
          maxOutputBytes: 1024 * 1024,
        },
      ),
    ]);
    if (head.code !== 0 || status.code !== 0) throw new Error("checkout inspection failed");
    const checkoutRevision = head.stdout.trim();
    const clean = status.stdout.length === 0;
    const matchesLock = checkoutRevision === revision;
    return {
      lockedRevision: revision,
      checkoutRevision,
      clean,
      matchesLock,
      eligible: clean && matchesLock,
      state: !matchesLock ? "revision-mismatch" : clean ? "pinned-clean" : "pinned-dirty",
    };
  } catch {
    return {
      lockedRevision: revision,
      checkoutRevision: null,
      clean: false,
      matchesLock: false,
      eligible: false,
      state: "inspection-failed",
    };
  }
}

function cargoOwner(config: Config): string[] {
  if (config.cargoCommand?.length) return config.cargoCommand;
  const checkout = runtimeCheckout(config);
  const wrapper = join(checkout, "scripts/build/rust/cargo-serial.ts");
  if (!existsSync(wrapper))
    throw new Error("Configure the serialized native Cargo owner in cargoCommand");
  return [process.execPath, wrapper];
}
export interface RuntimeReceipt {
  schemaVersion: 1;
  repository: "aphrody-labs/bun";
  revision: string;
  version: string;
  target: Exclude<Target, "wasm">;
  abi: "gnu" | "msvc" | "darwin";
  sha256: string;
  bytes: number;
  qualification: { passed: boolean; gates: string[] };
}

export async function command(
  cmd: string[],
  cwd = packageRoot,
  timeout = 120_000,
): Promise<string> {
  const env = { ...Bun.env };
  for (const name of ["RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"]) {
    const wrapper = env[name];
    if (wrapper && !Bun.which(wrapper, { cwd })) {
      delete env[name];
      console.error(`Ignoring missing ${name} for this factory command`);
    }
  }
  const { stdout, stderr, code } = await runProcess(cmd, cwd, {
    env,
    timeoutMs: timeout,
    maxOutputBytes: 128 * 1024 * 1024,
  });
  if (code !== 0) throw new Error(`${cmd[0]} failed (${code}): ${(stderr || stdout).slice(-3000)}`);
  return stdout.trim();
}

function contained(root: string, path: string): string {
  const result = resolve(root, path);
  const rel = relative(root, result);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  )
    throw new Error(`Path must be inside the artifact root: ${path}`);
  return result;
}

export async function readLock(): Promise<SourceLock> {
  const lock: SourceLock = await Bun.file(join(packageRoot, "sources.lock.json")).json();
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.repositories) || !lock.repositories.length)
    throw new Error("Invalid or empty source lock");
  const seen = new Set<string>();
  const mounts = new Set<string>();
  for (const source of lock.repositories) {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
      !/^[a-f0-9]{40}$/.test(source.revision) ||
      seen.has(source.id)
    )
      throw new Error(`Invalid source identity: ${source.id}`);
    contained(packageRoot, source.mount);
    if (!source.mount.startsWith("sources/") || mounts.has(source.mount))
      throw new Error(`Invalid source mount: ${source.mount}`);
    if (source.parent && !seen.has(source.parent))
      throw new Error(`Parent must precede source: ${source.id}`);
    seen.add(source.id);
    mounts.add(source.mount);
  }
  for (const source of lock.repositories) {
    if (!Array.isArray(source.gitlinks))
      throw new Error(`Missing verified gitlink inventory: ${source.id}`);
    const children = lock.repositories.filter((item) => item.parent === source.id);
    if (children.length !== source.gitlinks.length)
      throw new Error(`Incomplete submodule assembly: ${source.id}`);
    for (const link of source.gitlinks) {
      const child = children.find((item) => item.submodulePath === link.path);
      if (
        !child ||
        child.revision !== link.revision ||
        child.repository !== link.repository ||
        child.mount !== `${source.mount}/${link.path}`
      )
        throw new Error(`Unpinned submodule: ${source.id}/${link.path}`);
    }
  }
  for (const id of ["bun", "material", "cosmic-epoch", "libcosmic"])
    if (!seen.has(id)) throw new Error(`Missing distribution owner ${id}`);
  return lock;
}

export async function identity(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Expected a regular artifact: ${path}`);
  return contentIdentity(Bun.file(path));
}

export async function contentIdentity(blob: Blob) {
  return {
    bytes: blob.size,
    sha256: await hashStream(blob.stream(), { maxBytes: blob.size, expectedBytes: blob.size }),
  };
}

export async function plan(profile: Profile, target: Target, config: Config = {}) {
  const manifest = await Bun.file(join(packageRoot, "distribution.json")).json();
  const sources = await readLock();
  const runtimeSource = sources.repositories.find((source) => source.id === "bun")!;
  const runtime = runtimeCheckout(config);
  return {
    ...manifest,
    selectedProfile: profile,
    selectedTarget: target,
    sourceRepositories: sources.repositories.length,
    sourceRevisions: sources.repositories.map(({ id, repository, revision, mount }) => ({
      id,
      repository,
      revision,
      mount,
    })),
    runtimeBuild: {
      cwd: runtime,
      argv: [process.execPath, "bd", "--release"],
      source: await inspectLockedCheckout(runtime, runtimeSource.revision),
    },
    materialBuild: {
      cwd: materialCheckout(config),
      argv: [
        "cargo",
        "build",
        "--manifest-path",
        join(materialCheckout(config), "Cargo.toml"),
        "-p",
        "libm3",
        "--release",
        "--target",
        manifest.targets[target].rust,
      ],
    },
    qualification: "unqualified: commands and source pins alone do not prove a distribution build",
  };
}

/** Full pinned source export stays with one factory owner. */
export async function assembleSources(output: string, config: Config) {
  if (!config.sourceExport?.estimates)
    throw new Error(
      "Configure sourceExport.estimates from the source-owner byte and inode inventory",
    );
  return exportPinnedSources(output, {
    ...config.sourceExport,
    lock: await readLock(),
    checkouts: { bun: runtimeCheckout(config), ...config.checkouts },
  });
}

export async function stageRuntime(
  output: string,
  binary: string,
  receiptPath: string,
  profile: Profile,
  target: Exclude<Target, "wasm">,
) {
  const receipt: RuntimeReceipt = await Bun.file(receiptPath).json();
  const lock = await readLock();
  const source = lock.repositories.find((item) => item.id === "bun")!;
  const digest = await identity(binary);
  const linux = target === "linux-x64" || target === "linux-arm64";
  const expectedABI = linux ? "gnu" : target === "windows-x64" ? "msvc" : "darwin";
  if (receipt.abi !== expectedABI) throw new Error(`Runtime ABI must be ${expectedABI}`);
  const binaryABI = linux
    ? await inspectLinuxABI(binary, target === "linux-x64" ? "x64" : "arm64")
    : undefined;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.repository !== "aphrody-labs/bun" ||
    receipt.revision !== source.revision ||
    receipt.target !== target ||
    receipt.version !== "1.4.4" ||
    receipt.sha256 !== digest.sha256 ||
    receipt.bytes !== digest.bytes ||
    !receipt.qualification?.passed ||
    !receipt.qualification.gates.includes("native-runtime")
  )
    throw new Error(
      "Bun runtime must match the locked source, target, checksum and a passed native-runtime qualification",
    );
  const sourcesReceipt = await Bun.file(join(output, "sources.receipt.json")).json();
  if (
    !sourcesReceipt.complete ||
    JSON.stringify(sourcesReceipt.repositories.map((s: Source) => [s.id, s.revision])) !==
      JSON.stringify(lock.repositories.map((s) => [s.id, s.revision]))
  )
    throw new Error("Stage requires a complete source assembly matching the source lock");
  const contents = await sourceIntegrity(join(output, "sources"));
  if (contents.treeSHA256 !== sourcesReceipt.treeSHA256)
    throw new Error("Assembled source content changed after export");
  await mkdir(join(output, "runtime"), { recursive: true });
  await copyFile(binary, join(output, "runtime", target === "windows-x64" ? "bun.exe" : "bun"));
  await Bun.write(join(output, "runtime", "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  const manifest = await Bun.file(join(packageRoot, "distribution.json")).json();
  await Bun.write(
    join(output, "distribution.json"),
    JSON.stringify(
      {
        ...manifest,
        profile,
        target,
        runtime: receipt,
        binaryABI,
        qualification: "runtime-qualified; desktop and image remain unqualified",
      },
      null,
      2,
    ) + "\n",
  );
  await copyFile(join(packageRoot, "container", "Dockerfile"), join(output, "Dockerfile"));
  await copyFile(join(packageRoot, "container", ".dockerignore"), join(output, ".dockerignore"));
  await cp(join(packageRoot, "container"), join(output, "container"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await mkdir(join(output, "wasm"), { recursive: true });
}

export async function buildWasm(output: string, config: Config) {
  const material = materialCheckout(config);
  const claim = await open(join(packageRoot, ".factory.lock"), "wx");
  await claim.writeFile(`${process.pid}\n`);
  try {
    const targetDir = resolve(output, ".cargo-wasm");
    await command(
      [
        ...cargoOwner(config),
        "build",
        "--locked",
        "--manifest-path",
        join(material, "Cargo.toml"),
        "-p",
        "libm3-wasm",
        "--release",
        "--target",
        "wasm32-unknown-unknown",
        "--target-dir",
        targetDir,
        "-j",
        "2",
      ],
      material,
      1_800_000,
    );
    const artifact = join(targetDir, "wasm32-unknown-unknown/release/libm3_wasm.wasm");
    const digest = await identity(artifact);
    const magic = await Bun.file(artifact).slice(0, 8).bytes();
    if (
      magic.length !== 8 ||
      magic[0] !== 0 ||
      magic[1] !== 97 ||
      magic[2] !== 115 ||
      magic[3] !== 109
    )
      throw new Error("Missing valid WASM artifact");
    await mkdir(join(output, "wasm"), { recursive: true });
    await copyFile(artifact, join(output, "wasm/libm3.wasm"));
    const sourceFiles = [];
    for (const path of ["Cargo.toml", "Cargo.lock"])
      sourceFiles.push({ path, ...(await identity(join(material, path))) });
    for await (const path of new Bun.Glob(
      "crates/{m3-tokens,m3,libm3,libm3-wasm}/**/*.{rs,toml}",
    ).scan({
      cwd: material,
      onlyFiles: true,
    }))
      sourceFiles.push({
        path: path.replaceAll("\\", "/"),
        ...(await identity(join(material, path))),
      });
    sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
    const receipt = {
      schemaVersion: 1,
      kind: "libm3-wasm",
      sourceRepository: "aphrody-labs/material",
      sourceRevision: await command(["git", "rev-parse", "HEAD"], material),
      sourceDirty: Boolean(
        await command(
          ["git", "status", "--porcelain", "--", "Cargo.toml", "Cargo.lock", "crates"],
          material,
        ),
      ),
      sourceFiles,
      target: "wasm32-unknown-unknown",
      compiler: await command(["rustc", "--version"]),
      ...digest,
      bunRuntimeWasm: false,
    };
    await Bun.write(join(output, "wasm/receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } finally {
    await claim.close();
    await unlink(join(packageRoot, ".factory.lock"));
  }
}

export async function buildImage(output: string, profile: Profile, target: Target, tag: string) {
  if (target !== "linux-x64" && target !== "linux-arm64")
    throw new Error("Docker images require a Linux target");
  if (target === "linux-arm64")
    throw new Error(
      "The COSMIC package lock currently covers amd64; ARM64 needs its own verified package inventory",
    );
  const receipt = await Bun.file(join(output, "distribution.json")).json();
  if (receipt.profile !== profile || receipt.target !== target)
    throw new Error("Image profile and target must match the staged artifact");
  if (!/^[a-z0-9][a-z0-9._/:@-]+$/.test(tag)) throw new Error("Invalid OCI image tag");
  await command(
    [
      "docker",
      "buildx",
      "build",
      "--load",
      "--platform",
      target === "linux-x64" ? "linux/amd64" : "linux/arm64",
      "--target",
      profile,
      "--tag",
      tag,
      "--build-arg",
      `SOURCE_REVISION=${receipt.runtime.revision}`,
      "--build-arg",
      `DISTRIBUTION_VERSION=${receipt.version}`,
      resolve(output),
    ],
    packageRoot,
    3_600_000,
  );
  const image = JSON.parse(await command(["docker", "image", "inspect", tag]));
  const smoke = await command([
    "docker",
    "run",
    "--rm",
    "--network=none",
    "--entrypoint",
    "/usr/local/bin/bun",
    tag,
    "--version",
  ]);
  if (smoke !== "1.4.4") throw new Error(`Image Bun version mismatch: ${smoke}`);
  const result = {
    schemaVersion: 1,
    kind: "bun-os-image",
    profile,
    target,
    tag,
    imageId: image[0].Id,
    bytes: image[0].Size,
    runtimeSmoke: smoke,
    desktopQualified: false,
  };
  await Bun.write(join(output, "image.receipt.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}
