// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Artifacts are activated one at a time so a refusal never leaves a partial set behind. */
import { $ } from "bun";
import type { BuildFactoryConfig } from "./build-factory.ts";

/** Local activation of factory binaries: verified download, ABI probe, atomic replacement on PATH. */
export interface FactoryInstallConfig {
  binDir: string;
  libRoot: string;
  stateFile: string;
  probeTimeoutSeconds: number;
}

export interface FactoryArtifact {
  name: string;
  remotePath: string;
}

export interface FactoryRemote {
  /** SHA-256 hex digest and size of a remote regular file. */
  describe(path: string): Promise<{ sha256: string; size: number }>;
  /** Copy a remote file to a local path. */
  fetch(path: string, local: string): Promise<void>;
}

export interface InstallRecord {
  name: string;
  status: "installed" | "unchanged" | "refused";
  sha256?: string;
  path?: string;
  target?: string;
  previous?: string | null;
  resolvedOnPath?: string | null;
  error?: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const join = (...parts: string[]) => parts.join("/").replaceAll(/\/{2,}/gu, "/");
const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function absolute(value: string, field: string): string {
  const home = Bun.env.HOME;
  const path = value.startsWith("~/") && home ? join(home, value.slice(2)) : value;
  if (!path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "."))
    throw new Error(`Invalid build factory install.${field}: expected an absolute path`);
  return path.replace(/\/$/u, "");
}

export function factoryInstallConfig(raw: unknown): FactoryInstallConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (key: string, fallback: string) => {
    const v = value[key] ?? fallback;
    if (typeof v !== "string" || !v) throw new Error(`Invalid build factory install.${key}`);
    return absolute(v, key);
  };
  const timeout = value.probeTimeoutSeconds ?? 20;
  if (!Number.isSafeInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 300)
    throw new Error("Build factory install.probeTimeoutSeconds must be between 1 and 300");
  return {
    binDir: text("binDir", "~/.local/bin"),
    libRoot: text("libRoot", "~/.local/lib/aphrody"),
    stateFile: text("stateFile", "~/.local/state/aphrody/factory-installs.jsonl"),
    probeTimeoutSeconds: timeout as number,
  };
}

/** Binary names a Cargo package declares under crates/ or apps/ of the checkout. */
async function cargoBinaries(root: string, packageName: string): Promise<string[]> {
  for (const top of ["crates", "apps"]) {
    let manifests: string[];
    try {
      manifests = [
        ...new Bun.Glob("**/Cargo.toml").scanSync({ cwd: join(root, top), onlyFiles: true }),
      ];
    } catch {
      continue;
    }
    for (const manifest of manifests) {
      if (manifest.split("/").length > 4) continue;
      const path = join(root, top, manifest);
      const parsed = Bun.TOML.parse(await Bun.file(path).text()) as {
        package?: { name?: string };
        bin?: { name?: string }[];
      };
      if (parsed.package?.name !== packageName) continue;
      const declared = (parsed.bin ?? []).map((bin) => bin.name).filter((n): n is string => !!n);
      if (declared.length) return declared;
      return (await Bun.file(join(parent(path), "src/main.rs")).exists()) ? [packageName] : [];
    }
  }
  throw new Error(`Cargo package not found in the checkout: ${packageName}`);
}

/** Binary artifacts a Cargo build command produces on the factory. */
export async function factoryArtifacts(
  config: BuildFactoryConfig,
  repository: string,
  command: readonly string[],
  localRoot: string,
  only: readonly string[] = [],
): Promise<FactoryArtifact[]> {
  const build = command.findIndex((arg) => arg === "build" || arg === "b");
  if (build === -1) throw new Error("Factory install needs a Cargo build command");
  const args = command.slice(build + 1);
  let profile = "debug";
  let target = "";
  const bins: string[] = [];
  const packages: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const split = arg.indexOf("=");
    const flag = split === -1 ? arg : arg.slice(0, split);
    const inline = split === -1 ? undefined : arg.slice(split + 1);
    const value = () => {
      const v = inline ?? args[++i];
      if (!v) throw new Error(`${flag} requires a value`);
      return v;
    };
    if (flag === "--release" || flag === "-r") profile = "release";
    else if (flag === "--profile") {
      const p = value();
      profile = p === "dev" || p === "test" ? "debug" : p === "bench" ? "release" : p;
    } else if (flag === "--target") target = value();
    else if (flag === "--bin") bins.push(value());
    else if (flag === "-p" || flag === "--package") packages.push(value());
  }
  if (!bins.length) for (const pkg of packages) bins.push(...(await cargoBinaries(localRoot, pkg)));
  if (only.some((bin) => !bins.includes(bin)))
    throw new Error(`Requested binaries are not produced by this command: ${only.join(", ")}`);
  const selected = only.length ? bins.filter((bin) => only.includes(bin)) : bins;
  if (!selected.length) throw new Error("No binary artifact derived; pass --bin or -p <package>");
  for (const name of [...selected, profile, target].filter(Boolean))
    if (!NAME.test(name)) throw new Error(`Invalid artifact component: ${name}`);
  const targetDir =
    repository === "aphrody"
      ? join(config.cacheRoot, "cargo", repository)
      : join(config.repositories[repository]!, "target");
  const dir = target ? join(targetDir, target, profile) : join(targetDir, profile);
  return [...new Set(selected)].map((name) => ({ name, remotePath: join(dir, name) }));
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** A binary that cannot start here (glibc/ABI/arch) must never replace the active one. */
async function probe(path: string, timeoutSeconds: number): Promise<string | null> {
  const child = Bun.spawn([path, "--version"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    timeout: timeoutSeconds * 1000,
    env: { ...Bun.env, RUST_LOG: "error" },
  });
  const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return code === 0 ? null : (err.trim() || `exit ${code}`).slice(-2000);
}

