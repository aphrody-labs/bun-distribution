// SPDX-License-Identifier: Apache-2.0
// Packing stays sequential so the archive order and revision provenance are deterministic.
/* eslint-disable no-await-in-loop */
/** Content-addressed archives of @aphrody/* packages for consumers outside this workspace (IECODE). */
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { canonicalTar, gzipCanonical, readTar, type TarMember } from "./canonical-tar.ts";

export interface AphrodyArchive {
  name: string;
  version: string;
  archive: string;
  sha256: string;
}
export interface AphrodyPackagesManifest {
  schemaVersion: 1;
  producer: "aphrody";
  revision: string;
  dirty: boolean;
  packages: AphrodyArchive[];
  /** Dependencies the consumer must supply itself (neither a member nor a pinned archive here). */
  external: string[];
}

type PackageJson = {
  version: string;
  exports?: unknown;
  main?: string;
  module?: string;
  scripts?: Record<string, string>;
};

/** Every file a consumer can import: exports targets (any condition), main and module. */
export function exportTargets(manifest: PackageJson): string[] {
  const targets = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") targets.add(value.replace(/^\.\//, ""));
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) visit(child);
  };
  visit(manifest.exports);
  for (const field of [manifest.main, manifest.module])
    if (field) targets.add(field.replace(/^\.\//, ""));
  return [...targets].filter((target) => !target.includes("*"));
}

/** Archive names carry the content hash, so a pin stays valid across unrelated producer commits. */
export function archiveName(name: string, sha256: string): string {
  return `aphrody-${name.replace(/^@aphrody\//, "")}-${sha256.slice(0, 16)}.tgz`;
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

/** Package name to directory for every tracked @aphrody/* member of the root `workspaces` globs. */
export async function aphrodyPackageDirectories(root: string): Promise<Map<string, string>> {
  const { workspaces } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = (Array.isArray(workspaces) ? workspaces : workspaces?.packages) ?? [];
  const globs = (negated: boolean) =>
    patterns
      .filter((pattern) => pattern.startsWith("!") === negated)
      .map((pattern) => new Bun.Glob(`${pattern.replace(/^!/, "")}/package.json`));
  const [include, exclude] = [globs(false), globs(true)];
  const directories = new Map<string, string>();
  for (const manifest of git(root, ["ls-files", "--", "*package.json"]).split("\n")) {
    if (
      !include.some((glob) => glob.match(manifest)) ||
      exclude.some((glob) => glob.match(manifest))
    )
      continue;
    const fullPath = join(root, manifest);
    if (!existsSync(fullPath)) continue;
    const { name } = JSON.parse(await readFile(fullPath, "utf8")) as { name?: string };
    if (name?.startsWith("@aphrody/")) directories.set(name, join(root, dirname(manifest)));
  }
  return directories;
}

/** The requested packages plus every @aphrody/* package they depend on at runtime. */
export async function aphrodyClosure(root: string, names: string[]) {
  const directories = await aphrodyPackageDirectories(root);
  const members = new Set<string>();
  const external = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop()!;
    if (members.has(name) || external.has(name)) continue;
    const directory = directories.get(name);
    if (!directory) {
      external.add(name);
      continue;
    }
    members.add(name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }))
      if (dependency.startsWith("@aphrody/")) queue.push(dependency);
  }
  return {
    members: [...members].toSorted().map((name) => ({ name, directory: directories.get(name)! })),
    external: [...external].toSorted(),
  };
}

async function archiveVersion(path: string): Promise<string> {
  const entry = readTar(Bun.gunzipSync(await readFile(path))).find(
    (item) => item.name === "package/package.json",
  );
  if (!entry) throw new Error(`${path} has no package/package.json`);
  return (JSON.parse(new TextDecoder().decode(entry.data)) as { version: string }).version;
}

/** Private or host-specific files that must never ship in a package archive. */
const PRIVATE_ENTRY =
  /(^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|node_modules|target|\.git|[^/]*\.(?:pem|pfx|key|keys|sqlite|db|7z|nds|nsp|nca|xci|cia|3ds|cpk|iso|rom|sav|live_save))($|\/)/i;

