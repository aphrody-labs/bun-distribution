#!/usr/bin/env bun
/**
 * Builds the release assets of one target into `dist/release/<version>/`:
 *
 *   yolo-<version>-<target>.tar.gz   standalone `yolo` executable (bun build --compile), verified runtime
 *                                    artifact, SDK, templates
 *   yolo-<version>-crates.tar.gz     Rust sources of the aphrody-* crates for the desktop scaffold
 *   install.sh, install.ps1          the one-command installers
 *   SHA256SUMS, release.json         integrity and provenance
 *
 * It never starts Cargo: package the runtime first (`just yolo::runtime-package`). In CI every OS runs
 * this natively, so each target gets its own executable and library.
 *
 *   bun run scripts/release/release.ts [--out dist/release]
 *   bun run scripts/release/release.ts --check-inputs  validates source inputs without packaging
 *
 * `YOLO_BINARY=<path to the bun-forge artifact `yolo`>` packages that single executable (the fork engine with the CLI
 * compiled onto it) and adds its aliases `bun` and `vu` (symlinks, selected by argv0); without it the CLI is compiled
 * onto the Bun that runs this script and no alias is created.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hostTarget, verifyArtifact } from "@aphrody/runtime-sdk/artifact";
import { COMPILE_FLAGS } from "./compile-flags";
import { toolingAsset } from "./tooling-asset";

const root = resolve(import.meta.dir, "../../../");
const cliEntry = Bun.resolveSync("@aphrody/yolo-cli/cli", import.meta.dir);
const cliRoot = resolve(dirname(cliEntry), "..");
const sdkRoot = resolve(dirname(Bun.resolveSync("@aphrody/runtime-sdk/artifact", import.meta.dir)), "..");
const templates = join(root, "packages/m3-templates");
const outIndex = Bun.argv.indexOf("--out");
const outRoot = resolve(root, outIndex > 0 ? (Bun.argv[outIndex + 1] as string) : "dist/release");
const version = readFileSync(join(cliRoot, "VERSION"), "utf8").trim();
if (!Bun.semver.satisfies(version, "*")) throw new Error("Invalid release version");
for (const input of [
  cliEntry,
  join(sdkRoot, "LICENSE-APACHE"),
  join(templates, "stack.toml"),
  ...["install.sh", "install.ps1"].map(file => join(cliRoot, file)),
]) {
  if (!existsSync(input)) throw new Error(`Missing release source input: ${input}`);
}
if (Bun.argv.includes("--check-inputs")) {
  console.log("Release source inputs OK (package CLI, SDK and configured Material templates).");
  process.exit(0);
}
const target = hostTarget();
const windows = target.includes("windows");
const dir = join(outRoot, version);
const stage = join(outRoot, `.stage-${target}`);

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256").update(new Uint8Array(readFileSync(path))).digest("hex");

async function run(argv: string[], cwd = root): Promise<string> {
  const proc = Bun.spawn(argv, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.join(" ")} failed:\n${err || out}`);
  return out.trim();
}

const artifactDir = process.env["YOLO_RUNTIME_ARTIFACT"]
  ? resolve(process.env["YOLO_RUNTIME_ARTIFACT"]!)
  : join(root, "dist/runtime", target);
if (!existsSync(join(artifactDir, "manifest.json"))) {
  throw new Error(`No packaged runtime for ${target}: run \`just yolo::runtime-package\` first`);
}
const manifest = verifyArtifact(artifactDir);
const prebuilt = process.env["YOLO_BINARY"];
if (prebuilt && !existsSync(prebuilt)) throw new Error(`YOLO_BINARY ${prebuilt} does not exist`);
const tooling = prebuilt ? null : await toolingAsset(root);

rmSync(stage, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(stage, "bin"), { recursive: true });
mkdirSync(dir, { recursive: true });

// 1. standalone executable
const exe = join(stage, "bin", windows ? "yolo.exe" : "yolo");
if (prebuilt) {
  cpSync(prebuilt, exe);
  chmodSync(exe, 0o755);
  if (!windows) {
    // One executable, three names by argv0: yolo, bun (the engine) and vu (the vu runtime artifact).
    for (const alias of ["bun", "vu"]) symlinkSync("yolo", join(stage, "bin", alias));
  }
} else {
  await run([
    process.execPath,
    "build",
    "--compile",
    ...COMPILE_FLAGS,
    ...(tooling?.flags ?? []),
    "--define",
    `YOLO_VERSION=${JSON.stringify(version)}`,
    cliEntry,
    "--outfile",
    exe,
  ]);
}

// 2. data next to it: runtime artifact, SDK, templates
cpSync(artifactDir, join(stage, "artifact"), { recursive: true });
cpSync(sdkRoot, join(stage, "packages/engine/runtime"), {
  recursive: true,
  filter: src => !src.includes("node_modules"),
});
cpSync(templates, join(stage, "m3/templates"), {
  recursive: true,
  filter: src => !src.endsWith("awesome-audit.json"),
});
writeFileSync(join(stage, "VERSION"), `${version}\n`);
cpSync(join(sdkRoot, "LICENSE-APACHE"), join(stage, "LICENSE"));
mkdirSync(join(stage, "LICENSES"));
cpSync(join(root, "docs/reference/upstream-bun/LICENSE.md"), join(stage, "LICENSES/Bun-LICENSE.md"));
cpSync(join(root, "docs/reference/infra/THIRD_PARTY_LICENSES.md"), join(stage, "LICENSES/THIRD_PARTY_LICENSES.md"));
cpSync(join(root, "vendor.lock"), join(stage, "vendor.lock"));

const archive = `yolo-${version}-${target}.tar.gz`;
await run(["tar", "-czf", join(dir, archive), "-C", stage, "."]);

// 3. Rust sources for the desktop scaffold (target independent)
const crates = `yolo-${version}-crates.tar.gz`;
const crateStage = join(outRoot, ".stage-crates");
rmSync(crateStage, { recursive: true, force: true });
mkdirSync(crateStage, { recursive: true });
cpSync(join(stage, "LICENSES"), join(crateStage, "LICENSES"), {
  recursive: true,
});
cpSync(join(root, "vendor.lock"), join(crateStage, "vendor.lock"));
const imports = JSON.parse(readFileSync(join(root, "vendor.lock"), "utf8")) as {
  crates: { dir: string }[];
};
for (const imported of imports.crates) {
  const name = imported.dir.split("/").at(-1)!;
  if (!/^crates\/[A-Za-z0-9_-]+\/aphrody-[A-Za-z0-9_-]+$/.test(imported.dir) || !name.startsWith("aphrody-")) {
    throw new Error(`Invalid imported crate path: ${imported.dir}`);
  }
  cpSync(join(root, imported.dir), join(crateStage, imported.dir), {
    recursive: true,
    filter: src => !/(^|[\\/])(target|node_modules)([\\/]|$)/.test(src),
  });
}
await run(["tar", "-czf", join(dir, crates), "-C", crateStage, "."]);

// 4. installers, checksums, provenance
for (const script of ["install.sh", "install.ps1"]) cpSync(join(cliRoot, script), join(dir, script));
const files = readdirSync(dir)
  .filter(f => f !== "SHA256SUMS" && f !== "release.json")
  .toSorted();
writeFileSync(join(dir, "SHA256SUMS"), `${files.map(f => `${sha256(join(dir, f))}  ${f}`).join("\n")}\n`);
const commit = await run(["git", "rev-parse", "HEAD"]).catch(() => "unknown");
writeFileSync(
  join(dir, "release.json"),
  `${JSON.stringify(
    {
      name: "yolo",
      version,
      target,
      commit,
      runtime: {
        version: manifest.version,
        abi: manifest.abi,
        toolchain: manifest.toolchain,
      },
      tooling: tooling ? { sha256: tooling.sha256, abi: tooling.abi, embedded: true } : null,
      binary: prebuilt
        ? {
            source: "bun-forge",
            sha256: sha256(prebuilt),
            aliases: ["bun", "vu"],
          }
        : null,
      assets: files,
      bun: Bun.version,
    },
    null,
    2,
  )}\n`,
);
rmSync(stage, { recursive: true, force: true });
rmSync(crateStage, { recursive: true, force: true });
console.log(`Release ${version} (${target}) -> ${dir}\n  ${files.join("\n  ")}`);
