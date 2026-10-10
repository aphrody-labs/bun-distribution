// SPDX-License-Identifier: Apache-2.0
import { dirname, join } from "node:path";
import { firstPartyManifests } from "@aphrody/update/manifests";

interface PackageManifest {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  bin?: unknown;
}

export interface DependencyBuild {
  name: string;
  path: string;
}

function hasBuiltEntry(value: unknown): boolean {
  if (typeof value === "string") return /^(?:\.\/)?(?:dist|build)\//.test(value);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(hasBuiltEntry);
  }
  return false;
}

function workspaceDependencyNames(manifest: PackageManifest): string[] {
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  })
    .filter(([, spec]) => spec.startsWith("workspace:"))
    .map(([name]) => name)
    .toSorted();
}

/** Select only active local dependencies whose public entries require a build. */
export async function dependencyBuildPlan(
  root: string,
  consumers: readonly string[],
): Promise<DependencyBuild[]> {
  const packages = await Promise.all(
    (await firstPartyManifests(root)).map(async (path) => ({
      path: dirname(join(root, path)),
      manifest: (await Bun.file(join(root, path)).json()) as PackageManifest,
    })),
  );
  const owners = new Map<string, (typeof packages)[number]>();
  for (const item of packages) {
    if (!item.manifest.name)
      throw new Error(`Workspace manifest has no package name: ${item.path}`);
    if (owners.has(item.manifest.name))
      throw new Error(`Duplicate workspace artifact owner: ${item.manifest.name}`);
    owners.set(item.manifest.name, item);
  }
  const builds: DependencyBuild[] = [];
  const visited = new Set<string>();
  const active: string[] = [];
  const needsBuild = (name: string) => {
    const manifest = owners.get(name)?.manifest;
    return Boolean(
      manifest &&
      hasBuiltEntry([
        manifest.exports,
        manifest.main,
        manifest.module,
        manifest.types,
        manifest.bin,
      ]),
    );
  };
  const visit = (name: string) => {
    const item = owners.get(name);
    if (!item) throw new Error(`Workspace dependency has no active owner: ${name}`);
    if (visited.has(name)) return;
    const cycle = active.indexOf(name);
    if (cycle !== -1) {
      if (active.slice(cycle).some(needsBuild)) {
        throw new Error(
          `Workspace artifact build cycle: ${[...active.slice(cycle), name].join(" -> ")}`,
        );
      }
      return;
    }
    active.push(name);
    const { manifest } = item;
    for (const dependency of workspaceDependencyNames(manifest)) visit(dependency);
    active.pop();
    visited.add(name);
    if (needsBuild(name)) {
      if (!manifest.scripts?.build)
        throw new Error(`Workspace artifact owner has no build script: ${name}`);
      builds.push({ name, path: item.path });
    }
  };
  for (const name of [...consumers].toSorted()) {
    const consumer = owners.get(name);
    if (!consumer) throw new Error(`Unknown workspace consumer: ${name}`);
    // The gate builds the consumer itself; preparation builds its dependencies.
    for (const dependency of workspaceDependencyNames(consumer.manifest)) visit(dependency);
  }
  return builds;
}

/** Build dependencies serially and stop before a failed artifact reaches consumers. */
export async function buildDependencies(
  root: string,
  consumers: readonly string[],
): Promise<number> {
  const plan = await dependencyBuildPlan(root, consumers);
  // Workspace build commands run serially on the shared host.
  // oxlint-disable-next-line no-await-in-loop
  for (const item of plan) {
    console.error(`Workspace dependency build: ${item.name}`);
    const child = Bun.spawn([process.execPath, "run", "build"], {
      windowsHide: true,
      cwd: item.path,
      stdout: "inherit",
      stderr: "inherit",
    });
    // oxlint-disable-next-line no-await-in-loop
    const code = await child.exited;
    if (code !== 0) return code;
  }
  return 0;
}
