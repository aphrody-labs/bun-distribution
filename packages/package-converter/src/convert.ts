// SPDX-License-Identifier: MIT
import { mkdir, lstat, link, symlink, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { abi } from "./abi.ts";
import { inspect, readBounded, type InputOptions } from "./metadata.ts";
import {
  bunVersion,
  nativeAssets,
  runtimeDependencies,
  type RuntimeDependencies,
} from "./native-assets.ts";
import {
  LIMITS,
  safePath,
  sha256,
  type Inspection,
  type PackageRecord,
  type PayloadEntry,
} from "./types.ts";

export { inspect } from "./metadata.ts";

export interface ConversionOptions extends InputOptions {
  out: string;
  package: string;
  sourceBase?: string;
  extractSources?: boolean;
  windowsArtifact?: string;
  installerUrl?: string;
  wingetId?: string;
  publisher?: string;
  license?: string;
  windowsVersion?: string;
  runtimeDependencies?: Record<string, string>;
}

const yaml = (value: string) => JSON.stringify(value);

function selected(inspection: Inspection, name: string): PackageRecord {
  const matches = inspection.packages.filter((pkg) => pkg.name === name);
  if (matches.length !== 1)
    throw new Error(
      "Choose a package name with exactly one version in this input",
    );
  return matches[0]!;
}

function sourceUrls(pkg: PackageRecord, base?: string) {
  return pkg.sources.map((source) => {
    if (source.url || !base) return source;
    const directory = pkg.fields.directory?.[0];
    const path = safePath(`${directory ? `${directory}/` : ""}${source.path}`);
    const root = new URL(base.endsWith("/") ? base : `${base}/`);
    if (!/^https?:$/.test(root.protocol) || root.username || root.password)
      throw new Error("Source base must be public HTTP(S)");
    return {
      ...source,
      url: new URL(path.split("/").map(encodeURIComponent).join("/"), root)
        .href,
    };
  });
}

function targetPath(root: string, path: string): string {
  const target = resolve(root, safePath(path));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Output path escapes root");
  return target;
}

async function newFile(path: string, data: string | Uint8Array, mode?: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { flag: "wx", mode });
}

async function extract(root: string, entries: PayloadEntry[]) {
  const folded = new Set<string>();
  const key = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const byPath = new Map(entries.map((entry) => [key(entry.path), entry]));
  for (const entry of entries) {
    if (folded.has(key(entry.path)))
      throw new Error("Archive has colliding target paths");
    folded.add(key(entry.path));
    if (
      process.platform === "win32" &&
      entry.path
        .split("/")
        .some(
          (part) =>
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
            /[<>"|?*]|[ .]$/.test(part),
        )
    )
      throw new Error("Archive path is not representable on Windows");
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count++) {
      const ancestor = byPath.get(key(parts.slice(0, count).join("/")));
      if (ancestor && ancestor.kind !== "directory")
        throw new Error("Archive entry traverses a file or link ancestor");
    }
  }
  // Resolve the archive's complete link graph before creating any links or directories.
  // Lexical normalization alone misses paths which traverse an alias followed by '..'.
  const targets = new Map<string, string>();
  for (const entry of entries.filter(
    (entry) => entry.kind === "symlink" || entry.kind === "hardlink",
  )) {
    if (!entry.link || isAbsolute(entry.link) || /[\\:\0]/.test(entry.link))
      throw new Error("Payload link has an external target");
    let parts =
      entry.kind === "hardlink"
        ? entry.link.split("/")
        : [...entry.path.split("/").slice(0, -1), ...entry.link.split("/")];
    const resolved: string[] = [];
    let offset = 0;
    let expansions = 0;
    while (offset < parts.length) {
      const part = parts[offset++]!;
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!resolved.length)
          throw new Error("Payload link escapes output tree");
        resolved.pop();
        continue;
      }
      resolved.push(part);
      const node = byPath.get(key(resolved.join("/")));
      if (node?.kind === "symlink" || node?.kind === "hardlink") {
        if (++expansions > 64)
          throw new Error("Payload link cycle or chain exceeds limit");
        if (!node.link || isAbsolute(node.link) || /[\\:\0]/.test(node.link))
          throw new Error("Payload link has an external target");
        if (node.kind === "hardlink") resolved.length = 0;
        else resolved.pop();
        parts = [...node.link.split("/"), ...parts.slice(offset)];
        offset = 0;
      } else if (node?.kind === "file" && offset < parts.length)
        throw new Error("Payload link traverses a regular file");
    }
    const destination = resolved.join("/");
    if (
      entry.kind === "hardlink" &&
      byPath.get(key(destination))?.kind !== "file"
    )
      throw new Error("Payload hardlink needs a regular archive file target");
    targets.set(entry.path, destination);
  }
  await mkdir(root);
  for (const entry of entries.filter((entry) => entry.kind === "directory"))
    await mkdir(targetPath(root, entry.path), { recursive: true });
  for (const entry of entries.filter((entry) => entry.kind === "file"))
    await newFile(targetPath(root, entry.path), entry.data, entry.mode & 0o777);
  // Links are created after all regular files; hardlink chains resolve to their regular file owner.
  for (const entry of entries.filter(
    (entry) => entry.kind === "symlink" || entry.kind === "hardlink",
  )) {
    const destination = targetPath(root, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    if (entry.kind === "hardlink")
      await link(targetPath(root, targets.get(entry.path)!), destination);
    else await symlink(entry.link!, destination);
  }
}

