#!/usr/bin/env bun
import { chmod, mkdir, open, realpath, stat, statfs, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

interface FactoryProfile {
  schemaVersion: 1;
  series: string;
  architecture: string;
  minimumFreeBytes: number;
  sourcePackages: string[];
  sourceArchive: string;
  securityArchive: string;
  keyring: string;
  sourcePockets: string[];
  sourceComponents: string[];
  jobDeadlineSeconds: number;
  ubuntuImage: string;
  toolchainPackages: string[];
  packageUser: string;
  engineLifetimeSeconds: number;
  sharedHeavyLockRelative: string;
}
interface ArchiveProof {
  path: string;
  bytes: number;
  sha256: string;
  name: string;
  url: string;
  expectedSha256: string;
  verified: boolean;
}
interface SourceProof {
  name: string;
  version: string;
  sourceDirectory: string;
  dsc: ArchiveProof | undefined;
  archives: ArchiveProof[];
  authentication: string;
  extraction: {
    tool: string;
    strongChecksumsRequired: boolean;
    defaultSignatureChecksPreserved: boolean;
    exitCode: number;
    signatureMessages: string[];
  };
}
const usage =
  "Ubuntu Bun OS factory (native/SSH/Docker Linux; no workstation WSL)\n" +
  "  status --root ABSOLUTE_DIRECTORY\n  sources [PACKAGE...] --root ABSOLUTE_DIRECTORY\n" +
  "  engine --root ABSOLUTE_DIRECTORY\n  toolchain --root ABSOLUTE_DIRECTORY\n" +
  "  package FILE.dsc --root ABSOLUTE_DIRECTORY [--chroot CROSS_BUILD_NAME]\n" +
  "  rootfs --root ABSOLUTE_DIRECTORY --config OWNED_LIVE_BUILD_DIRECTORY\n";
function parse(values: string[]) {
  const flags: Record<string, string> = {},
    positional: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const arg = values[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2),
      value = values[++i];
    if (!["root", "chroot", "config"].includes(key) || !value || value.startsWith("--") || flags[key])
      throw new Error("Invalid factory option " + arg);
    flags[key] = value;
  }
  return { flags, positional };
}
function owned(root: string, path: string) {
  const suffix = relative(root, path);
  if (!suffix || suffix === ".." || suffix.startsWith("../") || isAbsolute(suffix))
    throw new Error("Expected a path inside the selected factory root");
  return path;
}
async function sameDevice(root: string, path: string) {
  if ((await stat(root)).dev !== (await stat(path)).dev)
    throw new Error("Factory output must stay on its build filesystem");
}
async function command(args: string[], job: string, step: string, timeout = 120000) {
  const stdoutPath = join(job, "logs", step + ".stdout"),
    stderrPath = join(job, "logs", step + ".stderr");
  const [output, error] = await Promise.all([open(stdoutPath, "w"), open(stderrPath, "w")]);
  let code: number;
  try {
    const child = Bun.spawn({
      cmd: args,
      cwd: job,
      env: {
        ...Bun.env,
        TMPDIR: join(job, "tmp"),
        TMP: join(job, "tmp"),
        TEMP: join(job, "tmp"),
        XDG_CACHE_HOME: join(job, "cache"),
        DOCKER_CONFIG: join(job, "docker-config"),
      },
      stdin: "ignore",
      stdout: output.fd,
      stderr: error.fd,
      timeout,
    });
    await Bun.write(
      join(job, "status.json"),
      JSON.stringify(
        { schemaVersion: 1, status: "running", step, pid: process.pid, activeChildPid: child.pid, jobPath: job },
        null,
        2,
      ) + "\n",
    );
    code = await child.exited;
  } finally {
    await Promise.all([output.close(), error.close()]);
  }
  if (code !== 0) throw new Error(step + " failed exit=" + code + "; logs=" + job + "/logs/" + step);
  return { stdout: await Bun.file(stdoutPath).text(), stderr: await Bun.file(stderrPath).text() };
}
async function artifactProof(root: string, path: string) {
  const resolved = owned(root, await realpath(path));
  await sameDevice(root, resolved);
  const file = Bun.file(resolved),
    hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of file.stream()) hasher.update(chunk);
  return { path: resolved, bytes: (await stat(resolved)).size, sha256: hasher.digest("hex") };
}
function perlString(value: string) {
  return "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'";
}
async function configureSources(job: string, profile: FactoryProfile) {
  for (const path of [
    "etc/parts",
    "etc/sourceparts",
    "etc/preferencesparts",
    "etc/netrcparts",
    "etc/trustedparts",
    "state/lists/partial",
    "cache/archives/partial",
    "downloads",
    "sources",
    "gnupg",
  ])
    await mkdir(join(job, path), { recursive: true });
  await Bun.write(join(job, "state/status"), "");
  const sources =
    "Types: deb-src\nURIs: " +
    profile.sourceArchive +
    "\nSuites: " +
    profile.sourcePockets.filter(p => !p.endsWith("-security")).join(" ") +
    "\nComponents: " +
    profile.sourceComponents.join(" ") +
    "\nSigned-By: " +
    profile.keyring +
    "\n\n" +
    "Types: deb-src\nURIs: " +
    profile.securityArchive +
    "\nSuites: " +
    profile.series +
    "-security\nComponents: " +
    profile.sourceComponents.join(" ") +
    "\nSigned-By: " +
    profile.keyring +
    "\n";
  await Bun.write(join(job, "etc/ubuntu.sources"), sources);
  const config: Record<string, string> = {
    "Dir::Etc::main": "/dev/null",
    "Dir::Etc::parts": join(job, "etc/parts"),
    "Dir::Etc::sourcelist": join(job, "etc/ubuntu.sources"),
    "Dir::Etc::sourceparts": join(job, "etc/sourceparts"),
    "Dir::Etc::preferences": "/dev/null",
    "Dir::Etc::preferencesparts": join(job, "etc/preferencesparts"),
    "Dir::Etc::netrc": "/dev/null",
    "Dir::Etc::netrcparts": join(job, "etc/netrcparts"),
    "Dir::Etc::trusted": profile.keyring,
    "Dir::Etc::trustedparts": join(job, "etc/trustedparts"),
    "Dir::State": join(job, "state"),
    "Dir::State::status": join(job, "state/status"),
    "Dir::State::lists": join(job, "state/lists"),
    "Dir::State::extended_states": join(job, "state/extended_states"),
    "Dir::Cache": join(job, "cache"),
    "Dir::Cache::archives": join(job, "cache/archives"),
    "Dir::Cache::srcpkgcache": "",
    "Dir::Cache::pkgcache": "",
    "Dir::Log": join(job, "logs"),
    "APT::Get::AllowUnauthenticated": "false",
    "Acquire::AllowInsecureRepositories": "false",
    "Acquire::AllowDowngradeToInsecureRepositories": "false",
    "Acquire::Check-Valid-Until": "true",
    "Acquire::https::Verify-Peer": "true",
    "Acquire::https::Verify-Host": "true",
    "Acquire::https::Timeout": "30",
    "Acquire::Retries": "1",
    "APT::Get::List-Cleanup": "false",
  };
  await Bun.write(
    join(job, "apt.conf"),
    Object.entries(config)
      .map(([key, value]) => key + " " + JSON.stringify(value) + ";")
      .join("\n") + "\n",
  );
}

