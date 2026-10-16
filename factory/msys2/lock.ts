import {
  hashContent,
  isObject,
} from "../../packages/bun-workspace/src/index.ts";
import type { inspectMsys2Sources } from "../arch/msys2.ts";
import type { Msys2DesktopABI } from "./config.ts";
import { relative, resolve } from "node:path";

const packageName = /^[A-Za-z0-9@._+-]+$/;
const revision = /^[a-f0-9]{40}$/;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function sourcePath(path: string) {
  return (
    Boolean(path) &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((part) => part !== ".." && part !== "." && part !== "")
  );
}

export type Msys2Inspection = Awaited<ReturnType<typeof inspectMsys2Sources>>;

export interface Msys2DesktopPackageLock {
  schemaVersion: 1;
  kind: "bun-os-msys2-installed-metadata-lock";
  abi: Msys2DesktopABI;
  packages: { name: string; version: string }[];
  packagesSha256: string;
  sources: {
    path: string;
    revision: string;
    remotes: { name: string; url: string }[];
    dirty: boolean;
  }[];
  sourcesSha256: string;
  signaturesVerified: false;
  artifactHashesVerified: false;
  buildQualified: false;
}

/** Deterministic installed metadata, never a signed download/replay or build qualification lock. */
export function captureMsys2DesktopLock(
  inspection: Msys2Inspection,
  abi: Msys2DesktopABI,
): Msys2DesktopPackageLock {
  if (inspection.pacman.packagesCode !== 0)
    throw new Error("A successful native pacman -Q inspection is required.");
  const packages = inspection.pacman.packages
    .map((pkg) => ({ ...pkg }))
    .sort((a, b) => compare(a.name, b.name));
  if (
    new Set(packages.map((pkg) => pkg.name)).size !== packages.length ||
    packages.some(
      (pkg) =>
        !packageName.test(pkg.name) || !pkg.version || /\s/.test(pkg.version),
    )
  )
    throw new Error("Invalid or duplicate installed package identity.");
  const sources = inspection.repositories
    .flatMap((repo) =>
      repo.git && repo.head && repo.remotes
        ? [
            {
              path: relative(
                resolve(inspection.sourceRoot),
                resolve(repo.path),
              ).replaceAll("\\", "/"),
              revision: repo.head,
              remotes: repo.remotes
                .map((remote) => ({ ...remote }))
                .sort((a, b) => compare(a.name, b.name)),
              dirty: repo.cleanTracked !== true,
            },
          ]
        : [],
    )
    .sort((a, b) => compare(a.path, b.path));
  if (
    sources.some(
      (source) => !sourcePath(source.path) || !revision.test(source.revision),
    )
  )
    throw new Error(
      "Source metadata must use contained relative paths and exact Git revisions.",
    );
  return {
    schemaVersion: 1,
    kind: "bun-os-msys2-installed-metadata-lock",
    abi,
    packages,
    packagesSha256: hashContent(JSON.stringify(packages)),
    sources,
    sourcesSha256: hashContent(JSON.stringify(sources)),
    signaturesVerified: false,
    artifactHashesVerified: false,
    buildQualified: false,
  };
}

export function inspectMsys2DesktopLock(
  value: unknown,
  current: Msys2DesktopPackageLock,
) {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== current.kind ||
    value.abi !== current.abi ||
    value.signaturesVerified !== false ||
    value.artifactHashesVerified !== false ||
    value.buildQualified !== false ||
    !Array.isArray(value.packages) ||
    !Array.isArray(value.sources)
  )
    return {
      valid: false,
      packageDrift: null,
      sourceDrift: null,
      reason: "Lock schema or selected ABI differs",
    };
  const packagesValid = value.packages.every(
    (pkg) =>
      isObject(pkg) &&
      typeof pkg.name === "string" &&
      packageName.test(pkg.name) &&
      typeof pkg.version === "string" &&
      Boolean(pkg.version) &&
      !/\s/.test(pkg.version),
  );
  const sourcesValid = value.sources.every(
    (source) =>
      isObject(source) &&
      typeof source.path === "string" &&
      sourcePath(source.path) &&
      typeof source.revision === "string" &&
      revision.test(source.revision) &&
      typeof source.dirty === "boolean" &&
      Array.isArray(source.remotes) &&
      source.remotes.every(
        (remote) =>
          isObject(remote) &&
          typeof remote.name === "string" &&
          Boolean(remote.name) &&
          typeof remote.url === "string" &&
          Boolean(remote.url),
      ),
  );
  if (
    !packagesValid ||
    !sourcesValid ||
    new Set(value.packages.map((pkg) => (isObject(pkg) ? pkg.name : null)))
      .size !== value.packages.length ||
    new Set(
      value.sources.map((source) => (isObject(source) ? source.path : null)),
    ).size !== value.sources.length ||
    hashContent(JSON.stringify(value.packages)) !== value.packagesSha256 ||
    hashContent(JSON.stringify(value.sources)) !== value.sourcesSha256
  )
    return {
      valid: false,
      packageDrift: null,
      sourceDrift: null,
      reason: "Lock content does not match its recorded metadata digests",
    };
  return {
    valid: true,
    packageDrift: value.packagesSha256 !== current.packagesSha256,
    sourceDrift: value.sourcesSha256 !== current.sourcesSha256,
    reason:
      "Installed metadata comparison only; signatures and payload hashes remain unqualified",
  };
}