function winget(
  options: ConversionOptions,
  pkg: PackageRecord,
  hash: string,
  architecture: string,
  dependencies: string[],
): string {
  if (
    !options.wingetId ||
    !/^[A-Za-z0-9][A-Za-z0-9+_-]*(?:\.[A-Za-z0-9][A-Za-z0-9+_-]*)+$/.test(
      options.wingetId,
    )
  )
    throw new Error("WinGet needs a Publisher.Package identifier");
  if (!options.publisher || !options.license || !options.installerUrl)
    throw new Error("WinGet needs publisher, license and installer URL");
  const url = new URL(options.installerUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Installer URL must be public HTTPS");
  if (!["x86", "x64", "arm", "arm64"].includes(architecture))
    throw new Error("Unsupported Windows architecture");
  const version = options.windowsVersion ?? pkg.version;
  if (
    !version ||
    version.length > 128 ||
    /[\\/:*?"<>|]/.test(version) ||
    Array.from(version).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error(
      "WinGet version needs --windows-version when the source version uses unsupported characters",
    );
  const deps = dependencies.length
    ? `Dependencies:\n  PackageDependencies:\n${dependencies.map((id) => `  - PackageIdentifier: ${yaml(id)}\n`).join("")}`
    : "";
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.singleton.1.12.0.schema.json\nPackageIdentifier: ${yaml(options.wingetId)}\nPackageVersion: ${yaml(version)}\nPackageLocale: en-US\nPublisher: ${yaml(options.publisher)}\nPackageName: ${yaml(pkg.name)}\nLicense: ${yaml(options.license)}\nShortDescription: ${yaml((pkg.description ?? pkg.name).split("\n")[0]!.slice(0, 256))}\n${deps}Installers:\n- Architecture: ${architecture}\n  InstallerType: portable\n  InstallerUrl: ${yaml(url.href)}\n  InstallerSha256: ${hash.toUpperCase()}\n  Commands:\n  - ${yaml(pkg.name)}\nManifestType: singleton\nManifestVersion: 1.12.0\n`;
}

/** Preserve native PE payloads; foreign ABI inputs retain an explicit Windows rebuild contract. */
export async function convert(
  path: string,
  options: ConversionOptions,
): Promise<string> {
  if (options.extractSources && options.format !== "source-archive")
    throw new Error("Source extraction requires --format source-archive");
  const { inspection, entries } = await inspect(path, options);
  const pkg = selected(inspection, options.package);
  const sources = sourceUrls(pkg, options.sourceBase);
  const assets = options.windowsArtifact
    ? undefined
    : nativeAssets(inspection, pkg, options.runtimeDependencies);
  let windows:
    | {
        bytes: Uint8Array;
        file: string;
        hash: string;
        architecture: string;
        imports: string[];
        runtime: string;
        dependencies: RuntimeDependencies;
      }
    | undefined;
  if (options.windowsArtifact) {
    const bytes = await readBounded(options.windowsArtifact, LIMITS.unpacked);
    const format = abi(bytes);
    if (
      format.format !== "pe" ||
      !format.executable ||
      ![2, 3].includes(format.subsystem ?? 0) ||
      !format.architecture ||
      !options.windowsArtifact.toLowerCase().endsWith(".exe")
    )
      throw new Error(
        "Windows export needs an actual PE executable, never an ELF archive, DLL or renamed data",
      );
    const dependencies = runtimeDependencies(
      format.imports ?? [],
      options.runtimeDependencies,
    );
    if (options.wingetId && Object.keys(dependencies.bun).length)
      throw new Error(
        "WinGet needs WinGet package owners for external DLLs; Bun package mappings do not resolve its dependencies",
      );
    windows = {
      bytes,
      file: basename(options.windowsArtifact),
      hash: sha256(bytes),
      architecture: format.architecture,
      imports: format.imports ?? [],
      runtime: format.runtime ?? "windows",
      dependencies,
    };
  }
  const manifest =
    windows && options.wingetId
      ? winget(
          options,
          pkg,
          windows.hash,
          windows.architecture,
          windows.dependencies.winget,
        )
      : undefined;
  if (options.wingetId && !windows)
    throw new Error(
      "WinGet output requires --windows-artifact with a real rebuilt PE executable",
    );
  const root = resolve(options.out);
  try {
    await lstat(root);
    throw new Error("Output root already exists; refusing replacement");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  await newFile(
    targetPath(root, "package-contract.json"),
    `${JSON.stringify({ ...inspection, selected: pkg.name, sources, signaturesVerified: false }, null, 2)}\n`,
  );
  if (windows) {
    await newFile(targetPath(root, `bin/${windows.file}`), windows.bytes);
    const npmName = pkg.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const packageJson = {
      name: `@bun-os/${npmName}`,
      version: bunVersion(options.windowsVersion ?? pkg.version),
      private: true,
      license:
        options.license ??
        (pkg.licenses.length === 1 ? pkg.licenses[0] : "UNLICENSED"),
      description: pkg.description,
      os: ["win32"],
      cpu: [
        (
          { x64: "x64", x86: "ia32", arm64: "arm64", arm: "arm" } as Record<
            string,
            string
          >
        )[windows.architecture],
      ],
      bin: { [pkg.name]: `bin/${windows.file}` },
      dependencies: windows.dependencies.bun,
      systemDependencies: Object.fromEntries(
        windows.dependencies.winget.map((id) => [`winget:${id}`, "*"]),
      ),
      bunOs: {
        schema: 1,
        upstreamVersion: pkg.version,
        ecosystem: pkg.ecosystem,
        artifactSha256: windows.hash,
        architecture: windows.architecture,
        runtime: windows.runtime,
        imports: windows.imports,
        importResolution: windows.dependencies.imports,
        upstreamDependencies: pkg.dependencies,
        sources,
        sourceMetadataSha256: inspection.input.sha256,
        rebuildProvenance: "owner-supplied PE artifact",
      },
    };
    await newFile(
      targetPath(root, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    if (manifest) await newFile(targetPath(root, "winget.yaml"), manifest);
  } else if (assets) {
    await extract(targetPath(root, "payload"), entries);
    await newFile(
      targetPath(root, "native-assets.json"),
      `${JSON.stringify({ ...assets, upstreamSources: sources }, null, 2)}\n`,
    );
    const npmName = pkg.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const packageJson = {
      name: `@bun-os/${npmName}`,
      version: bunVersion(options.windowsVersion ?? pkg.version),
      private: true,
      license:
        options.license ??
        (pkg.licenses.length === 1 ? pkg.licenses[0] : "UNLICENSED"),
      description: pkg.description,
      os: ["win32"],
      cpu: [
        (
          { x64: "x64", x86: "ia32", arm64: "arm64", arm: "arm" } as Record<
            string,
            string
          >
        )[assets.architecture],
      ],
      files: ["package-contract.json", "native-assets.json", "payload"],
      exports: {
        "./native-assets": "./native-assets.json",
        "./payload/*": "./payload/*",
      },
      dependencies: assets.dependencies,
      systemDependencies: assets.systemDependencies,
      bunOs: {
        schema: 1,
        packageKind: assets.packageKind,
        upstreamVersion: pkg.version,
        ecosystem: pkg.ecosystem,
        architecture: assets.architecture,
        runtime: assets.runtime,
        sources,
        dependencies: pkg.dependencies,
        sourceMetadataSha256: inspection.input.sha256,
        rebuildProvenance:
          "original native PE archive payload; no rebuild performed",
        runtimeQualified: false,
      },
    };
    await newFile(
      targetPath(root, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
  } else {
    const npmName = pkg.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const packageJson = {
      name: `@bun-os/${npmName}`,
      version: bunVersion(pkg.version),
      private: true,
      license:
        options.license ??
        (pkg.licenses.length === 1 ? pkg.licenses[0] : "UNLICENSED"),
      description: pkg.description,
      files: [
        "package-contract.json",
        "port-job.json",
        ...(options.extractSources ? ["sources"] : []),
      ],
      bunOs: {
        schema: 1,
        packageKind: "source-contract",
        upstreamVersion: pkg.version,
        ecosystem: pkg.ecosystem,
        sources,
        dependencies: pkg.dependencies,
        sourceMetadataSha256: inspection.input.sha256,
        windowsArtifactProduced: false,
      },
    };
    await newFile(
      targetPath(root, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    await newFile(
      targetPath(root, "port-job.json"),
      `${JSON.stringify(
        {
          schema: 1,
          package: pkg.name,
          sourceVersion: pkg.version,
          sourceEcosystem: pkg.ecosystem,
          target: "windows",
          requiredAbi: "pe",
          sources,
          dependencies: pkg.dependencies,
          sourceMetadataSha256: inspection.input.sha256,
          inputs: inspection.payload,
          tasks: [
            "retrieve and verify every source artifact",
            "map dependencies to the selected Windows runtime",
            "port OS interfaces",
            "build with the selected native toolchain",
            "qualify the exact PE and runtime dependencies",
          ],
          windowsArtifactProduced: false,
        },
        null,
        2,
      )}\n`,
    );
  }
  if (options.extractSources) {
    await extract(targetPath(root, "sources"), entries);
  }
  return root;
}
