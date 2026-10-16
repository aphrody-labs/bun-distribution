// SPDX-License-Identifier: MIT
import { basename } from "node:path";
import { type Inspection, type PackageRecord } from "./types.ts";

const NUMBER = "(?:0|[1-9][0-9]*)";
const PRERELEASE = "(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);
export const bunVersion = (value: string) =>
  VERSION.test(value) ? value : "0.0.0";
const WINGET_ID =
  /^[A-Za-z0-9][A-Za-z0-9+_-]*(?:\.[A-Za-z0-9][A-Za-z0-9+_-]*)+$/;
const BUN_OWNER =
  /^bun:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(.+)$/;

export type RuntimeOwner =
  | { kind: "winget"; id: string }
  | { kind: "bun"; name: string; version: string };
export type ImportResolution =
  | { dll: string; kind: "system" }
  | { dll: string; kind: "bundled"; paths: string[] }
  | { dll: string; kind: "external"; owner: RuntimeOwner };

interface BundledLibrary {
  path: string;
  sha256: string;
}

export interface RuntimeDependencies {
  imports: ImportResolution[];
  bun: Record<string, string>;
  winget: string[];
}

function runtimeOwner(value: string): RuntimeOwner {
  const bun = BUN_OWNER.exec(value);
  if (bun) {
    if (!VERSION.test(bun[2]!))
      throw new Error("Bun runtime dependency needs an exact semantic version");
    return { kind: "bun", name: bun[1]!, version: bun[2]! };
  }
  const id = value.startsWith("winget:") ? value.slice(7) : value;
  if (!WINGET_ID.test(id))
    throw new Error(
      "Runtime owner must be Publisher.Package or bun:package@VERSION",
    );
  return { kind: "winget", id };
}

export function runtimeDependencies(
  imports: string[],
  mappings: Record<string, string> = {},
  bundled: Map<string, BundledLibrary[]> = new Map(),
): RuntimeDependencies {
  const owners = new Map<string, RuntimeOwner>();
  for (const [dll, owner] of Object.entries(mappings)) {
    const key = dll.toLowerCase();
    if (!/^[a-z0-9_.+-]+\.dll$/.test(key) || owners.has(key))
      throw new Error("Invalid or duplicate DLL runtime mapping");
    owners.set(key, runtimeOwner(owner));
  }
  const bun: Record<string, string> = Object.create(null);
  const winget = new Set<string>();
  const resolutions: ImportResolution[] = [];
  for (const dll of new Set(imports)) {
    if (/^(?:api-ms-|ext-ms-)/.test(dll) || WINDOWS_DLLS.has(dll)) {
      resolutions.push({ dll, kind: "system" });
      continue;
    }
    const files = bundled.get(dll);
    if (files?.length) {
      if (new Set(files.map((file) => file.sha256)).size !== 1)
        throw new Error(`Ambiguous bundled DLL ${dll}`);
      resolutions.push({
        dll,
        kind: "bundled",
        paths: files.map((file) => file.path),
      });
      continue;
    }
    const owner = owners.get(dll);
    if (!owner)
      throw new Error(
        `Native PE imports ${dll}; configure its runtime package owner explicitly`,
      );
    resolutions.push({ dll, kind: "external", owner });
    if (owner.kind === "winget") winget.add(owner.id);
    else {
      if (bun[owner.name] && bun[owner.name] !== owner.version)
        throw new Error(`Conflicting Bun runtime versions for ${owner.name}`);
      bun[owner.name] = owner.version;
    }
  }
  return { imports: resolutions, bun, winget: [...winget] };
}

export function nativeAssets(
  inspection: Inspection,
  pkg: PackageRecord,
  mappings?: Record<string, string>,
) {
  if (
    pkg.kind !== "binary" ||
    inspection.payload.some((file) => file.abi?.format === "elf")
  )
    return undefined;
  const images = inspection.payload.filter(
    (file) => file.kind === "file" && file.abi?.format === "pe",
  );
  if (!images.length) return undefined;
  const architectures = new Set(images.map((file) => file.abi!.architecture));
  const architecture = images[0]!.abi!.architecture;
  if (
    architectures.size !== 1 ||
    !architecture ||
    !["x86", "x64", "arm", "arm64"].includes(architecture)
  )
    throw new Error(
      "Native payload needs one supported, consistent PE architecture",
    );
  const bundled = new Map<string, BundledLibrary[]>();
  for (const image of images) {
    if (!image.abi!.library && !image.abi!.executable)
      throw new Error("Payload PE is not an executable image or a DLL");
    if (image.abi!.library) {
      const name = basename(image.path).toLowerCase();
      const files = bundled.get(name) ?? [];
      files.push({ path: `payload/${image.path}`, sha256: image.sha256! });
      bundled.set(name, files);
    }
  }
  const files = images.map((image) => ({
    path: `payload/${image.path}`,
    sha256: image.sha256!,
    abi: image.abi!,
    ...runtimeDependencies(image.abi!.imports ?? [], mappings, bundled),
  }));
  const dependencies: Record<string, string> = Object.create(null);
  for (const file of files)
    for (const [name, version] of Object.entries(file.bun)) {
      if (dependencies[name] && dependencies[name] !== version)
        throw new Error(`Conflicting Bun runtime versions for ${name}`);
      dependencies[name] = version;
    }
  return {
    schema: 1,
    packageKind: images.every((image) => image.abi!.library)
      ? "native-library"
      : "native-assets",
    architecture,
    runtime: [...new Set(images.map((image) => image.abi!.runtime))],
    libraries: files.filter((file) => file.abi.library),
    images: files,
    payload: inspection.payload.map((file) => ({
      ...file,
      path: `payload/${file.path}`,
    })),
    dependencies,
    systemDependencies: Object.fromEntries(
      [...new Set(files.flatMap((file) => file.winget))].map((id) => [
        `winget:${id}`,
        "*",
      ]),
    ),
    upstreamDependencies: pkg.dependencies,
    inputArchiveSha256: inspection.input.sha256,
    upstreamSources: pkg.sources,
    upstreamLicenses: pkg.licenses,
    payloadBytesPreserved: true,
    signaturesVerified: false,
    runtimeQualified: false,
  };
}

// Windows OS owners only. VC redistributables, Cygwin and MSYS2 remain external dependencies.
const WINDOWS_DLLS = new Set([
  "kernel32.dll",
  "kernelbase.dll",
  "ntdll.dll",
  "user32.dll",
  "gdi32.dll",
  "gdi32full.dll",
  "advapi32.dll",
  "shell32.dll",
  "ole32.dll",
  "oleaut32.dll",
  "combase.dll",
  "comdlg32.dll",
  "ws2_32.dll",
  "bcrypt.dll",
  "bcryptprimitives.dll",
  "crypt32.dll",
  "secur32.dll",
  "shlwapi.dll",
  "version.dll",
  "winmm.dll",
  "imm32.dll",
  "msvcrt.dll",
  "ucrtbase.dll",
  "setupapi.dll",
  "iphlpapi.dll",
  "dnsapi.dll",
  "dwmapi.dll",
  "d3d11.dll",
  "d3d12.dll",
  "dxgi.dll",
  "winhttp.dll",
  "normaliz.dll",
  "mpr.dll",
  "cfgmgr32.dll",
  "wsock32.dll",
  "dbghelp.dll",
  "userenv.dll",
]);