async function fetchSources(job: string, root: string, profile: FactoryProfile, names: string[]) {
  const keyring = profile.keyring;
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + profile.jobDeadlineSeconds * 1000;
  const env = {
    ...Bun.env,
    APT_CONFIG: job + "/apt.conf",
    TMPDIR: job + "/tmp",
    TMP: job + "/tmp",
    TEMP: job + "/tmp",
    XDG_CACHE_HOME: job + "/cache",
    GNUPGHOME: job + "/gnupg",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: job + "/cache/transpiler",
  };
  Bun.env.TMPDIR = env.TMPDIR;
  const state: Record<string, unknown> = {
    schemaVersion: 1,
    host: "vps",
    root,
    jobPath: job,
    pid: process.pid,
    startedAt,
    status: "running",
    step: "startup",
    activeChildPid: null,
  };
  async function status(step: string, extra: Record<string, unknown> = {}) {
    Object.assign(state, { step, ...extra });
    await Bun.write(job + "/status.json", JSON.stringify(state, null, 2) + "\n");
    console.log(new Date().toISOString() + " " + step);
  }
  async function run(
    args: string[],
    step: string,
    { cwd = job, limit = 120000 }: { cwd?: string; limit?: number } = {},
  ) {
    await status(step);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("source job deadline reached");
    const p = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: Math.min(limit, remaining) });
    await status(step, { activeChildPid: p.pid });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    await Bun.write(job + "/logs/" + step + ".stdout", stdout);
    await Bun.write(job + "/logs/" + step + ".stderr", stderr);
    await status(step, { activeChildPid: null, exitCode: code });
    if (code !== 0) throw new Error(step + " failed exit=" + code + "; logs=" + job + "/logs/" + step);
    return { stdout, stderr, code };
  }
  async function hash(path: string) {
    const f = Bun.file(path);
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of f.stream()) hasher.update(chunk);
    return { path, bytes: (await stat(path)).size, sha256: hasher.digest("hex") };
  }
  function field(text: string, name: string) {
    return text.match(new RegExp("^" + name + ":\\s*(.*)$", "m"))?.[1]?.trim();
  }
  function sourceHashes(text: string) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(line => line === "Checksums-Sha256:");
    if (start < 0) throw new Error("signed source metadata has no SHA256 checksums");
    const result: { sha256: string; bytes: number; name: string }[] = [];
    for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
      const m = lines[i].match(/^\s+([a-f0-9]{64})\s+(\d+)\s+(\S+)\s*$/);
      if (m) result.push({ sha256: m[1], bytes: Number(m[2]), name: m[3] });
    }
    if (!result.length) throw new Error("empty strong source checksum set");
    return result;
  }
  try {
    const osText = await Bun.file("/etc/os-release").text();
    const os = {
      id: osText.match(/^ID=(.*)$/m)?.[1]?.replaceAll('"', ""),
      versionId: osText.match(/^VERSION_ID=(.*)$/m)?.[1]?.replaceAll('"', ""),
      codename: osText.match(/^VERSION_CODENAME=(.*)$/m)?.[1]?.replaceAll('"', ""),
      architecture: "amd64",
    };
    if (os.id !== "ubuntu" || os.codename !== profile.series) throw new Error("unexpected host distribution");
    await run(["apt-get", "-o", "APT::Update::Error-Mode=any", "update"], "apt-update", { limit: 300000 });
    const releases = [];
    for await (const name of new Bun.Glob("*_InRelease").scan({ cwd: job + "/state/lists", onlyFiles: true })) {
      const path = job + "/state/lists/" + name;
      const verified = await run(
        ["gpgv", "--status-fd", "1", "--keyring", keyring, path],
        "verify-release-" + releases.length,
        { limit: 30000 },
      );
      const fingerprints = [...verified.stdout.matchAll(/^\[GNUPG:\] VALIDSIG ([a-f0-9]+)/gim)].map(match => match[1]);
      if (!fingerprints.length) throw new Error("no valid Ubuntu archive signature " + name);
      releases.push({ ...(await hash(path)), signatureVerified: true, signerFingerprints: fingerprints });
    }
    if (releases.length !== profile.sourcePockets.length)
      throw new Error("expected all authenticated Ubuntu pockets, got " + releases.length);
    const sources: SourceProof[] = [];
    for (const pkg of names) {
      const uriOutput = await run(
        ["apt-get", "--print-uris", "--download-only", "--only-source", "source", pkg],
        "uris-" + pkg,
        { cwd: job + "/downloads", limit: 30000 },
      );
      const uris = new Map(
        [...uriOutput.stdout.matchAll(/^'([^']+)'\s+(\S+)\s+(\d+)\s+(.*)$/gm)].map(m => [
          m[2],
          { url: m[1], bytes: Number(m[3]), aptHash: m[4] },
        ]),
      );
      await run(["apt-get", "--download-only", "--only-source", "source", pkg], "download-" + pkg, {
        cwd: job + "/downloads",
        limit: 180000,
      });
      const names = [];
      for await (const name of new Bun.Glob(pkg + "_*.dsc").scan({ cwd: job + "/downloads", onlyFiles: true }))
        names.push(name);
      if (names.length !== 1) throw new Error("expected one DSC for " + pkg);
      const dscName = names[0],
        dscPath = job + "/downloads/" + dscName,
        dscText = await Bun.file(dscPath).text();
      const version = field(dscText, "Version"),
        sourceName = field(dscText, "Source");
      if (sourceName !== pkg || !version) throw new Error("DSC identity mismatch " + pkg);
      const meta = await run(["apt-cache", "--only-source", "showsrc", pkg], "metadata-" + pkg, { limit: 30000 });
      const record = meta.stdout
        .split(/\n\s*\n/)
        .find(record => field(record, "Package") === pkg && field(record, "Version") === version);
      if (!record) throw new Error("authenticated source record not found " + pkg + "=" + version);
      const files: ArchiveProof[] = [];
      for (const expected of sourceHashes(record)) {
        if (expected.name.includes("/") || expected.name.includes("\\"))
          throw new Error("source archive filename escapes downloads");
        const path = job + "/downloads/" + expected.name;
        const actual = await hash(path);
        if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
          throw new Error("source archive hash/size mismatch " + expected.name);
        const uri = uris.get(expected.name);
        if (!uri || !uri.url.startsWith("https://"))
          throw new Error("missing authenticated HTTPS source URI " + expected.name);
        files.push({ ...actual, name: expected.name, url: uri.url, expectedSha256: expected.sha256, verified: true });
      }
      const sourceDirectory = job + "/sources/" + pkg;
      const extraction = await run(
        [
          "dpkg-source",
          "--require-strong-checksums",
          "--no-overwrite-dir",
          "--no-copy",
          "--threads-max=1",
          "--extract",
          dscPath,
          sourceDirectory,
        ],
        "extract-" + pkg,
        { limit: 120000 },
      );
      if (!(await Bun.file(sourceDirectory + "/debian/changelog").exists()))
        throw new Error("missing extracted Debian source metadata " + pkg);
      sources.push({
        name: pkg,
        version,
        sourceDirectory,
        dsc: files.find(file => file.name === dscName),
        archives: files.filter(file => file.name !== dscName),
        authentication: "Ubuntu signed InRelease -> authenticated Sources SHA256 -> verified DSC and archive SHA256",
        extraction: {
          tool: "dpkg-source",
          strongChecksumsRequired: true,
          defaultSignatureChecksPreserved: true,
          exitCode: 0,
          signatureMessages: extraction.stderr
            .split(/\r?\n/)
            .filter(line => /signature|key|gpg/i.test(line))
            .slice(0, 12),
        },
      });
      await status("source-ready-" + pkg, {
        packagesReady: sources.map(source => ({
          name: source.name,
          version: source.version,
          sourceDirectory: source.sourceDirectory,
        })),
      });
    }
    const receipt = {
      schemaVersion: 1,
      status: "complete",
      host: "vps",
      os,
      root,
      job: {
        path: job,
        pid: process.pid,
        startedAt,
        completedAt: new Date().toISOString(),
        deadlineSeconds: profile.jobDeadlineSeconds,
      },
      executor: {
        bunVersion: Bun.version,
        bunRevision: Bun.revision,
        apt: (await run(["apt-get", "--version"], "apt-version", { limit: 10000 })).stdout.split("\n")[0],
        dpkgSource: (await run(["dpkg-source", "--version"], "dpkg-source-version", { limit: 10000 })).stdout.split(
          "\n",
        )[0],
      },
      archive: {
        repositories: [profile.sourceArchive, profile.securityArchive],
        suites: profile.sourcePockets,
        components: profile.sourceComponents,
        signedBy: keyring,
        keyring: await hash(keyring),
        inRelease: releases,
      },
      packages: sources,
      scope: {
        operation: "source-retrieval-and-extraction",
        builds: false,
        installs: false,
        globalAptStateModified: false,
        temporaryRoot: env.TMPDIR,
      },
      guidance: [
        "https://documentation.ubuntu.com/project/contributors/setup/get-the-source-of-a-package/",
        "https://documentation.ubuntu.com/project/contributors/setup/set-up-for-ubuntu-development/",
      ],
    };
    await Bun.write(job + "/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
    await status("complete", { status: "complete", exitCode: 0, receiptPath: job + "/receipt.json" });
    return receipt;
  } catch (error) {
    await status("failed", { status: "failed", exitCode: 1, error: String(error) });
    throw error;
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
async function engineRecord(root: string) {
  const directory = join(root, "engine"),
    file = Bun.file(join(directory, "launcher.pid"));
  if (!(await file.exists())) throw new Error("No factory Docker engine launcher");
  const pid = Number((await file.text()).trim());
  if (!Number.isSafeInteger(pid) || pid < 1 || !alive(pid))
    throw new Error("Factory Docker engine launcher is not live");
  return {
    root,
    directory,
    pid,
    socket: "unix://" + join(directory, "docker.sock"),
    dataRoot: join(directory, "data"),
  };
}
async function launchEngine(root: string, job: string, profile: FactoryProfile) {
  const directory = join(root, "engine");
  for (const path of ["data", "run", "tmp", "logs", "cache"]) await mkdir(join(directory, path), { recursive: true });
  await sameDevice(root, directory);
  if (await Bun.file(join(directory, "launcher.pid")).exists()) {
    const previous = await engineRecord(root);
    return { schemaVersion: 1, kind: "factory-engine-existing", ...previous };
  }
  await command(["sudo", "-n", "true"], job, "engine-permission", 10000);
  await Bun.write(join(directory, "daemon.json"), "{}\n");
  const log = await open(join(directory, "logs/daemon.log"), "a");
  const child = Bun.spawn({
    cmd: [
      "nohup",
      "sudo",
      "-n",
      "env",
      "TMPDIR=" + join(directory, "tmp"),
      "TMP=" + join(directory, "tmp"),
      "TEMP=" + join(directory, "tmp"),
      "XDG_CACHE_HOME=" + join(directory, "cache"),
      "timeout",
      "--kill-after=15",
      String(profile.engineLifetimeSeconds),
      "dockerd",
      "--config-file=" + join(directory, "daemon.json"),
      "--data-root=" + join(directory, "data"),
      "--exec-root=" + join(directory, "run"),
      "--pidfile=" + join(directory, "dockerd.pid"),
      "--host=unix://" + join(directory, "docker.sock"),
      "--group=docker",
      "--bridge=none",
      "--iptables=false",
      "--ip6tables=false",
      "--ip-masq=false",
      "--ip-forward=false",
      "--userland-proxy=false",
      "--containerd-namespace=bun-os-factory",
      "--containerd-plugins-namespace=bun-os-factory-plugins",
    ],
    cwd: job,
    stdin: "ignore",
    stdout: log.fd,
    stderr: log.fd,
  });
  child.unref();
  await Bun.write(join(directory, "launcher.pid"), String(child.pid) + "\n");
  await log.close();
  return {
    schemaVersion: 1,
    kind: "factory-engine-start-requested",
    root,
    pid: child.pid,
    socket: "unix://" + join(directory, "docker.sock"),
    dataRoot: join(directory, "data"),
    lifetimeSeconds: profile.engineLifetimeSeconds,
    globalDaemonModified: false,
  };
}
async function dockerOwner(root: string, job: string) {
  const engine = await engineRecord(root);
  const args = ["docker", "--host", engine.socket];
  const result = await command([...args, "info", "--format", "{{json .}}"], job, "docker-info", 30000);
  const info = JSON.parse(result.stdout) as { DockerRootDir: string; OSType: string; Architecture: string };
  const data = await realpath(info.DockerRootDir);
  if (info.OSType !== "linux" || data !== (await realpath(engine.dataRoot)))
    throw new Error("Docker endpoint does not own the factory Linux data root");
  owned(root, data);
  await sameDevice(root, data);
  return { engine, args, info };
}
async function provisionTools(root: string, job: string, profile: FactoryProfile) {
  const owner = await dockerOwner(root, job);
  if (!/^ubuntu:(\d+\.\d+)$/.test(profile.ubuntuImage) && !/^ubuntu@sha256:[a-f0-9]{64}$/.test(profile.ubuntuImage))
    throw new Error("Expected the official Ubuntu OCI image");
  await command(
    [...owner.args, "pull", "--platform", "linux/" + profile.architecture, profile.ubuntuImage],
    job,
    "ubuntu-image-pull",
    180000,
  );
  const base = JSON.parse(
    (await command([...owner.args, "image", "inspect", profile.ubuntuImage], job, "ubuntu-image-inspect", 30000))
      .stdout,
  ) as { Id: string; RepoDigests: string[] }[];
  const digest = base[0]?.RepoDigests.find(value => /^ubuntu@sha256:[a-f0-9]{64}$/.test(value));
  if (!digest) throw new Error("Ubuntu base has no immutable registry digest");
  const recipe =
    "FROM " +
    digest +
    "\nENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update && " +
    "apt-get install -y --no-install-recommends " +
    profile.toolchainPackages.join(" ") +
    "\n" +
    "RUN dpkg-query -W -f='" +
    "$" +
    "{binary:Package}\\t" +
    "$" +
    "{Version}\\n' > /usr/share/bun-os-factory-packages.txt\n";
  const dockerfile = join(job, "Dockerfile");
  await Bun.write(dockerfile, recipe);
  const tag = "bun-os-factory:" + profile.series + "-" + profile.architecture;
  await command(
    [...owner.args, "build", "--network=host", "--progress=plain", "--tag", tag, "--file", dockerfile, job],
    job,
    "toolchain-build",
    1800000,
  );
  const images = JSON.parse(
    (await command([...owner.args, "image", "inspect", tag], job, "toolchain-image-inspect", 30000)).stdout,
  ) as { Id: string; Size: number }[];
  const image = images[0];
  if (!image?.Id.startsWith("sha256:")) throw new Error("Toolchain image identity unavailable");
  const tools = await command(
    [
      ...owner.args,
      "run",
      "--rm",
      "--network=none",
      "--cpus=2",
      "--memory=2g",
      image.Id,
      "bash",
      "-eu",
      "-c",
      "sbuild --version; lb --version; germinate --version; " +
        "dpkg-query -W apt dpkg-dev sbuild mmdebstrap uidmap schroot debootstrap live-build livecd-rootfs germinate debian-cd; " +
        "cat /etc/os-release; ldd --version",
    ],
    job,
    "toolchain-tools",
    30000,
  );
  const receipt = {
    schemaVersion: 1,
    kind: "ubuntu-toolchain",
    status: "complete",
    root,
    series: profile.series,
    architecture: profile.architecture,
    image: { tag, id: image.Id, bytes: image.Size, base: digest },
    engine: owner.engine,
    tools: tools.stdout,
    qualification: { sourceBuilds: false, cleanSbuildChroot: false, rootfsBuilt: false, osImageBuilt: false },
  };
  await Bun.write(join(root, "toolchain.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
async function buildContainer(
  root: string,
  job: string,
  profile: FactoryProfile,
  action: string,
  positional: string[],
  flags: Record<string, string>,
) {
  const owner = await dockerOwner(root, job);
  const receipt = (await Bun.file(join(root, "toolchain.json")).json()) as { status: string; image: { id: string } };
  if (receipt.status !== "complete") throw new Error("Qualified factory toolchain image required");
  const common = [
    ...owner.args,
    "run",
    "--rm",
    "--network=host",
    "--cpus=2",
    "--memory=4g",
    "--pids-limit=1024",
    "--cap-add=SYS_ADMIN",
    "--security-opt=seccomp=unconfined",
    "--security-opt=apparmor=unconfined",
    ...(action === "package" ? [] : ["--mount", "type=bind,source=" + root + ",target=/factory"]),
    "--env",
    action === "package" ? "TMPDIR=/job/tmp" : "TMPDIR=/factory/" + relative(root, join(job, "tmp")),
  ];
  if (action === "package") {
    if (
      positional.length !== 1 ||
      !positional[0]!.endsWith(".dsc") ||
      (flags.chroot && !/^[a-z0-9][a-z0-9._-]+$/.test(flags.chroot))
    )
      throw new Error("Expected owned DSC and optional provisioned cross-build schroot");
    const source = owned(root, await realpath(resolve(positional[0]!)));
    const artifacts = join(job, "artifacts"),
      home = join(job, "home"),
      cache = join(job, "cache");
    const containerPath = (path: string) => "/job/" + relative(job, path);
    await chmod(job, 0o755);
    await mkdir(artifacts);
    await mkdir(join(home, ".config/sbuild"), { recursive: true });
    await chmod(join(job, "tmp"), 0o1777);
    const config = [
      "$chroot_mode = 'unshare';",
      "$unshare_mmdebstrap_keep_tarball = 1;",
      "$unshare_tmpdir_template = " + perlString(containerPath(join(job, "tmp/tmp.sbuild.XXXXXXXXXX"))) + ";",
      "$clean_source = 0;",
      "$run_lintian = 0;",
      "$log_dir = " + perlString(containerPath(join(job, "logs"))) + ";",
      "$unshare_mmdebstrap_extra_args = ['*', [" +
        [
          "--include=ca-certificates,debhelper,ubuntu-keyring",
          "--keyring=" + profile.keyring,
          "--components=main,universe",
          ...profile.sourcePockets.map(
            pocket =>
              "deb [signed-by=" +
              profile.keyring +
              "] " +
              (pocket.endsWith("-security") ? profile.securityArchive : profile.sourceArchive) +
              " " +
              pocket +
              " main universe",
          ),
        ]
          .map(perlString)
          .join(", ") +
        "]];",
      "1;",
      "",
    ].join("\n");
    await Bun.write(join(home, ".config/sbuild/config.pl"), config);
    const input = await artifactProof(root, source);
    const dscText = await Bun.file(source).text(),
      sourceName = source.split("/").at(-1)!;
    const checksumBlock = dscText.match(/^Checksums-Sha256:\r?\n((?:[ \t].*\r?\n)+)/m)?.[1];
    if (!checksumBlock) throw new Error("Source descriptor requires SHA256 archive checksums");
    const sourceFiles = [{ ...input, name: sourceName }];
    for (const line of checksumBlock.trim().split(/\r?\n/)) {
      const record = line.trim().match(/^([a-f0-9]{64})\s+(\d+)\s+([a-zA-Z0-9][a-zA-Z0-9.+:_~-]*)$/);
      if (!record) throw new Error("Invalid source archive checksum record");
      const proof = await artifactProof(root, source.slice(0, source.lastIndexOf("/") + 1) + record[3]);
      if (proof.sha256 !== record[1] || proof.bytes !== Number(record[2]))
        throw new Error("Source descriptor archive checksum mismatch " + record[3]);
      sourceFiles.push({ ...proof, name: record[3]! });
    }
    const sourceMounts = sourceFiles.flatMap(file => [
      "--mount",
      "type=bind,source=" + file.path + ",target=/source/" + file.name + ",readonly",
    ]);
    const backend = flags.chroot ? ["--chroot-mode=schroot", "--chroot=" + flags.chroot] : ["--chroot-mode=unshare"];
    await command(
      [
        ...common,
        "--user",
        profile.packageUser,
        "--mount",
        "type=bind,source=" + job + ",target=/job",
        ...sourceMounts,
        "--env",
        "HOME=" + containerPath(home),
        "--env",
        "XDG_CACHE_HOME=" + containerPath(cache),
        "--env",
        "DEB_BUILD_OPTIONS=parallel=2 nocheck",
        "--workdir",
        containerPath(artifacts),
        receipt.image.id,
        "timeout",
        "--kill-after=15",
        "7200",
        "sbuild",
        "--dist=" + profile.series,
        "--arch=" + profile.architecture,
        ...backend,
        "--no-clean-source",
        "--no-run-lintian",
        "--build-dir=" + containerPath(artifacts),
        "/source/" + sourceName,
      ],
      job,
      "package-build",
      7230000,
    );
    const outputs: { path: string; bytes: number; sha256: string; control: string | null }[] = [];
    for await (const name of new Bun.Glob("*").scan({ cwd: artifacts, onlyFiles: true, followSymlinks: false })) {
      if (!/\.(deb|ddeb|changes|buildinfo)$/.test(name)) continue;
      const proof = await artifactProof(root, join(artifacts, name));
      const control = name.endsWith(".deb")
        ? (
            await command(
              [
                ...owner.args,
                "run",
                "--rm",
                "--network=none",
                "--cpus=1",
                "--memory=1g",
                "--pids-limit=128",
                "--mount",
                "type=bind,source=" + proof.path + ",target=/artifact.deb,readonly",
                receipt.image.id,
                "dpkg-deb",
                "--field",
                "/artifact.deb",
                "Package",
                "Version",
                "Architecture",
              ],
              job,
              "inspect-package-" + outputs.length,
              30000,
            )
          ).stdout
        : null;
      outputs.push({ ...proof, control });
    }
    if (!outputs.some(file => file.path.endsWith(".deb"))) throw new Error("sbuild produced no binary package");
    const chroots = [];
    const chrootCache = join(cache, "sbuild");
    if (await Bun.file(join(chrootCache, profile.series + "-" + profile.architecture + ".tar")).exists())
      chroots.push(await artifactProof(root, join(chrootCache, profile.series + "-" + profile.architecture + ".tar")));
    const nativeDiagnostics: string[] = [];
    for await (const name of new Bun.Glob("*.build").scan({
      cwd: join(job, "logs"),
      onlyFiles: true,
      followSymlinks: false,
    })) {
      const lines = (await Bun.file(join(job, "logs", name)).text()).split(/\r?\n/);
      nativeDiagnostics.push(
        ...lines.filter(line => /mounting \/proc failed|cannot bind-mount \/dev\/console/.test(line)),
      );
    }
    const procMountFailed = nativeDiagnostics.some(line => line.includes("mounting /proc failed"));
    return {
      schemaVersion: 1,
      kind: "ubuntu-package-build",
      status: "complete",
      root,
      jobPath: job,
      imageId: receipt.image.id,
      backend: flags.chroot ? "schroot" : "unshare",
      buildOptions: "parallel=2 nocheck",
      input,
      sourceFiles,
      namespace: {
        status: procMountFailed ? "limited" : "no-mount-errors-reported",
        procMountFailed,
        diagnostics: [...new Set(nativeDiagnostics)],
      },
      artifacts: outputs,
      chroots,
      qualification: {
        binaryPackagesBuilt: true,
        cleanSbuildChroot: chroots.length > 0,
        rootfsBuilt: false,
        osImageBuilt: false,
      },
    };
  } else {
    if (positional.length || !flags.config) throw new Error("Expected owned prepared live-build configuration");
    const config = owned(root, await realpath(resolve(flags.config)));
    await sameDevice(root, config);
    await command(
      [...common, "--workdir", "/factory/" + relative(root, config), receipt.image.id, "lb", "build"],
      job,
      "rootfs-build",
      14400000,
    );
  }
  return {
    schemaVersion: 1,
    kind: action + "-command-complete",
    root,
    jobPath: job,
    imageId: receipt.image.id,
    qualification: "Inspect and hash resulting artifacts before product qualification",
  };
}
async function main() {
  const [action = "help", ...values] = Bun.argv.slice(2);
  if (action === "help" || action === "--help") {
    console.log(usage);
    return;
  }
  if (process.platform !== "linux")
    throw new Error("Run the Bun factory on the selected Linux native/SSH/Docker context");
  const { flags, positional } = parse(values);
  if (!flags.root || !isAbsolute(flags.root)) throw new Error("Explicit absolute factory --root required");
  const requested = resolve(flags.root);
  if (requested === "/" || requested === Bun.env.HOME) throw new Error("Select a dedicated factory directory");
  await mkdir(requested, { recursive: true });
  const root = await realpath(requested);
  const profile: FactoryProfile = await Bun.file(join(import.meta.dir, "profile.json")).json();
  if (
    profile.schemaVersion !== 1 ||
    !/^[a-z][a-z0-9-]*$/.test(profile.series) ||
    !/^[a-z0-9]+$/.test(profile.architecture) ||
    !/^[a-z][a-z0-9_-]*$/.test(profile.packageUser) ||
    profile.sourceComponents.some(value => !/^[a-z]+$/.test(value)) ||
    profile.toolchainPackages.some(value => !/^[a-z0-9][a-z0-9+.-]+$/.test(value))
  )
    throw new Error("Invalid factory profile");
  const filesystem = await statfs(root, { bigint: true }),
    freeBytes = filesystem.bavail * filesystem.bsize;
  if (action === "status") {
    console.log(
      JSON.stringify(
        {
          root,
          freeBytes: freeBytes.toString(),
          requiredBytes: profile.minimumFreeBytes,
          profile,
          lock: (await Bun.file(join(root, ".factory.lock")).exists())
            ? await Bun.file(join(root, ".factory.lock")).text()
            : null,
          engine: (await Bun.file(join(root, "engine/launcher.pid")).exists()) ? await engineRecord(root) : null,
          hostTools: ["apt-get", "apt-cache", "dpkg-source", "gpgv", "docker", "dockerd", "timeout", "flock"].map(
            name => ({ name, path: Bun.which(name) }),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!["sources", "engine", "toolchain", "package", "rootfs"].includes(action))
    throw new Error("Unknown factory action " + action);
  if (freeBytes < BigInt(profile.minimumFreeBytes)) throw new Error("Factory filesystem has less than 50 GiB free");
  if (["toolchain", "package", "rootfs"].includes(action) && Bun.env.BUN_OS_SHARED_LOCK_HELD !== "1") {
    const temporary = join(root, "tmp");
    await mkdir(temporary, { recursive: true });
    await sameDevice(root, temporary);
    const child = Bun.spawn({
      cmd: [
        "flock",
        "-n",
        resolve(root, profile.sharedHeavyLockRelative),
        process.execPath,
        import.meta.path,
        ...Bun.argv.slice(2),
      ],
      cwd: root,
      env: {
        ...Bun.env,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        BUN_OS_SHARED_LOCK_HELD: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "cache/transpiler"),
      },
      stdout: "inherit",
      stderr: "inherit",
      timeout: action === "rootfs" ? 15000000 : action === "package" ? 7800000 : 2400000,
    });
    process.exitCode = await child.exited;
    if (process.exitCode !== 0)
      console.error(
        "Shared factory execution failed exit=" +
          process.exitCode +
          "; lock=" +
          resolve(root, profile.sharedHeavyLockRelative),
      );
    return;
  }
  const lockFile = join(root, ".factory.lock"),
    lock = await open(lockFile, "wx");
  const startedAt = new Date().toISOString();
  const job = owned(
    root,
    join(root, action + "-jobs", startedAt.replace(/[:.]/g, "") + "-" + process.pid + "-" + crypto.randomUUID()),
  );
  const token = JSON.stringify({ pid: process.pid, action, jobPath: job, startedAt });
  await lock.writeFile(token + "\n");
  try {
    for (const path of ["tmp", "logs", "cache", "docker-config", "gnupg"])
      await mkdir(join(job, path), { recursive: true });
    await sameDevice(root, job);
    const selected = positional.length ? positional : profile.sourcePackages;
    if (action === "sources" && (!selected.length || selected.some(name => !/^[a-z0-9][a-z0-9+.-]+$/.test(name))))
      throw new Error("Expected Debian source package names");
    if (action === "sources") await configureSources(job, profile);
    const result =
      action === "sources"
        ? await fetchSources(job, root, profile, selected)
        : action === "engine"
          ? await launchEngine(root, job, profile)
          : action === "toolchain"
            ? await provisionTools(root, job, profile)
            : await buildContainer(root, job, profile, action, positional, flags);
    await Bun.write(join(job, "receipt.json"), JSON.stringify(result, null, 2) + "\n");
    await Bun.write(
      join(job, "status.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: "complete",
          step: "complete",
          exitCode: 0,
          pid: process.pid,
          jobPath: job,
          receiptPath: join(job, "receipt.json"),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await Bun.write(
      join(job, "status.json"),
      JSON.stringify(
        { schemaVersion: 1, status: "failed", exitCode: 1, pid: process.pid, jobPath: job, error: String(error) },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    await lock.close();
    if ((await Bun.file(lockFile).text()).trim() === token) await unlink(lockFile);
  }
}
if (import.meta.main)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