/** Refuses archive entries outside `package/`, with traversal, or matching {@link PRIVATE_ENTRY}. */
export function assertPublicEntries(entries: TarMember[], name: string) {
  for (const entry of entries) {
    const path = entry.name.replace(/^package\//, "");
    if (
      !entry.name.startsWith("package/") ||
      entry.name.includes("\\") ||
      path.split("/").includes("..") ||
      PRIVATE_ENTRY.test(path)
    )
      throw new Error(`${name} archive carries a private or unsafe entry: ${entry.name}`);
  }
}

const IMPORT_SPECIFIER =
  /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(["'])(\.\.?\/[^"']+)\2/gm;
const EXTERNAL_DIRECTORY = "package/.aphrody-external";

/**
 * Archive entries in which every relative import leaving the package directory is resolved: JSON
 * data owned elsewhere in the producer repository is embedded under `.aphrody-external/` and the
 * specifier rewritten to it; any other escaping import fails, since the archive could not satisfy it.
 */
export async function embedExternalImports(
  entries: TarMember[],
  packageDirectory: string,
  root: string,
): Promise<TarMember[]> {
  const result = [...entries];
  const embedded = new Set(entries.map((entry) => entry.name));
  const encoder = new TextEncoder();
  for (const [index, entry] of entries.entries()) {
    if (entry.type !== "file" || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;
    const source = new TextDecoder().decode(entry.data);
    const local = entry.name.replace(/^package\//, "");
    let rewritten = source;
    for (const [match, prefix, quote, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
      const target = resolve(packageDirectory, dirname(local), specifier!);
      if (target === packageDirectory || target.startsWith(packageDirectory + sep)) continue;
      const repositoryPath = relative(root, target).replaceAll("\\", "/");
      if (!target.endsWith(".json") || repositoryPath.startsWith(".."))
        throw new Error(`${local} imports ${specifier} outside its package`);
      const name = `${EXTERNAL_DIRECTORY}/${repositoryPath}`;
      if (!embedded.has(name)) {
        const data = new Uint8Array(await readFile(target));
        result.push({ name, type: "file", mode: 0o644, size: data.length, data });
        embedded.add(name);
      }
      let replacement = posix.relative(posix.dirname(entry.name), name);
      if (!replacement.startsWith(".")) replacement = `./${replacement}`;
      rewritten = rewritten.replace(match, `${prefix}${quote}${replacement}${quote}`);
    }
    if (rewritten !== source) {
      const data = encoder.encode(rewritten);
      result[index] = { ...entry, data, size: data.length };
    }
  }
  return result;
}

/**
 * Canonical archive whose manifest no longer carries producer-relative `file:` specs: each one is
 * replaced by the version of the pinned archive it named, which the consumer maps through its overrides.
 */
export function portableArchive(entries: TarMember[], pinned: Map<string, string>, name: string) {
  const encoder = new TextEncoder();
  return gzipCanonical(
    canonicalTar(
      entries.map((entry) => {
        if (entry.name !== "package/package.json") return entry;
        const manifest = JSON.parse(new TextDecoder().decode(entry.data)) as Record<
          string,
          unknown
        >;
        let changed = false;
        for (const field of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          const specs = manifest[field] as Record<string, string> | undefined;
          for (const [dependency, spec] of Object.entries(specs ?? {})) {
            if (!spec.startsWith("file:")) continue;
            const version = pinned.get(dependency);
            if (!version)
              throw new Error(`${name} depends on ${dependency} through unpinned ${spec}`);
            specs![dependency] = version;
            changed = true;
          }
        }
        if (!changed) return entry;
        const data = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
        return { ...entry, data, size: data.length };
      }),
    ),
  );
}

/** Pinned archives in `destination` that are missing or differ from the pin. */
export async function staleArchives(pin: AphrodyPackagesManifest, destination: string) {
  const stale: string[] = [];
  for (const item of pin.packages) {
    const path = join(destination, item.archive);
    if (!existsSync(path) || sha256Of(await readFile(path)) !== item.sha256) stale.push(item.name);
  }
  return stale;
}

export async function prepareAphrodyPackages(options: {
  root?: string;
  names: string[];
  destination: string;
  apply?: boolean;
  allowDirty?: boolean;
}): Promise<AphrodyPackagesManifest> {
  // Runtime resolution loads workspace packages; a Windows consumer reading a WSL checkout cannot.
  const root = resolve(
    options.root ?? process.env.APHRODY_ROOT ?? (await import("./runtime.ts")).infraRoot(),
  );
  const { members, external } = await aphrodyClosure(root, options.names);
  const revision = git(root, ["rev-parse", "HEAD"]);
  const dirty = Boolean(
    git(root, ["status", "--porcelain", "--", ...members.map((member) => member.directory)]),
  );
  if (dirty && !options.allowDirty)
    throw new Error("Packed @aphrody/* sources are dirty; commit them or pass --allow-dirty.");
  // The workspace resolves pinned external archives through its overrides or catalog.
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    overrides?: Record<string, string>;
    workspaces?: { catalog?: Record<string, string> };
  };
  const pinnedSpec = (name: string) =>
    rootManifest.overrides?.[name] ?? rootManifest.workspaces?.catalog?.[name];
  const stage = await mkdtemp(join(tmpdir(), "aphrody-packages-"));
  try {
    const packages: AphrodyArchive[] = [];
    const add = async (name: string, version: string, file: string) => {
      const sha256 = sha256Of(await readFile(file));
      const archive = archiveName(name, sha256);
      await rename(file, join(stage, archive));
      packages.push({ name, version, archive, sha256 });
    };
    const pinnedVersions = new Map<string, string>();
    for (const name of external) {
      const spec = pinnedSpec(name);
      if (spec?.startsWith("file:"))
        pinnedVersions.set(name, await archiveVersion(join(root, spec.slice("file:".length))));
    }
    for (const { name, directory } of members) {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as PackageJson;
      // Packages that export build output are built first; lifecycle scripts never run implicitly.
      if (exportTargets(manifest).some((target) => !existsSync(join(directory, target)))) {
        if (!manifest.scripts?.build)
          throw new Error(`${name} exports files that do not exist and has no build script`);
        const built = Bun.spawnSync(["bun", "run", "build"], {
          windowsHide: true,
          cwd: directory,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (built.exitCode !== 0)
          throw new Error(`bun run build failed for ${name}: ${built.stderr}`);
      }
      const out = join(stage, name.slice("@aphrody/".length));
      await mkdir(out, { recursive: true });
      const packed = Bun.spawnSync(
        ["bun", "pm", "pack", "--destination", out, "--quiet", "--ignore-scripts"],
        { windowsHide: true, cwd: directory, stdout: "pipe", stderr: "pipe" },
      );
      if (packed.exitCode !== 0)
        throw new Error(`bun pm pack failed for ${name}: ${packed.stderr}`);
      const [file] = await readdir(out);
      if (!file) throw new Error(`bun pm pack produced no archive for ${name}`);
      const archived = readTar(Bun.gunzipSync(await readFile(join(out, file))));
      assertPublicEntries(archived, name);
      const contents = await embedExternalImports(archived, directory, root);
      await writeFile(join(out, file), portableArchive(contents, pinnedVersions, name));
      const entries = new Set(contents.map((entry) => entry.name.replace(/^package\//, "")));
      const missing = exportTargets(manifest).filter((target) => !entries.has(target));
      if (missing.length)
        throw new Error(`${name} archive lacks exported files: ${missing.join(", ")}`);
      await add(name, manifest.version, join(out, file));
    }
    // External packages this workspace itself consumes as pinned archives (the Yolo runtime SDK) pass through.
    const unresolved: string[] = [];
    for (const name of external) {
      const spec = pinnedSpec(name);
      if (!spec?.startsWith("file:")) {
        unresolved.push(name);
        continue;
      }
      const source = join(root, spec.slice("file:".length));
      const copy = join(stage, `external-${basename(source)}`);
      await copyFile(source, copy);
      await add(name, pinnedVersions.get(name)!, copy);
    }
    const manifest: AphrodyPackagesManifest = {
      schemaVersion: 1,
      producer: "aphrody",
      revision,
      dirty,
      packages: packages.toSorted((left, right) => left.name.localeCompare(right.name)),
      external: unresolved,
    };
    if (options.apply) {
      const destination = resolve(options.destination);
      await mkdir(destination, { recursive: true });
      for (const item of packages)
        await rename(join(stage, item.archive), join(destination, item.archive));
      await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Credentials and host-specific paths that must never reach the public registry. */
const SECRET_TEXT =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|npm_[A-Za-z0-9]{36}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/;
const HOST_TEXT = /\/home\/aphro\b|\/mnt\/c\/Users\b|[A-Za-z]:\\Users\\aphro\b/;

/** Problems that forbid publishing an archive: unsafe entries, secrets, host paths, unshipped exports or specs. */
export function auditArchive(entries: TarMember[], name: string): string[] {
  const problems: string[] = [];
  try {
    assertPublicEntries(entries, name);
  } catch (error) {
    problems.push((error as Error).message);
  }
  const manifestEntry = entries.find((entry) => entry.name === "package/package.json");
  if (!manifestEntry) return [...problems, "archive has no package/package.json"];
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as PackageJson &
    Record<string, unknown>;
  const present = new Set(entries.map((entry) => entry.name.replace(/^package\//, "")));
  const missing = exportTargets(manifest).filter((target) => !present.has(target));
  if (missing.length) problems.push(`exports not shipped: ${missing.join(", ")}`);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"])
    for (const [dependency, spec] of Object.entries(
      (manifest[field] as Record<string, string> | undefined) ?? {},
    ))
      if (/^(?:workspace|catalog|file|link):/.test(spec))
        problems.push(`unpublishable spec ${dependency}@${spec}`);
  for (const entry of entries) {
    if (entry.type !== "file" || entry.size > 8_000_000) continue;
    const text = new TextDecoder().decode(entry.data);
    if (SECRET_TEXT.test(text)) problems.push(`credential-like text in ${entry.name}`);
    if (HOST_TEXT.test(text)) problems.push(`host path in ${entry.name}`);
  }
  return problems;
}

/** @aphrody/* runtime dependencies first, so every published spec resolves on the registry. */
export async function publishOrder(root: string, names: string[]): Promise<string[]> {
  const directories = await aphrodyPackageDirectories(root);
  const ordered: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = async (name: string) => {
    if (state.get(name) === "done" || !directories.has(name)) return;
    if (state.get(name) === "visiting") return; // cycles publish in discovery order
    state.set(name, "visiting");
    const manifest = JSON.parse(
      await readFile(join(directories.get(name)!, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }))
      if (dependency.startsWith("@aphrody/")) await visit(dependency);
    state.set(name, "done");
    ordered.push(name);
  };
  for (const name of names.toSorted()) await visit(name);
  return ordered;
}

export interface PublishOutcome {
  name: string;
  version: string;
  /** `staged`: the registry holds the version for owner approval (npm staged publishing). */
  status: "published" | "staged" | "unverified" | "current" | "ready" | "blocked" | "failed";
  detail?: string;
}

/** Registry state of one version: absent, or its tarball SHA-1 (npm `dist.shasum`). */
async function registryShasum(name: string, version: string, registry: string) {
  const url = new URL(`${registry.replace(/\/$/, "")}/${name.replace("/", "%2f")}`);
  // Registry/CDN responses can retain a pre-publication packument despite no-cache.
  // Give every visibility check a fresh cache key without changing package identity.
  url.searchParams.set("cache", String(Date.now()));
  const response = await fetch(url, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  if (response.status === 404) return { exists: false } as const;
  if (!response.ok) throw new Error(`registry ${response.status} for ${name}`);
  const packument = (await response.json()) as {
    versions?: Record<string, { dist?: { shasum?: string } }>;
    time?: Record<string, string>;
  };
  const published = packument.versions?.[version];
  // A timestamp reserves the version, but does not prove staged publishing:
  // public version metadata can lag the timestamp.
  if (!published && packument.time?.[version]) return { exists: true, shasum: undefined } as const;
  return published
    ? ({ exists: true, shasum: published.dist?.shasum } as const)
    : ({ exists: false } as const);
}

/**
 * Publishes @aphrody/* workspace members to the public npm registry with `bun publish`. Each package
 * is built when an export is missing, packed once, audited ({@link auditArchive}) and that exact
 * archive is published. A version already on the registry with identical bytes is `current`; with
 * different bytes it is `blocked` until the version is bumped. Without `apply` nothing is published.
 */
export async function publishAphrodyPackages(options: {
  root?: string;
  names?: string[];
  apply?: boolean;
  registry?: string;
}): Promise<PublishOutcome[]> {
  const root = resolve(options.root ?? process.env.APHRODY_ROOT ?? process.cwd());
  const registry = options.registry ?? "https://registry.npmjs.org";
  const directories = await aphrodyPackageDirectories(root);
  const names = options.names?.length ? options.names : [...directories.keys()];
  const unknown = names.filter((name) => !directories.has(name));
  if (unknown.length) throw new Error(`Not workspace members: ${unknown.join(", ")}`);
  const outcomes: PublishOutcome[] = [];
  const failed = new Set<string>();
  for (const name of await publishOrder(root, names)) {
    if (!names.includes(name)) continue;
    const directory = directories.get(name)!;
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as PackageJson & {
      private?: boolean;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const outcome = (status: PublishOutcome["status"], detail?: string) => {
      outcomes.push({ name, version: manifest.version, status, ...(detail ? { detail } : {}) });
      if (["blocked", "failed", "staged", "unverified"].includes(status)) failed.add(name);
    };
    if (manifest.private) {
      outcome("blocked", "private: true");
      continue;
    }
    const blockers = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(
      (dependency) => failed.has(dependency),
    );
    if (blockers.length) {
      outcome("blocked", `depends on unpublished ${blockers.join(", ")}`);
      continue;
    }
    if (exportTargets(manifest).some((target) => !existsSync(join(directory, target)))) {
      if (!manifest.scripts?.build) {
        outcome("blocked", "exports missing files and no build script");
        continue;
      }
      const built = Bun.spawnSync(["bun", "run", "build"], {
        windowsHide: true,
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (built.exitCode !== 0) {
        outcome("failed", `build: ${built.stderr.toString().trim().slice(-400)}`);
        continue;
      }
    }
    const stage = await mkdtemp(join(tmpdir(), "aphrody-publish-"));
    try {
      const packed = Bun.spawnSync(
        ["bun", "pm", "pack", "--destination", stage, "--quiet", "--ignore-scripts"],
        { windowsHide: true, cwd: directory, stdout: "pipe", stderr: "pipe" },
      );
      const [file] = await readdir(stage);
      if (packed.exitCode !== 0 || !file) {
        outcome("failed", `pack: ${packed.stderr.toString().trim().slice(-400)}`);
        continue;
      }
      const archive = join(stage, file);
      const bytes = await readFile(archive);
      const problems = auditArchive(readTar(Bun.gunzipSync(bytes)), name);
      if (problems.length) {
        outcome("blocked", problems.join("; "));
        continue;
      }
      const shasum = createHash("sha1").update(bytes).digest("hex");
      const state = await registryShasum(name, manifest.version, registry);
      if (state.exists) {
        if (state.shasum === shasum) outcome("current");
        else if (!state.shasum)
          outcome(
            "unverified",
            "registry version reserved but archive visibility is unconfirmed; recheck before republishing",
          );
        else
          outcome(
            "blocked",
            state.shasum
              ? "version already published with different content; bump it"
              : "version staged on the registry; approve it there or bump it",
          );
        continue;
      }
      if (!options.apply) {
        outcome("ready");
        continue;
      }
      const published = Bun.spawnSync(["bun", "publish", archive, "--access", "public"], {
        windowsHide: true,
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${published.stdout.toString()}${published.stderr.toString()}`.trim();
      if (published.exitCode !== 0)
        outcome(/previously staged version/.test(output) ? "staged" : "failed", output.slice(-400));
      else {
        // Staged versions stay invisible until approved, so success is confirmed on the registry.
        // The packument lags a fresh publish by seconds to minutes: poll before calling it staged.
        let after = await registryShasum(name, manifest.version, registry);
        for (let attempt = 0; attempt < 12 && !after.shasum; attempt++) {
          await Bun.sleep(10_000);
          after = await registryShasum(name, manifest.version, registry);
        }
        if (after.shasum === shasum) outcome("published");
        else if (after.shasum)
          outcome(
            "blocked",
            "registry archive differs from the submitted archive; investigate before bumping",
          );
        else
          outcome(
            "unverified",
            "publish command succeeded but registry archive visibility is unconfirmed; recheck before republishing",
          );
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  return outcomes;
}

const usage =
  "Usage: yolo ops aphrody-packages publish [--package <@aphrody/name>...] [--apply]\n" +
  "       yolo ops aphrody-packages prepare (--package <@aphrody/name>... | --pin <file> [--write-pin]) --destination <dir> [--apply] [--allow-dirty]";

export async function runAphrodyPackages(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === "publish") {
    const names: string[] = [];
    let apply = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--apply") apply = true;
      else if (rest[i] === "--package" && rest[i + 1] && !rest[i + 1]!.startsWith("--"))
        names.push(rest[++i]!);
      else throw new Error(`Unknown or incomplete argument: ${rest[i]}`);
    }
    const outcomes = await publishAphrodyPackages({ names, apply });
    for (const item of outcomes)
      console.log(
        `${item.status.padEnd(9)} ${item.name}@${item.version}${item.detail ? `  ${item.detail}` : ""}`,
      );
    // Pending approval and unverified visibility do not prove a completed release.
    return outcomes.some((item) =>
      ["failed", "blocked", "staged", "unverified"].includes(item.status),
    )
      ? 1
      : 0;
  }
  if (action !== "prepare") {
    console.log(usage);
    return action === "--help" || action === "-h" ? 0 : 64;
  }
  const names: string[] = [];
  let destination = "";
  let pinPath = "";
  let apply = false;
  let allowDirty = false;
  let writePin = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--package" || flag === "--destination" || flag === "--pin") {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--package") names.push(value);
      else if (flag === "--pin") pinPath = value;
      else destination = value;
    } else if (flag === "--apply") apply = true;
    else if (flag === "--allow-dirty") allowDirty = true;
    else if (flag === "--write-pin") writePin = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!destination || (!names.length && !pinPath))
    throw new Error("--destination and --package or --pin are required");
  if (writePin && !pinPath) throw new Error("--write-pin requires --pin");
  const pin =
    pinPath && existsSync(pinPath)
      ? (JSON.parse(await readFile(pinPath, "utf8")) as AphrodyPackagesManifest)
      : undefined;
  if (pin && !writePin) {
    // Archives already matching the pin need no producer work at all.
    if (!(await staleArchives(pin, destination)).length) {
      console.log(JSON.stringify({ status: "current", pin: pinPath, revision: pin.revision }));
      return 0;
    }
  }
  if (!names.length)
    names.push(
      ...(pin?.packages ?? []).map((item) => item.name).filter((n) => n.startsWith("@aphrody/")),
    );
  if (!names.length) throw new Error(`${pinPath} lists no packages; pass --package`);
  const manifest = await prepareAphrodyPackages({ names, destination, apply, allowDirty });
  if (pin && !writePin) {
    const produced = new Map(manifest.packages.map((item) => [item.name, item.sha256]));
    const drift = pin.packages.filter((item) => produced.get(item.name) !== item.sha256);
    if (drift.length)
      throw new Error(
        `Pin ${pinPath} is stale for ${drift.map((item) => item.name).join(", ")}; rerun with --write-pin and reinstall.`,
      );
  }
  if (writePin) await writeFile(pinPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
  return 0;
}

if (import.meta.main) process.exit(await runAphrodyPackages(process.argv.slice(2)));
