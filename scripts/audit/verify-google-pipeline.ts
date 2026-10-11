#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Google pipeline gate: the Rust (`aphrody-google` in the multi-call `aphrody`), Bun
 * (`@aphrody/google`, `@aphrody/doc-ai`) and Python (`aphrody`, `aphrody-cli`) owners exist where
 * the manifests say, the uv pin matches the monorepo toolchain and no source assigns a literal API
 * key; then, unless `--static`, every `crates/google/*` crate runs serialized clippy and tests on
 * its own, the Bun packages verify, and the locked Python workspace syncs, imports the pinned
 * google-antigravity SDK and runs its tests. Child processes never open a console window.
 *
 * Usage: bun scripts/audit/verify-google-pipeline.ts [--static] [--root <aphrody>] [--python-root <py>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const HELP =
  "Usage: bun scripts/audit/verify-google-pipeline.ts [--static] [--root <aphrody>] [--python-root <py>]";

interface CargoTarget {
  name: string;
  kind: string[];
}
interface CargoPackage {
  name: string;
  manifest_path: string;
  targets: CargoTarget[];
}

export interface Owners {
  root: string;
  python: string;
  cargoManifest: string;
  rustCli: string;
  bunManifest: string;
  bunEntry: string;
  docAiManifest: string;
  docAiEntry: string;
  pythonManifest: string;
  pythonCliManifest: string;
  pythonWorkspace: string;
  pythonFacade: string;
  pythonLock: string;
  toolchain: string;
  cargoSerial: string;
}

export function owners(root: string, python = join(root, "py")): Owners {
  return {
    root,
    python,
    cargoManifest: join(root, "crates/google/google/Cargo.toml"),
    rustCli: join(root, "crates/google/google/src/cli.rs"),
    bunManifest: join(root, "packages/google/google/package.json"),
    bunEntry: join(root, "packages/google/google/src/cli.ts"),
    docAiManifest: join(root, "packages/ai/doc-ai/package.json"),
    docAiEntry: join(root, "packages/ai/doc-ai/src/llm.ts"),
    pythonManifest: join(python, "packages/aphrody/pyproject.toml"),
    pythonCliManifest: join(python, "packages/cli/pyproject.toml"),
    pythonWorkspace: join(python, "pyproject.toml"),
    pythonFacade: join(python, "packages/aphrody/src/aphrody/google.py"),
    pythonLock: join(python, "uv.lock"),
    toolchain: join(root, "tools/config/system-packages.json"),
    cargoSerial: join(root, "scripts/build/rust/cargo-serial.ts"),
  };
}

/** `required-version` of `[tool.uv]` as `{ operator, version }` (`==0.12.24`, `>=0.12.24`). */
export function uvPin(workspaceToml: string): { operator: string; version: string } | undefined {
  const match = /^required-version\s*=\s*["'](==|>=|~=)?\s*([0-9][^"']*)["']\s*$/m.exec(
    workspaceToml,
  );
  return match ? { operator: match[1] ?? "==", version: match[2] as string } : undefined;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Whether `uv --version` output satisfies the workspace pin. */
export function uvSatisfies(output: string, pin: { operator: string; version: string }): boolean {
  const found = /\buv\s+(\d+(?:\.\d+)*)/.exec(output)?.[1];
  if (!found) return false;
  return pin.operator === ">=" || pin.operator === "~="
    ? compareVersions(found, pin.version) >= 0
    : compareVersions(found, pin.version) === 0;
}

/** The `[project] name` of a pyproject and whether `[project.scripts]` maps `script` to `target`. */
export function pyprojectDeclares(toml: string, name: string, script?: [string, string]): boolean {
  if (
    !new RegExp(String.raw`^name\s*=\s*["']${name.replace(/[-.]/g, "\\$&")}["']\s*$`, "m").test(
      toml,
    )
  )
    return false;
  if (!script) return true;
  const scripts = /^\[project\.scripts\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? "";
  return new RegExp(
    String.raw`^${script[0].replace(/[-.]/g, "\\$&")}\s*=\s*["']${script[1].replace(/[.:]/g, "\\$&")}["']`,
    "m",
  ).test(scripts);
}

/** Source files (`.ts`, `.py`) under `dir` that assign a literal Gemini/Google API key. */
export function literalKeyFiles(dir: string): string[] {
  const hits: string[] = [];
  for (const file of new Bun.Glob("**/*.{ts,py}").scanSync({ cwd: dir, dot: false })) {
    if (file.includes("node_modules")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    if (text.includes("GEMINI_API_KEY=") || text.includes("GOOGLE_API_KEY=")) hits.push(file);
  }
  return hits;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function hasScripts(manifest: string, name: string, scripts: string[]): void {
  const json = readJson<{ name?: string; scripts?: Record<string, string> }>(manifest);
  if (json.name !== name)
    throw new Error(`Unexpected Bun package owner: ${json.name} (${manifest})`);
  for (const script of scripts)
    if (!json.scripts?.[script]) throw new Error(`${name} has no '${script}' script.`);
}

function cargoMetadata(root: string): CargoPackage[] {
  const result = Bun.spawnSync(
    [
      "cargo",
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      join(root, "Cargo.toml"),
    ],
    { cwd: root, windowsHide: true, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(
      `cargo metadata failed for the monorepo workspace: ${result.stderr.toString()}`,
    );
  return (JSON.parse(result.stdout.toString()) as { packages: CargoPackage[] }).packages;
}

const same = (left: string, right: string) =>
  resolve(left).toLowerCase() === resolve(right).toLowerCase();

/** Static owner checks; returns the Google crates (sorted) and the uv pin. */
export function verifyStatic(paths: Owners): {
  crates: string[];
  uv: { operator: string; version: string };
} {
  for (const path of [
    join(paths.root, "Cargo.toml"),
    paths.cargoManifest,
    paths.rustCli,
    paths.bunManifest,
    paths.bunEntry,
    paths.docAiManifest,
    paths.docAiEntry,
    paths.cargoSerial,
    paths.pythonManifest,
    paths.pythonCliManifest,
    paths.pythonWorkspace,
    paths.pythonFacade,
    paths.pythonLock,
    paths.toolchain,
  ])
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`Owner file missing: ${path}`);

  const packages = cargoMetadata(paths.root);
  const google = packages.find((item) => item.name === "aphrody-google");
  if (!google?.targets.some((target) => target.kind.includes("lib")))
    throw new Error("Current Cargo metadata does not expose the aphrody-google library.");
  if (!same(google.manifest_path, paths.cargoManifest))
    throw new Error(`Cargo package aphrody-google is not owned by ${paths.cargoManifest}.`);
  const aphrody = packages.find((item) => item.name === "aphrody");
  if (!aphrody?.targets.some((target) => target.name === "aphrody" && target.kind.includes("bin")))
    throw new Error("Current Cargo metadata does not expose the aphrody multi-call binary.");
  const domain = join(paths.root, "crates", "google");
  const onDisk = readdirSync(domain)
    .map((name) => join(domain, name, "Cargo.toml"))
    .filter((manifest) => existsSync(manifest));
  const crates = packages
    .filter((item) => onDisk.some((manifest) => same(manifest, item.manifest_path)))
    .map((item) => item.name)
    .toSorted();
  if (crates.length !== onDisk.length)
    throw new Error(
      `crates/google has ${onDisk.length} manifests but the workspace exposes ${crates.length}: ${crates.join(", ")}`,
    );

  hasScripts(paths.bunManifest, "@aphrody/google", ["test", "build", "verify"]);
  hasScripts(paths.docAiManifest, "@aphrody/doc-ai", ["test", "typecheck"]);

  if (!pyprojectDeclares(readFileSync(paths.pythonManifest, "utf8"), "aphrody"))
    throw new Error(
      `Python package manifest does not declare project 'aphrody': ${paths.pythonManifest}`,
    );
  if (
    !pyprojectDeclares(readFileSync(paths.pythonCliManifest, "utf8"), "aphrody-cli", [
      "aphrody-python-google",
      "aphrody_cli.google:main",
    ])
  )
    throw new Error(
      `Python CLI does not expose the aphrody-python-google entry point: ${paths.pythonCliManifest}`,
    );
  const uv = uvPin(readFileSync(paths.pythonWorkspace, "utf8"));
  if (!uv) throw new Error(`Python workspace does not pin uv in ${paths.pythonWorkspace}.`);
  const monorepo = readJson<{ toolchains?: { uv?: { version?: string } } }>(paths.toolchain)
    .toolchains?.uv?.version;
  if (uv.version !== monorepo)
    throw new Error(
      `uv pin mismatch: tools/config/system-packages.json requires ${monorepo}, but py/ requires ${uv.operator}${uv.version}.`,
    );

  for (const dir of [
    join(paths.root, "packages/google/google"),
    join(paths.root, "packages/ai/doc-ai"),
    join(paths.python, "packages/aphrody/src/aphrody"),
    join(paths.python, "packages/cli/src/aphrody_cli"),
  ]) {
    const hits = literalKeyFiles(dir);
    if (hits.length > 0) throw new Error(`Literal API key assignment found under ${dir}.`);
  }
  return { crates, uv };
}

async function owner(name: string, argv: string[], cwd: string): Promise<void> {
  console.log(`==> ${name}`);
  const child = Bun.spawn(argv, {
    cwd,
    windowsHide: true,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code}).`);
}

export async function verify(paths: Owners, staticOnly: boolean): Promise<void> {
  const { crates, uv } = verifyStatic(paths);
  console.log("GOOGLE_PIPELINE: manifests and Rust/Bun/Python owner paths verified.");
  console.log(`Rust: ${paths.cargoManifest} -> aphrody-google (${crates.join(", ")})`);
  console.log(`Bun: ${paths.bunManifest} -> @aphrody/google`);
  console.log(`Doc AI: ${paths.docAiManifest} -> @aphrody/doc-ai`);
  console.log(`Python: ${paths.pythonManifest} -> aphrody.google / aphrody-python-google`);
  if (staticOnly) return;

  const version = Bun.spawnSync(["uv", "--version"], { windowsHide: true, stdout: "pipe" });
  if (version.exitCode !== 0)
    throw new Error("Could not query the uv version for the Python gate.");
  if (!uvSatisfies(version.stdout.toString(), uv))
    throw new Error(
      `Python gate requires uv ${uv.operator}${uv.version} from py/pyproject.toml; found ${version.stdout.toString().trim()}.`,
    );
  // One `-p` per crate, so a crate that silently relies on a sibling's features fails here.
  const cargo = [process.execPath, paths.cargoSerial];
  for (const crate of crates) {
    await owner(
      `Rust ${crate} clippy (serialized, standalone)`,
      [...cargo, "clippy", "--locked", "-p", crate, "--all-targets", "--", "-D", "warnings"],
      paths.root,
    );
    await owner(
      `Rust ${crate} tests (serialized, standalone)`,
      [...cargo, "test", "--locked", "-p", crate],
      paths.root,
    );
  }
  const bun = process.execPath;
  await owner(
    "@aphrody/google verify (tests + Bun build)",
    [bun, "run", "--filter", "@aphrody/google", "verify"],
    paths.root,
  );
  await owner(
    "@aphrody/doc-ai tests",
    [bun, "run", "--filter", "@aphrody/doc-ai", "test"],
    paths.root,
  );
  await owner(
    "@aphrody/doc-ai typecheck",
    [bun, "run", "--filter", "@aphrody/doc-ai", "typecheck"],
    paths.root,
  );
  // The SDK lives in its pinned Git repository (the `antigravity` extra of `aphrody`); the locked
  // sync builds its wheel through uv without building the aphrody project itself.
  await owner(
    "Python pinned google-antigravity SDK installs from the lock",
    [
      "uv",
      "sync",
      "--locked",
      "--package",
      "aphrody",
      "--extra",
      "antigravity",
      "--no-install-project",
    ],
    paths.python,
  );
  await owner(
    "Python google-antigravity SDK imports",
    ["uv", "run", "--no-sync", "python", "-c", "import google.antigravity"],
    paths.python,
  );
  await owner(
    "Python aphrody tests",
    ["uv", "run", "--locked", "--package", "aphrody", "pytest"],
    paths.python,
  );
  console.log("GOOGLE_PIPELINE: all current owner gates passed.");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let root = resolve(import.meta.dir, "../..");
  let python: string | undefined;
  let staticOnly = false;
  try {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--static") staticOnly = true;
      else if (arg === "--root") root = resolve(args[++index] ?? "");
      else if (arg === "--python-root") python = resolve(args[++index] ?? "");
      else if (arg === "--help" || arg === "-h") {
        console.log(HELP);
        process.exit(0);
      } else throw new Error(`Unknown argument: ${arg}\n${HELP}`);
    }
    await verify(owners(root, python), staticOnly);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
