// SPDX-License-Identifier: MIT
// `bun factory usr plan|build|fetch [--composition server|cosmic|gaming] [--verity] [--host HOST] [--job ID]`
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const here = import.meta.dir;
const workspace = resolve(here, "../..");
type UsrComposition = "server" | "cosmic" | "gaming";
interface Repository {
  name: string;
  server: string;
  keys?: string[];
  keyserver?: string;
}
interface UsrManifest {
  host: string;
  builderImage: string;
  builderPackages: string[];
  remoteRoot: string;
  remoteTimeoutSeconds: number;
  localArtifacts: string;
  repositories: Repository[];
  basePackages: string[];
  kernelFallback: string;
  compositions: Record<UsrComposition, { profile: string; packages: string[] }>;
  hierarchy: {
    rootLinks: Record<string, string>;
    usrLinks: Record<string, string>;
    usrDirectories: string[];
    required: string[];
  };
  overlay: string;
  images: { erofsCompression: string; squashfsCompression: string };
}

const sshOptions = ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"];

export async function planUsr(composition: UsrComposition) {
  const manifest: UsrManifest = await Bun.file(join(here, "manifest.json")).json();
  const profile = await Bun.file(join(workspace, "factory/profile.json")).json();
  const selected = manifest.compositions[composition];
  if (!selected) throw new Error(`Unknown usr composition: ${composition}`);
  const chain: string[] = [];
  for (let id: string | undefined = selected.profile; id; id = profile.compositions[id]?.extends) chain.unshift(id);
  const packages = [
    ...new Set([
      ...manifest.basePackages,
      ...chain.flatMap(id => profile.compositions[id].packages as string[]),
      ...selected.packages,
    ]),
  ];
  const pacmanConf = [
    "[options]",
    "HoldPkg = pacman glibc",
    "Architecture = auto",
    "ParallelDownloads = 8",
    "SigLevel = Required DatabaseOptional",
    "LocalFileSigLevel = Optional",
    "",
    ...manifest.repositories.flatMap(repo => [`[${repo.name}]`, `Server = ${repo.server}`, ""]),
  ].join("\n");
  return { manifest, composition, packages, pacmanConf };
}

function pairs(map: Record<string, string>) {
  return Object.entries(map)
    .map(([name, target]) => `${name}=${target}`)
    .join(" ");
}

async function run(argv: string[], timeoutMs: number) {
  const proc = Bun.spawn(argv, { stdio: ["ignore", "inherit", "inherit"], timeout: timeoutMs });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${argv[0]} exited with ${code}`);
}

function localArtifacts(manifest: UsrManifest, composition: string, job: string) {
  return join(manifest.localArtifacts.replace(/^~/, homedir()), composition, job);
}

async function fetchArtifacts(manifest: UsrManifest, host: string, composition: string, job: string) {
  const local = localArtifacts(manifest, composition, job);
  await mkdir(local, { recursive: true });
  await run(
    ["scp", ...sshOptions, "-r", `${host}:${manifest.remoteRoot}/${job}/out/.`, local],
    manifest.remoteTimeoutSeconds * 1000,
  );
  return local;
}

async function build(composition: UsrComposition, host: string, verity: boolean) {
  const { manifest, packages, pacmanConf } = await planUsr(composition);
  const job = `${composition}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  const remote = `${manifest.remoteRoot}/${job}`;
  const stage = await mkdtemp(join(tmpdir(), "bun-os-usr-"));
  try {
    const keys = manifest.repositories.flatMap(repo => repo.keys ?? []);
    const keyserver = manifest.repositories.find(repo => repo.keyserver)?.keyserver ?? "hkps://keyserver.ubuntu.com";
    const env = {
      KEYS: keys.join(" "),
      KEYSERVER: keyserver,
      FALLBACK_KERNEL: manifest.kernelFallback,
      BUILDER_PACKAGES: manifest.builderPackages.join(" "),
      USR_DIRS: manifest.hierarchy.usrDirectories.join(" "),
      ROOT_LINKS: pairs(manifest.hierarchy.rootLinks),
      USR_LINKS: pairs(manifest.hierarchy.usrLinks),
      REQUIRED: manifest.hierarchy.required.join(" "),
      EROFS_COMPRESSION: manifest.images.erofsCompression,
      SQUASHFS_COMPRESSION: manifest.images.squashfsCompression,
      VERITY: verity ? "1" : "0",
    };
    await Bun.write(
      join(stage, "env"),
      Object.entries(env)
        .map(([key, value]) => `${key}='${value.replaceAll("'", "")}'`)
        .join("\n") + "\n",
    );
    await Bun.write(join(stage, "pacman.conf"), pacmanConf);
    await Bun.write(join(stage, "packages.txt"), packages.join("\n") + "\n");
    await Bun.write(join(stage, "builder.sh"), Bun.file(join(here, "builder.sh")));
    await run(["ssh", ...sshOptions, host, `mkdir -p ${remote}`], 30_000);
    await run(
      [
        "scp",
        ...sshOptions,
        "-r",
        ...["env", "pacman.conf", "packages.txt", "builder.sh"].map(f => join(stage, f)),
        resolve(workspace, manifest.overlay),
        `${host}:${remote}/`,
      ],
      120_000,
    );
    const seconds = manifest.remoteTimeoutSeconds;
    const script = [
      `set -e; cd ${remote}`,
      `timeout ${seconds} docker run --rm --privileged --name bun-os-usr-${job} -v ${remote}:/job ${manifest.builderImage} bash /job/builder.sh > build.log 2>&1 || { tail -40 build.log; exit 1; }`,
      "rm -rf overlay",
      "tail -12 build.log",
    ].join("; ");
    await run(["ssh", ...sshOptions, host, script], (seconds + 120) * 1000);
    const local = await fetchArtifacts(manifest, host, composition, job);
    return { job, host, remote, local, packages };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      composition: { type: "string", default: "server" },
      host: { type: "string" },
      job: { type: "string" },
      verity: { type: "boolean", default: false },
    },
  });
  const composition = values.composition as UsrComposition;
  if (!["server", "cosmic", "gaming"].includes(composition))
    throw new Error("Expected --composition server|cosmic|gaming");
  const action = positionals[0] ?? "plan";
  const plan = await planUsr(composition);
  const host = values.host ?? plan.manifest.host;
  if (action === "plan") return { composition, host, packages: plan.packages, pacmanConf: plan.pacmanConf };
  if (action === "build") return build(composition, host, values.verity!);
  if (action === "fetch") {
    if (!values.job) throw new Error("Missing --job");
    return { local: await fetchArtifacts(plan.manifest, host, composition, values.job) };
  }
  throw new Error("Expected usr plan|build|fetch");
}

if (import.meta.main) console.log(JSON.stringify(await main(Bun.argv.slice(2)), null, 2));