/** Download, verify, probe and atomically replace each binary; the previous one is preserved. */
export async function installFactoryArtifacts(
  artifacts: readonly FactoryArtifact[],
  revision: string,
  remote: FactoryRemote,
  install: FactoryInstallConfig,
): Promise<InstallRecord[]> {
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error("A full pinned Git revision is required");
  const release = join(install.libRoot, `factory-${revision.slice(0, 12)}`);
  const previousDir = join(release, "previous");
  await $`mkdir -p ${previousDir} ${install.binDir} ${parent(install.stateFile)}`.quiet();
  const records: InstallRecord[] = [];
  for (const { name, remotePath } of artifacts) {
    const path = join(release, name);
    const target = join(install.binDir, name);
    try {
      const { sha256: expected, size } = await remote.describe(remotePath);
      if (!/^[a-f0-9]{64}$/u.test(expected)) throw new Error("Remote digest is invalid");
      if (!(await Bun.file(path).exists()) || (await sha256(path)) !== expected) {
        const partial = `${path}.partial`;
        await $`rm -f ${partial}`.quiet();
        await remote.fetch(remotePath, partial);
        const valid = Bun.file(partial).size === size && (await sha256(partial)) === expected;
        if (!valid) {
          await $`rm -f ${partial}`.quiet();
          throw new Error(`Downloaded artifact digest/size mismatch for ${name}`);
        }
        await Bun.write(path, Bun.file(partial), { mode: 0o755 });
        await $`rm -f ${partial}`.quiet();
      }
      const failure = await probe(path, install.probeTimeoutSeconds);
      if (failure) throw new Error(`Artifact cannot run on this host: ${failure}`);
      let previous: string | null = null;
      if (await Bun.file(target).exists()) {
        if ((await sha256(target)) === expected) {
          records.push({ name, status: "unchanged", sha256: expected, path, target });
          continue;
        }
        previous = join(previousDir, name);
        await Bun.write(previous, Bun.file(target), { mode: 0o755 });
      }
      // Same-directory staging then rename: PATH never observes a partial binary.
      const staged = join(install.binDir, `.${name}.factory-${process.pid}`);
      await Bun.write(staged, Bun.file(path), { mode: 0o755 });
      await $`mv -f ${staged} ${target}`.quiet();
      const record: InstallRecord = {
        name,
        status: "installed",
        sha256: expected,
        path,
        target,
        previous,
        resolvedOnPath: Bun.which(name),
      };
      records.push(record);
      const log = Bun.file(install.stateFile);
      const prior = (await log.exists()) ? await log.text() : "";
      await Bun.write(
        install.stateFile,
        `${prior}${JSON.stringify({ at: new Date().toISOString(), revision, ...record })}\n`,
        { mode: 0o600 },
      );
    } catch (error) {
      records.push({
        name,
        status: "refused",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return records;
}

/** Remote access through the installed Infra SSH owner (exec for the digest, SFTP for bytes). */
export function infraRemote(
  target: string,
  run: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): FactoryRemote {
  return {
    async describe(path) {
      const result = await run([
        "ssh",
        "exec",
        "--host",
        target,
        "--cmd",
        `test -f ${quote(path)} && sha256sum -- ${quote(path)} && stat -c %s -- ${quote(path)}`,
      ]);
      const match = result.stdout.match(/^([a-f0-9]{64})\s+\S.*\n(\d+)\s*$/mu);
      if (result.exitCode !== 0 || !match)
        throw new Error(`Remote artifact unavailable: ${path} ${result.stderr.trim().slice(-500)}`);
      return { sha256: match[1]!, size: Number(match[2]) };
    },
    async fetch(path, local) {
      const result = await run(["ssh", "sftp", "--host", target, "--path", path, "--get", local]);
      if (result.exitCode !== 0 || !(await Bun.file(local).exists()))
        throw new Error(`SFTP download failed: ${path} ${result.stderr.trim().slice(-500)}`);
    },
  };
}
