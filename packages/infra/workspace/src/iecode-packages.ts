// SPDX-License-Identifier: Apache-2.0
// Packing and fixture setup stay sequential to keep provenance and filesystem operations ordered.
/* eslint-disable no-await-in-loop */
/** Producer-owned archives for consumers outside the IECODE Bun workspace. */
import { createHash } from "node:crypto";
import {
  appendFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const members = ["inagle", "inagle-cross", "azalee"] as const;
const archiveFormat = "canonical-tar-gzip-v2";
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
      !entry.startsWith("package/") ||
      entry.includes("\\") ||
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

/** tar metadata is inspected without extraction or executing archive content. */
export async function validateArchiveTypes(archive: string, cwd: string): Promise<void> {
  await command(
    [
      "python3",
      "-I",
      "-c",
      `import sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive:
        if not (member.isfile() or member.isdir()):
            raise SystemExit('Unsupported archive entry type: ' + member.name)
`,
      archive,
    ],
    cwd,
  );
}

/** Preserve Bun's package selection/content while removing host-dependent tar/gzip metadata. */
export async function canonicalizePackageArchive(archive: string, cwd: string): Promise<void> {
  await command(
    [
      "python3",
      "-I",
      "-c",
      `import gzip, io, os, sys, tarfile
path = sys.argv[1]
payload = io.BytesIO()
with tarfile.open(path, 'r:gz') as source:
    entries = source.getmembers()
    names = [entry.name for entry in entries]
    if len(names) != len(set(names)):
        raise SystemExit('Duplicate archive entry')
    with tarfile.open(fileobj=payload, mode='w', format=tarfile.PAX_FORMAT) as target:
        for entry in sorted(entries, key=lambda item: item.name):
            if not (entry.isfile() or entry.isdir()):
                raise SystemExit('Unsupported archive entry type: ' + entry.name)
            canonical = tarfile.TarInfo(entry.name)
            canonical.type = tarfile.DIRTYPE if entry.isdir() else tarfile.REGTYPE
            canonical.size = 0 if entry.isdir() else entry.size
            canonical.mode = 0o755 if entry.isdir() or entry.mode & 0o111 else 0o644
            canonical.mtime = 0
            canonical.uid = canonical.gid = 0
            canonical.uname = canonical.gname = ''
            canonical.pax_headers = {}
            target.addfile(canonical, source.extractfile(entry) if entry.isfile() else None)
with open(path + '.canonical', 'wb') as output:
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=9, mtime=0) as compressed:
        compressed.write(payload.getvalue())
os.replace(path + '.canonical', path)
`,
      archive,
    ],
    cwd,
  );
}

async function validatePackSource(directory: string, allowed: string[]): Promise<void> {
  const inspect = async (path: string): Promise<void> => {
    const status = await lstat(join(directory, path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!status) return;
    if (status.isSymbolicLink() || forbidden.test(path))
      throw new Error(`Private or linked package source refused before packing: ${path}`);
    if (status.isDirectory())
      for (const child of await readdir(join(directory, path))) await inspect(join(path, child));
  };
  for (const path of allowed) await inspect(path);
}

export async function prepareIecodePackages(options: {
  source: string;
  destination: string;
  apply?: boolean;
  allowDirty?: boolean;
  expectedRevision?: string;
}) {
  const source = await realpath(options.source);
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
      archive: `${member}-${revision}-v2.tgz`,
      directory,
      allowed,
      entrypoints: [metadata.main, metadata.types, ...Object.values(metadata.bin ?? {})].filter(
        (value): value is string => typeof value === "string",
      ),
    });
  }
  const provenance = {
    schemaVersion: 1,
    archiveFormat,
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
  const sourceRelative = relative(source, destination);
  if (
    !sourceRelative ||
    (!isAbsolute(sourceRelative) && sourceRelative !== ".." && !sourceRelative.startsWith("../"))
  )
    throw new Error("Archive destination must be outside the producer checkout.");
  for (let current = destination; current !== dirname(current); current = dirname(current)) {
    const status = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (status?.isSymbolicLink()) throw new Error("Archive destination contains a symlink.");
  }
  await mkdir(dirname(destination), { recursive: true });
  const lock = `${destination}.lock`;
  await mkdir(lock);
  let stage = "";
  try {
    stage = await mkdtemp(join(dirname(destination), ".iecode-packages-"));
    const archives = [];
    for (const item of packages) {
      await validatePackSource(item.directory, item.allowed);
      const archive = join(stage, item.archive);
      await command(
        [process.execPath, "pm", "pack", "--ignore-scripts", "--filename", archive],
        item.directory,
      );
      const entries = (await command(["tar", "-tzf", archive], source)).split("\n");
      validateArchiveEntries(entries, item.allowed);
      await validateArchiveTypes(archive, source);
      await canonicalizePackageArchive(archive, source);
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
    await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const present = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!present) await rename(stage, destination);
    else {
      if (!present.isDirectory()) throw new Error("Archive destination must be a directory.");
      // Revision-qualified immutable files publish first; manifest rename is the commit point.
      for (const item of archives) {
        const target = join(destination, item.archive);
        try {
          await link(join(stage, item.archive), target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const status = await lstat(target);
          if (
            !status.isFile() ||
            status.isSymbolicLink() ||
            createHash("sha256")
              .update(await readFile(target))
              .digest("hex") !== item.sha256
          )
            throw new Error(`Existing archive conflicts with provenance: ${item.archive}`);
        }
      }
      const manifestTarget = join(destination, "manifest.json");
      if ((await lstat(manifestTarget).catch(() => null))?.isSymbolicLink())
        throw new Error("Archive manifest must not be a symlink.");
      await rename(join(stage, "manifest.json"), manifestTarget);
    }
    return manifest;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

/** Pinned producer contract shared by archive preparation and the CI checkout. */
export async function readIecodeSource(configPath: string) {
  const configuration = JSON.parse(await readFile(configPath, "utf8")).iecode;
  if (!/^[a-f0-9]{40}$/.test(configuration?.rev))
    throw new Error("IECODE requires a pinned revision.");
  const slug = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\.git$/.exec(
    configuration.repository,
  )?.[1];
  if (
    configuration.repository !== "https://github.com/aphrody-labs/iecode.git" ||
    !slug ||
    configuration.path !== "../iecode" ||
    JSON.stringify(configuration.packages) !== JSON.stringify(members) ||
    configuration.envOverride !== "APHRODY_IECODE_ROOT"
  )
    throw new Error("Unsupported IECODE producer contract.");
  return {
    repository: configuration.repository as string,
    slug,
    revision: configuration.rev as string,
    path: configuration.path as string,
    envOverride: configuration.envOverride as string,
  };
}

if (import.meta.main && process.argv[2] === "source") {
  const args = process.argv.slice(3);
  let configPath = "";
  let field = "";
  let githubOutput = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--github-output") githubOutput = true;
    else if (flag === "--config" || flag === "--field") {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (flag === "--config") configPath = value;
      else field = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!configPath)
    throw new Error(
      "Usage: iecode-packages source --config <sibling-checkouts.json> [--field <name>] [--github-output]",
    );
  const source = await readIecodeSource(configPath);
  if (field && !Object.hasOwn(source, field)) throw new Error(`Unknown source field: ${field}`);
  if (githubOutput) {
    if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `repository=${source.slug}\nrevision=${source.revision}\n`,
    );
  }
  console.log(field ? source[field as keyof typeof source] : JSON.stringify(source, null, 2));
} else if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.shift() !== "prepare")
    throw new Error(
      "Usage: iecode-packages <prepare --source <IECODE> --destination <output> [--apply] [--allow-dirty] | source --config <file> [--field <name>] [--github-output]>",
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
    const configuration = await readIecodeSource(configPath);
    options.source ||=
      process.env[configuration.envOverride] ??
      resolve(dirname(resolve(configPath)), "..", configuration.path);
    options.expectedRevision = configuration.revision;
  }
  if (!options.source || !options.destination)
    throw new Error("Both --source and --destination are required.");
  console.log(JSON.stringify(await prepareIecodePackages(options), null, 2));
}
