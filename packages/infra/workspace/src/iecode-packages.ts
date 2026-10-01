// SPDX-License-Identifier: Apache-2.0
// Packing and fixture setup stay sequential to keep provenance and filesystem operations ordered.
/* eslint-disable no-await-in-loop */
/** Producer-owned archives for consumers outside the IECODE Bun workspace. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const members = ["inagle", "inagle-cross", "azalee"] as const;
const forbidden =
  /(^|\/)(?:\.env(?:\.[^/]*)?|node_modules|target|build|\.git|[^/]*\.(?:nds|nsp|nca|xci|cia|3ds|cpk|keys|pem|pfx|live_save|exe|dll|iso|rom|sav|sqlite|db|7z|zip))($|\/)/i;

async function command(argv: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv[0]} ${argv[1]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

export function validateArchiveEntries(entries: string[], allowed: string[]): void {
  for (const entry of entries) {
    const path = entry.replace(/^package\//, "").replace(/\/$/, "");
    if (!path) continue;
    if (
      entry.startsWith("/") ||
      path.split("/").includes("..") ||
      forbidden.test(path) ||
      /^(?:data|var)(?:\/|$)/.test(path)
    )
      throw new Error(`Private or unsafe archive entry: ${entry}`);
    if (!allowed.some((item) => path === item || path.startsWith(`${item}/`)))
      throw new Error(`Archive entry outside package allowlist: ${entry}`);
  }
}

export async function prepareIecodePackages(options: {
  source: string;
  destination: string;
  apply?: boolean;
  allowDirty?: boolean;
  expectedRevision?: string;
}) {
  const source = resolve(options.source);
  const destination = resolve(options.destination);
  const revision = await command(["git", "rev-parse", "HEAD"], source);
  if (options.expectedRevision && revision !== options.expectedRevision)
    throw new Error(`IECODE revision differs from configured source: ${revision}`);
  const dirty = Boolean(
    await command(["git", "status", "--porcelain", "--untracked-files=all"], source),
  );
  if (dirty && !options.allowDirty)
    throw new Error("IECODE source is dirty; use --allow-dirty for a recorded developer build.");
  const root = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const catalog = root.workspaces?.catalog ?? root.catalog ?? {};
  const packages = [];
  for (const member of members) {
    const directory = join(source, "packages", member);
    const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (!metadata.name || !metadata.version || !Array.isArray(metadata.files))
      throw new Error(`${member} requires name, version and an explicit files allowlist.`);
    const allowed = [
      ...metadata.files,
      "package.json",
      "README.md",
      "LICENSE",
      "LICENSE.md",
      "LICENSE.txt",
    ];
    if (
      allowed.some(
        (path: string) =>
          typeof path !== "string" ||
          path.includes("..") ||
          path.startsWith("/") ||
          forbidden.test(path),
      )
    )
      throw new Error(`${member} has an unsafe package files allowlist.`);
    packages.push({
      name: metadata.name as string,
      version: metadata.version as string,
      archive: `${member}-${revision}.tgz`,
      directory,
      allowed,
      entrypoints: [metadata.main, metadata.types, ...Object.values(metadata.bin ?? {})].filter(
        (value): value is string => typeof value === "string",
      ),
    });
  }
  const provenance = {
    schemaVersion: 1,
    sourceRevision: revision,
    dirty,
    allowDirty: Boolean(options.allowDirty),
    catalog,
  };
  if (!options.apply)
    return {
      ...provenance,
      applied: false,
      packages: packages.map(
        ({ directory: _directory, allowed: _allowed, entrypoints: _entrypoints, ...item }) => item,
      ),
    };
  if (destination === source || !relative(source, destination).startsWith(".."))
    throw new Error("Archive destination must be outside the producer checkout.");
  const stage = await mkdtemp(join(tmpdir(), "iecode-packages-"));
  try {
    const archives = [];
    for (const item of packages) {
      const archive = join(stage, item.archive);
      await command(
        [process.execPath, "pm", "pack", "--ignore-scripts", "--filename", archive],
        item.directory,
      );
      const entries = (await command(["tar", "-tzf", archive], source)).split("\n");
      validateArchiveEntries(entries, item.allowed);
      for (const entrypoint of item.entrypoints) {
        if (!entries.includes(`package/${entrypoint.replace(/^\.\//, "")}`))
          throw new Error(`${item.name} has a missing archive entrypoint: ${entrypoint}`);
      }
      const sha256 = createHash("sha256")
        .update(await readFile(archive))
        .digest("hex");
      archives.push({ name: item.name, version: item.version, archive: item.archive, sha256 });
    }
    const manifest = { ...provenance, applied: true, packages: archives };
    await mkdir(destination, { recursive: true });
    for (const item of archives)
      await copyFile(join(stage, item.archive), join(destination, item.archive));
    await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.shift() !== "prepare")
    throw new Error(
      "Usage: iecode-packages prepare --source <IECODE> --destination <output> [--apply] [--allow-dirty]",
    );
  const options = {
    source: "",
    destination: "",
    apply: false,
    allowDirty: false,
    expectedRevision: "",
  };
  let configPath = "";
  while (args.length) {
    const flag = args.shift();
    if (flag === "--apply") options.apply = true;
    else if (flag === "--allow-dirty") options.allowDirty = true;
    else if (flag === "--config") {
      configPath = args.shift() ?? "";
      if (!configPath || configPath.startsWith("--")) throw new Error("Missing value for --config");
    } else if (flag === "--source" || flag === "--destination") {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      options[flag === "--source" ? "source" : "destination"] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (configPath) {
    const configuration = JSON.parse(await readFile(configPath, "utf8")).iecode;
    if (!/^[a-f0-9]{40}$/.test(configuration.rev))
      throw new Error("IECODE requires a pinned revision.");
    options.source ||= resolve(dirname(resolve(configPath)), "..", configuration.path);
    options.expectedRevision = configuration.rev;
  }
  if (!options.source || !options.destination)
    throw new Error("Both --source and --destination are required.");
  console.log(JSON.stringify(await prepareIecodePackages(options), null, 2));
}
