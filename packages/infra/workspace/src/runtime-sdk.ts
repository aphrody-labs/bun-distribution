// SPDX-License-Identifier: Apache-2.0
/** Workspace preparation of the pinned producer SDK before frozen Bun installation. */
import { access, lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface Pin {
  repository: string;
  path: string;
  rev: string;
  envOverride: string;
  sdk: { archive: string; sha256: string; version: string };
}
async function command(argv: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(argv[0] + " " + argv[1] + " failed: " + err.trim());
  return out.trim();
}
const exists = async (path: string) =>
  access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
async function regular(path: string) {
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink())
    throw new Error("Runtime SDK cache must use regular files: " + path);
}
async function verify(path: string, pin: Pin) {
  await regular(path);
  await regular(path + ".json");
  const bytes = await readFile(path);
  const metadata = JSON.parse(await readFile(path + ".json", "utf8"));
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== pin.sdk.sha256)
    throw new Error("Runtime SDK checksum differs from the pin");
  if (
    metadata.name !== "@aphrody/runtime-sdk" ||
    metadata.version !== pin.sdk.version ||
    metadata.archive !== pin.sdk.archive ||
    metadata.sha256 !== pin.sdk.sha256 ||
    metadata.yoloRevision !== pin.rev ||
    metadata.dirty !== false ||
    metadata.bytes !== bytes.length
  )
    throw new Error("Runtime SDK provenance differs from the pin");
}
export async function prepareRuntimeSdk(options: {
  root: string;
  source?: string;
  destination?: string;
  apply?: boolean;
}) {
  const root = resolve(options.root);
  const pin = (
    JSON.parse(await readFile(join(root, "config/sibling-checkouts.json"), "utf8")) as { yolo: Pin }
  ).yolo;
  if (
    !pin ||
    pin.repository !== "https://github.com/aphrody-labs/yolo.git" ||
    !/^[a-f0-9]{40}$/.test(pin.rev) ||
    pin.envOverride !== "APHRODY_YOLO_ROOT" ||
    !/^[a-f0-9]{64}$/.test(pin.sdk?.sha256 ?? "") ||
    pin.sdk.archive !==
      "aphrody-runtime-sdk-" + pin.sdk.version + "-" + pin.sdk.sha256.slice(0, 8) + ".tgz"
  )
    throw new Error("Unsupported pinned Yolo SDK contract");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (
    packageJson.workspaces?.catalog?.["@aphrody/runtime-sdk"] !==
    "file:.cache/yolo-packages/" + pin.sdk.archive
  )
    throw new Error("Runtime SDK catalog differs from the configured pin");
  const destination = resolve(options.destination ?? join(root, ".cache/yolo-packages"));
  const target = join(destination, pin.sdk.archive);
  const status = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (status && (!status.isDirectory() || status.isSymbolicLink()))
    throw new Error("SDK destination must be a real directory");
  if (await exists(target)) {
    await verify(target, pin);
    return { applied: false, cached: true, archive: target, revision: pin.rev };
  }
  if (!options.apply) return { applied: false, cached: false, archive: target, revision: pin.rev };
  const source = resolve(options.source ?? process.env[pin.envOverride] ?? resolve(root, pin.path));
  if (!(await exists(source)))
    throw new Error(
      "Existing Yolo source required; set APHRODY_YOLO_ROOT. Automatic cloning is disabled",
    );
  const remote = await command(["git", "remote", "get-url", "origin"], source);
  if (
    !/^https:\/\/github\.com\/aphrody-labs\/yolo\.git$/.test(remote) &&
    !/^git@github(?:-[a-z0-9-]+)?:aphrody-labs\/yolo\.git$/.test(remote)
  )
    throw new Error("Yolo source origin differs from the declared producer");
  await command(["git", "cat-file", "-e", pin.rev + "^{commit}"], source);
  const owner = join(source, "scripts/release/runtime_sdk_pack.ts");
  await regular(owner);
  const committed = await command(
    ["git", "show", pin.rev + ":scripts/release/runtime_sdk_pack.ts"],
    source,
  );
  if ((await readFile(owner, "utf8")).trim() !== committed)
    throw new Error(
      "Producer packaging script differs from the pin; preserve its changes and use a verified SDK cache",
    );
  await command([process.execPath, owner, destination, "--revision", pin.rev], source);
  await verify(target, pin);
  return { applied: true, cached: false, archive: target, revision: pin.rev };
}
if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: runtime-sdk.ts prepare [--root <consumer>] [--source <Yolo>] [--destination <cache>] [--apply]. Verified committed SDK only; existing producer or verified cache required. No clone, checkout, fetch or script copy. No Cargo or runtime activation.",
    );
  } else {
    if (args.shift() !== "prepare") throw new Error("Expected prepare; use --help");
    const options: Parameters<typeof prepareRuntimeSdk>[0] = { root: process.cwd() };
    while (args.length) {
      const arg = args.shift();
      if (arg === "--apply") options.apply = true;
      else if (arg === "--root" || arg === "--source" || arg === "--destination") {
        const value = args.shift();
        if (!value || value.startsWith("--")) throw new Error("Missing option value");
        options[arg.slice(2) as "root" | "source" | "destination"] = value;
      } else throw new Error("Unknown option: " + arg);
    }
    console.log(JSON.stringify(await prepareRuntimeSdk(options), null, 2));
  }
}
