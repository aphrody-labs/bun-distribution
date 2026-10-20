// SPDX-License-Identifier: Apache-2.0
// Keep file IO and lifecycle probes bounded and ordered.
/* oxlint-disable no-await-in-loop */
// Run through Workspace build-factory; build an isolated, pinned application release.
import { cp, mkdir, copyFile, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { buildDependencies } from "@aphrody/bun-workspace/automation/bun-dependency-builds.ts";

const root = resolve(import.meta.dir, "../../../../");
if (Bun.env.APHRODY_BUILD_HOST !== "vps") {
  throw new Error("Use yolo ops build-factory run for this build.");
}
async function run(args: string[], cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(args, {
    windowsHide: true,
    cwd,
    env: { ...Bun.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited) throw new Error(`Failed: ${args.join(" ")}`);
}
async function output(args: string[]) {
  const child = Bun.spawn(args, {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(`Failed: ${args.join(" ")}`);
  return text.trim();
}
const revision = await output(["git", "rev-parse", "HEAD"]);
const id = `${revision.slice(0, 12)}-${Date.now()}`;
const stage = join(Bun.env.APHRODY_ARTIFACT_ROOT ?? root, "local-app", id);
const source = join(stage, "source");
const release = join(stage, "release");
await mkdir(source, { recursive: true });
await mkdir(join(release, "bin"), { recursive: true });
// Exact committed sources only; no private data, dirty files or sibling engine copies.
const archive = Bun.spawn(["git", "archive", revision], {
  windowsHide: true,
  cwd: root,
  stdout: "pipe",
});
const extract = Bun.spawn(["tar", "-x", "-C", source], {
  windowsHide: true,
  stdin: archive.stdout,
  stderr: "inherit",
});
if ((await extract.exited) || (await archive.exited)) throw new Error("Source archive extraction failed");
await run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], source);
const cargo = ["bash", "scripts/aphrody/build/rust/cargo-serial.sh"];
const lock = Bun.TOML.parse(await readFile(join(source, "Cargo.lock"), "utf8")) as {
  package: { name: string; version: string }[];
};
const bindgenVersion = lock.package.find(pkg => pkg.name === "wasm-bindgen")?.version;
if (!bindgenVersion) throw new Error("wasm-bindgen is missing from Cargo.lock");
const bindgen = Bun.spawn(["wasm-bindgen", "--version"], {
  windowsHide: true,
  stdout: "pipe",
  stderr: "pipe",
});
const installedBindgen = (await new Response(bindgen.stdout).text()).trim();
if ((await bindgen.exited) || installedBindgen !== `wasm-bindgen ${bindgenVersion}`) {
  await run([...cargo, "binstall", "--no-confirm", "--locked", "--version", bindgenVersion, "wasm-bindgen-cli"], root);
}
// Workspace owns native packaging, ABI checks, provenance and consumer smokes.
await run(
  [
    "bun",
    "packages/yolo-cli/src/index.ts",
    "ops",
    "bun-native",
    `--root=${source}`,
    `--package-root=${join(source, "packages/aphrody-bun")}`,
  ],
  root,
);
const target = Bun.env.CARGO_TARGET_DIR ?? join(source, "target");
const library = join(source, "packages/aphrody-bun/native/x86_64-unknown-linux-gnu/libaphrody_ffi.so");
Bun.env.APHRODY_FFI_LIB = library;
if (await buildDependencies(source, ["@aphrody/app-ui"])) throw new Error("UI dependency build failed");
await run(["bun", "run", "typecheck"], join(source, "packages/app-ui"));
await run(["bun", "test", "src"], join(source, "packages/app-ui"));
await run(["bun", "run", "build"], join(source, "packages/app-ui"), {
  APHRODY_FFI_LIB: library,
});
const ui = join(source, "packages/app-ui/dist");
// The web release needs the same canonical fonts, icons and sounds as the native host.
for (const line of (await readFile(join(source, "apps/aphrody-app/ui-dist.manifest"), "utf8")).split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  const [destination, canonical] = line.trim().split(/\s+/);
  if (!destination || !canonical || destination.includes("..") || canonical.startsWith("/")) {
    throw new Error(`Invalid asset manifest entry: ${line}`);
  }
  await mkdir(dirname(join(ui, destination)), { recursive: true });
  await copyFile(join(source, canonical), join(ui, destination));
}
await run([...cargo, "build", "--locked", "--release", "-p", "aphrody", "-p", "aphrody-kernel", "--bins"], source);
await cp(ui, join(release, "ui"), { recursive: true });
for (const name of ["aphrody", "aphrody-kernel"])
  await copyFile(join(target, "release", name), join(release, "bin", name));
// `aphrody-mcp` is the `aphrody` multi-call binary under its former name (dispatch on argv[0]).
await copyFile(join(target, "release", "aphrody"), join(release, "bin", "aphrody-mcp"));
// Same for `aphrody-embed` (worker, serve, install).
await copyFile(join(target, "release", "aphrody"), join(release, "bin", "aphrody-embed"));
await copyFile(library, join(release, "bin/libaphrody_ffi.so"));
await copyFile(join(dirname(library), "manifest.json"), join(release, "bin/native-manifest.json"));
const files: Record<string, { bytes: number; sha256: string }> = {};
for await (const path of new Bun.Glob("**/*").scan({
  cwd: release,
  onlyFiles: true,
})) {
  const data = await Bun.file(join(release, path)).arrayBuffer();
  files[path] = {
    bytes: data.byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  };
}
await Bun.write(
  join(release, "manifest.json"),
  `${JSON.stringify({ schema: 1, revision, id, target: "x86_64-unknown-linux-gnu", files }, null, 2)}\n`,
);
await run(["tar", "-czf", join(stage, "aphrody-local-app.tgz"), "-C", release, "."], root);
console.log(
  JSON.stringify({
    stage,
    archive: join(stage, "aphrody-local-app.tgz"),
    revision,
  }),
);
