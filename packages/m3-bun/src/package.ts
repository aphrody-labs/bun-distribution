// SPDX-License-Identifier: Apache-2.0
// `m3-bun package`: the distributable of an app. Compiles for a target, stages the executable with a README,
// the build manifest and checksums (and, on request, the generated deploy configs), archives it
// (tar.gz, or zip for Windows) and writes the archive's SHA-256. `--rootfs` also writes the root filesystem of a
// scratch image: the executable and exactly the shared libraries `ldd` lists for it.
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { compileApp, type CompileReport } from "./compile.ts";
import { loadApp, type CompileTargetName, type M3App } from "./config.ts";
import { generateTargets, contextFor } from "./targets/index.ts";
import { sha256 } from "./util.ts";

/** Absolute library paths from the output of `ldd`: `libc.so.6 => /lib/.../libc.so.6 (0x..)` and `/lib64/ld-linux-x86-64.so.2 (0x..)`. */
export function parseLdd(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const arrow = /=>\s*(\/\S+)/.exec(line);
    const bare = /^\s*(\/\S+)\s*\(0x/.exec(line);
    const path = arrow?.[1] ?? bare?.[1];
    if (path) paths.add(path);
  }
  return [...paths].toSorted();
}

export interface RootfsReport {
  dir: string;
  executable: string;
  libraries: string[];
  bytes: number;
}

/** Root filesystem of a scratch image: `/app/server` plus its libraries at their own absolute paths. Linux only. */
export async function buildRootfs(executable: string, dir: string): Promise<RootfsReport> {
  const ldd = Bun.spawnSync(["ldd", executable], { stdout: "pipe", stderr: "pipe" });
  const text = ldd.stdout.toString();
  if (ldd.exitCode !== 0 && !text.includes("=>")) {
    throw new Error(`m3-bun: ldd cannot read ${executable} (${ldd.stderr.toString().trim() || "not a dynamic executable for this host"}); build the rootfs on a host with the target's libc`);
  }
  const libraries = parseLdd(text);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "app"), { recursive: true });
  await cp(executable, join(dir, "app", "server"));
  await chmod(join(dir, "app", "server"), 0o755);
  let bytes = Bun.file(executable).size;
  for (const library of libraries) {
    const target = join(dir, library);
    await mkdir(dirname(target), { recursive: true });
    await cp(library, target, { dereference: true });
    bytes += Bun.file(target).size;
  }
  return { dir, executable: join(dir, "app", "server"), libraries, bytes };
}

export type ArchiveFormat = "tar.gz" | "zip";

/** Archive the contents of `staging` into `archive` with the system tool; modes are preserved. */
export async function archiveDir(staging: string, archive: string, format: ArchiveFormat): Promise<void> {
  await mkdir(dirname(archive), { recursive: true });
  await rm(archive, { force: true });
  if (format === "zip") {
    const proc = Bun.spawnSync(["zip", "-q", "-r", "-X", archive, "."], { cwd: staging, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) throw new Error(`m3-bun: zip failed: ${proc.stderr.toString().trim()}`);
    return;
  }
  const gnu = Bun.spawnSync(["tar", "--version"], { stdout: "pipe" }).stdout.toString().includes("GNU");
  const reproducible = gnu ? ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner"] : [];
  const proc = Bun.spawnSync(["tar", ...reproducible, "-czf", archive, "-C", staging, "."], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`m3-bun: tar failed: ${proc.stderr.toString().trim()}`);
}

export interface PackageOptions {
  dir?: string;
  configFile?: string;
  target?: CompileTargetName;
  /** Archive format (default zip for Windows targets, else tar.gz). */
  format?: ArchiveFormat;
  /** Output directory (default `<app>/release`). */
  out?: string;
  /** Also write `<out>/rootfs` for a scratch image (Linux glibc targets, on a Linux host). */
  rootfs?: boolean;
  /** Include the generated deploy configs under `deploy/` in the archive. */
  deploy?: boolean;
  /** Reuse an executable instead of compiling. */
  executable?: string;
  app?: M3App;
}

export interface PackageReport {
  archive: string;
  bytes: number;
  sha256: string;
  checksumFile: string;
  files: string[];
  compile?: CompileReport;
  rootfs?: RootfsReport;
}

const readmeText = (name: string, version: string, exe: string, port: number) => `${name} ${version}

One executable serves the UI and the API from the same process.

  ${exe}                  serve on $PORT (default ${port})
  ${exe} --port 8080      choose the port
  ${exe} --healthcheck    exit 0 when the running instance answers /healthz
  ${exe} --version

Endpoints: / (UI), /healthz, /api/m3/info and the app's own /api/* routes.
Verify the download with SHA256SUMS. Built with @aphrody/m3-bun; the executable embeds the Bun runtime.
`;

/** Compile, stage and archive an app. */
export async function packageApp(options: PackageOptions = {}): Promise<PackageReport> {
  const app = options.app ?? (await loadApp(resolve(options.dir ?? process.cwd()), options.configFile));
  const target = options.target ?? app.bun.compile?.target;
  const windows = (target ?? "").startsWith("windows");
  const format = options.format ?? (windows ? "zip" : "tar.gz");
  const out = resolve(options.out ?? join(app.dir, "release"));
  const exeName = `${app.name}${windows ? ".exe" : ""}`;
  const stem = `${app.name}-${app.version}-${target ?? `${process.platform}-${process.arch}`}`;
  const staging = join(out, ".staging", stem);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  let compile: CompileReport | undefined;
  let executable = options.executable ? resolve(options.executable) : undefined;
  if (!executable) {
    compile = await compileApp({ app, ...(target ? { target } : {}), outfile: join(staging, exeName) });
    executable = compile.outfile;
  } else {
    await cp(executable, join(staging, exeName));
    executable = join(staging, exeName);
  }
  await chmod(executable, 0o755).catch(() => undefined);

  const manifest = Bun.file(join(app.outdir, "m3-bun.manifest.json"));
  if (await manifest.exists()) await Bun.write(join(staging, "m3-bun.manifest.json"), manifest);
  await Bun.write(join(staging, "README.txt"), readmeText(app.name, app.version, windows ? exeName : `./${exeName}`, app.port));
  if (options.deploy) await generateTargets(["all"], contextFor(app), join(staging, "deploy"));
  const exeHash = sha256(new Uint8Array(await Bun.file(executable).arrayBuffer()));
  await Bun.write(join(staging, "SHA256SUMS"), `${exeHash}  ${exeName}\n`);

  let rootfs: RootfsReport | undefined;
  if (options.rootfs) rootfs = await buildRootfs(executable, join(out, "rootfs"));

  const archive = join(out, `${stem}.${format}`);
  await archiveDir(staging, archive, format);
  const archiveHash = sha256(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  const checksumFile = `${archive}.sha256`;
  await Bun.write(checksumFile, `${archiveHash}  ${basename(archive)}\n`);
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: staging, onlyFiles: true, dot: true }))).toSorted();
  await rm(join(out, ".staging"), { recursive: true, force: true });
  return { archive, bytes: Bun.file(archive).size, sha256: archiveHash, checksumFile, files, ...(compile ? { compile } : {}), ...(rootfs ? { rootfs } : {}) };
}
