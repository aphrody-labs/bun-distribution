import { dirname, join, relative } from "node:path";
import { checkoutPath, type Module } from "./index.ts";
import { runProcess } from "./process.ts";

export interface ModuleCoverage {
  id: string;
  cargoManifests: number;
  cargoPackages: number;
  packageManifests: number;
  rustSources: number;
  typescriptSources: number;
  missingWorkspaceMembers: string[];
  missingTargets: string[];
  errors: string[];
}

interface CargoManifest {
  package?: { name?: string; autobins?: boolean };
  workspace?: { members?: string[]; exclude?: string[] };
  lib?: { path?: string };
  bin?: { name?: string; path?: string }[];
}

const maxManifestBytes = 4 * 1024 * 1024;
const maxTrackedFiles = 100_000;

async function manifest(path: string): Promise<CargoManifest> {
  const file = Bun.file(path);
  if (file.size > maxManifestBytes)
    throw new Error("Cargo manifest exceeds 4 MiB.");
  return Bun.TOML.parse(await file.text()) as CargoManifest;
}

/** Check tracked implementation and Cargo members, without executing a build or changing sources. */
export async function inspectModuleCoverage(
  module: Module,
  root: string,
): Promise<ModuleCoverage> {
  const coverage: ModuleCoverage = {
    id: module.id,
    cargoManifests: 0,
    cargoPackages: 0,
    packageManifests: 0,
    rustSources: 0,
    typescriptSources: 0,
    missingWorkspaceMembers: [],
    missingTargets: [],
    errors: [],
  };
  const directory = checkoutPath(root, module.path);
  try {
    const tracked = await runProcess(
      [
        "git",
        "ls-files",
        "-z",
        "--",
        "*.rs",
        "*.ts",
        "*.tsx",
        "Cargo.toml",
        "**/Cargo.toml",
        "package.json",
        "**/package.json",
      ],
      directory,
      { timeoutMs: 20_000, maxOutputBytes: 16 * 1024 * 1024 },
    );
    if (tracked.code !== 0) throw new Error("Tracked source inventory failed.");
    const files = tracked.stdout.split("\0").filter(Boolean);
    if (files.length > maxTrackedFiles)
      throw new Error("Tracked source inventory exceeds 100000 files.");
    const trackedFiles = new Set(files);
    const cargoManifests = files.filter(
      (file) => file === "Cargo.toml" || file.endsWith("/Cargo.toml"),
    );
    coverage.cargoManifests = cargoManifests.length;
    coverage.packageManifests = files.filter(
      (file) => file === "package.json" || file.endsWith("/package.json"),
    ).length;
    coverage.rustSources = files.filter((file) => file.endsWith(".rs")).length;
    coverage.typescriptSources = files.filter((file) =>
      /\.tsx?$/.test(file),
    ).length;
    for (const name of cargoManifests) {
      const path = checkoutPath(directory, name);
      const cargo = await manifest(path);
      const packageDirectory = dirname(path);
      if (cargo.workspace?.members) {
        for (const member of cargo.workspace.members) {
          if (typeof member !== "string" || !member)
            throw new Error(`Invalid Cargo member in ${name}.`);
          if (member !== ".") checkoutPath(packageDirectory, member);
          if (
            cargo.workspace.exclude?.some((excluded) =>
              new Bun.Glob(excluded).match(member),
            )
          )
            continue;
          let found = false;
          let matches = 0;
          for await (const candidate of new Bun.Glob(
            `${member}/Cargo.toml`,
          ).scan({
            cwd: packageDirectory,
            onlyFiles: true,
            followSymlinks: false,
          })) {
            if (++matches > maxTrackedFiles)
              throw new Error("Cargo member discovery exceeds 100000 files.");
            const local = relative(
              directory,
              checkoutPath(packageDirectory, candidate),
            ).replaceAll("\\", "/");
            if (trackedFiles.has(local)) found = true;
          }
          if (!found)
            coverage.missingWorkspaceMembers.push(`${name}:${member}`);
        }
      }
      if (!cargo.package) continue;
      coverage.cargoPackages++;
      if (cargo.lib) {
        const libraryPath = cargo.lib.path ?? "src/lib.rs";
        if (
          !(await Bun.file(
            checkoutPath(packageDirectory, libraryPath),
          ).exists())
        ) {
          coverage.missingTargets.push(`${name}:${libraryPath}`);
        }
      }
      for (const binary of cargo.bin ?? []) {
        if (binary.path) {
          if (
            !(await Bun.file(
              checkoutPath(packageDirectory, binary.path),
            ).exists())
          ) {
            coverage.missingTargets.push(`${name}:${binary.path}`);
          }
        } else if (binary.name) {
          const candidates =
            binary.name === cargo.package.name
              ? [
                  join(packageDirectory, "src/main.rs"),
                  join(packageDirectory, "src/bin", `${binary.name}.rs`),
                  join(packageDirectory, "src/bin", binary.name, "main.rs"),
                ]
              : [
                  join(packageDirectory, "src/bin", `${binary.name}.rs`),
                  join(packageDirectory, "src/bin", binary.name, "main.rs"),
                ];
          if (
            !(
              await Promise.all(
                candidates.map((candidate) => Bun.file(candidate).exists()),
              )
            ).some(Boolean)
          ) {
            coverage.missingTargets.push(`${name}:bin ${binary.name}`);
          }
        }
      }
      if (!cargo.lib && !cargo.bin?.length) {
        const prefix = relative(directory, packageDirectory).replaceAll(
          "\\",
          "/",
        );
        const binPrefix = prefix ? `${prefix}/src/bin/` : "src/bin/";
        const hasAutoBin =
          cargo.package.autobins !== false &&
          files.some(
            (file) =>
              file.startsWith(binPrefix) &&
              /^(?:[^/]+\.rs|[^/]+\/main\.rs)$/.test(
                file.slice(binPrefix.length),
              ),
          );
        const implicit = await Promise.all([
          Bun.file(join(packageDirectory, "src/lib.rs")).exists(),
          Bun.file(join(packageDirectory, "src/main.rs")).exists(),
        ]);
        if (!hasAutoBin && !implicit.some(Boolean))
          coverage.missingTargets.push(`${name}:implicit Rust target`);
      }
    }
  } catch (error) {
    coverage.errors.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return coverage;
}
