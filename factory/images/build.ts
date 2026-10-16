// SPDX-License-Identifier: MIT
// `bun factory image plan|fetch|build|status <name> [--target T] [--host HOST] [--job ID]`
// Images build on a Linux Docker host (never WSL); tags stay on that host, nothing is pushed.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { planUsr } from "../usr/build.ts";

const here = import.meta.dir;
const sshOptions = ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"];
type Kind = "image" | "rootfs";
interface ImageSpec {
  usrComposition?: "server" | "cosmic" | "gaming";
  platforms: string[];
  targets: Record<string, Kind>;
}
interface Pin {
  version: string;
  file?: string;
  url?: string;
  sha256?: string;
  [key: string]: unknown;
}
interface ImagesManifest {
  host: string;
  remoteRoot: string;
  remoteTimeoutSeconds: number;
  sources: string;
  pins: Record<string, Pin>;
  images: Record<string, ImageSpec>;
}

const manifest: ImagesManifest = await Bun.file(join(here, "manifest.json")).json();
const sourcesDir = manifest.sources.replace(/^~/, homedir());

function spec(name: string) {
  const image = manifest.images[name];
  if (!image) throw new Error(`Unknown image ${name}; expected ${Object.keys(manifest.images).join("|")}`);
  return image;
}

function buildArgs(name: string): Record<string, string> {
  const { pins } = manifest;
  const bun = pins.bun as Pin & { assets: Record<string, string> };
  const common = { BUN_VERSION: bun.version };
  if (name === "bunos-alpine")
    return {
      ...common,
      ALPINE_VERSION: pins.alpine.version,
      BUN_SHA256_AMD64: bun.assets["bun-linux-x64-musl.zip"]!,
      BUN_SHA256_ARM64: bun.assets["bun-linux-aarch64-musl.zip"]!,
    };
  if (name === "bunos-ubuntu") {
    const kernel = pins["ubuntu-kernel"] as Pin & Record<"image" | "modules", { file: string; sha256: string }>;
    return {
      ...common,
      BUN_SHA256_AMD64: bun.assets["bun-linux-x64.zip"]!,
      UBUNTU_VERSION: pins.ubuntu.version,
      UBUNTU_BASE_SHA256: pins.ubuntu.sha256!,
      COSMIC_APT_SERVER: (pins.cosmic.apt as Record<string, string>).server!,
      COSMIC_APT_SUITE: (pins.cosmic.apt as Record<string, string>).suite!,
      COSMIC_APT_KEY: (pins.cosmic.apt as Record<string, string>).key!,
      KERNEL_BASE_URL: kernel.baseUrl as string,
      KERNEL_IMAGE_DEB: kernel.image.file,
      KERNEL_IMAGE_SHA256: kernel.image.sha256,
      KERNEL_MODULES_DEB: kernel.modules.file,
      KERNEL_MODULES_SHA256: kernel.modules.sha256,
    };
  }
  return { ...common, OMARCHY_VERSION: pins.omarchy.version, OMARCHY_SHA256: pins.omarchy.sha256! };
}

/** Generated inputs reused from the /usr factory: its pacman.conf, keys and composition package set. */
async function generated(name: string) {
  const composition = spec(name).usrComposition;
  if (!composition) return {};
  const usr = await planUsr(composition);
  const omarchy = manifest.pins.omarchy as Pin & { pacmanRepository: { name: string; server: string } };
  const bootOnly = new Set(["linux-cachyos", "linux-firmware", usr.manifest.kernelFallback]);
  const keys = [
    ...usr.manifest.repositories.flatMap(repo =>
      (repo.keys ?? []).map(key => `${key}@${(repo.keyserver ?? "keyserver.ubuntu.com").replace(/^hkps:\/\//, "")}`),
    ),
    `${omarchy.key}@${omarchy.keyserver}`,
  ];
  return {
    files: {
      "pacman.conf": `${usr.pacmanConf}[${omarchy.pacmanRepository.name}]\nServer = ${omarchy.pacmanRepository.server}\n`,
      "usr.packages": usr.packages.filter(pkg => !bootOnly.has(pkg)).join("\n") + "\n",
    },
    args: { PACMAN_KEYS: keys.join(" ") },
  };
}

export async function planImage(name: string) {
  const image = spec(name);
  const extra = await generated(name);
  return {
    name,
    ...image,
    buildArgs: { ...buildArgs(name), ...extra.args },
    generated: Object.keys(extra.files ?? {}),
  };
}

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

export async function fetchSources() {
  await mkdir(sourcesDir, { recursive: true });
  const results: Record<string, string> = {};
  for (const [id, pin] of Object.entries(manifest.pins)) {
    const entries: [string, string, string][] = [];
    if (pin.file && pin.url && pin.sha256) entries.push([pin.file, pin.url, pin.sha256]);
    for (const part of ["image", "modules"] as const) {
      const deb = pin[part] as { file: string; sha256: string } | undefined;
      if (deb) entries.push([deb.file, `${pin.baseUrl}/${deb.file}`, deb.sha256]);
    }
    for (const [asset, digest] of Object.entries((pin.assets as Record<string, string>) ?? {}))
      entries.push([`bun-${pin.version}-${asset}`, `${pin.url}${asset}`, digest]);
    for (const [file, url, digest] of entries) {
      const path = join(sourcesDir, file);
      if (!(await Bun.file(path).exists())) {
        const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        await Bun.write(path, response);
      }
      const actual = await sha256(path);
      if (actual !== digest) throw new Error(`${id} ${file}: sha256 ${actual} != ${digest}`);
      results[file] = digest;
    }
  }
  return { sources: sourcesDir, verified: results };
}

async function run(argv: string[], timeoutMs: number, capture = false, cwd?: string) {
  const proc = Bun.spawn(argv, { cwd, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"], timeout: timeoutMs });
  const out = capture ? await new Response(proc.stdout as ReadableStream).text() : "";
  if ((await proc.exited) !== 0) throw new Error(`${argv[0]} exited with ${proc.exitCode}`);
  return out;
}

function remoteScript(name: string, image: ImageSpec, targets: string[], args: Record<string, string>) {
  const flags = Object.entries(args)
    .map(([key, value]) => `--build-arg ${key}='${value.replaceAll("'", "")}'`)
    .join(" ");
  const lines = ["#!/usr/bin/env bash", "set -uo pipefail", 'cd "$(dirname "$0")"', "mkdir -p out", ": >status"];
  for (const target of targets) {
    const tag = `${name}:${target}`;
    const base = `docker buildx build --progress=plain --platform ${image.platforms.join(",")} --target ${target} ${flags} -f context/Containerfile context`;
    lines.push(`echo "== ${tag}"`);
    const rootfs =
      image.targets[target] === "rootfs"
        ? ` && { ${base} --output type=tar,dest=out/${name}-${target}-rootfs.tar && zstd -T0 -19 --rm -f out/${name}-${target}-rootfs.tar && echo "${name}-${target}-rootfs.tar.zst ok" >>status || echo "${name}-${target}-rootfs failed" >>status; }`
        : "";
    lines.push(`${base} -t ${tag} --load && echo "${tag} ok" >>status${rootfs} || echo "${tag} failed" >>status`);
  }
  lines.push(
    "docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep '^" + name + ":' >>status",
    "echo done >>status",
  );
  return lines.join("\n") + "\n";
}

async function build(name: string, host: string, only?: string) {
  const image = spec(name);
  const targets = only ? [only] : Object.keys(image.targets);
  for (const target of targets) if (!image.targets[target]) throw new Error(`Unknown target ${target} for ${name}`);
  const extra = await generated(name);
  const args = { ...buildArgs(name), ...extra.args };
  const job = `${name}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  const remote = `${manifest.remoteRoot}/${job}`;
  const stage = await mkdtemp(join(tmpdir(), "bun-os-image-"));
  try {
    await cp(join(here, name), join(stage, "context"), { recursive: true });
    for (const [file, content] of Object.entries(extra.files ?? {}))
      await Bun.write(join(stage, "context", file), content);
    await Bun.write(join(stage, "build.sh"), remoteScript(name, image, targets, args));
    await run(["ssh", ...sshOptions, host, `mkdir -p ${remote}`], 30_000);
    await run(["scp", ...sshOptions, "-r", "context", "build.sh", `${host}:${remote}/`], 120_000, false, stage);
    const seconds = manifest.remoteTimeoutSeconds;
    await run(
      [
        "ssh",
        ...sshOptions,
        host,
        `cd ${remote} || exit 1; setsid nohup timeout ${seconds} bash build.sh >build.log 2>&1 </dev/null & echo started`,
      ],
      30_000,
    );
    return { name, job, host, remote, targets, status: `bun factory image status ${name} --job ${job}` };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function status(host: string, job: string) {
  const remote = `${manifest.remoteRoot}/${job}`;
  const out = await run(
    ["ssh", ...sshOptions, host, `cd ${remote} && cat status; echo ---; tail -15 build.log; ls -la out`],
    30_000,
    true,
  );
  return { job, host, remote, report: out.split("\n") };
}

export async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { target: { type: "string" }, host: { type: "string" }, job: { type: "string" } },
  });
  const [action = "plan", name] = positionals;
  const host = values.host ?? manifest.host;
  if (action === "fetch") return fetchSources();
  if (!name) throw new Error(`Expected image name: ${Object.keys(manifest.images).join("|")}`);
  if (action === "plan") return planImage(name);
  if (action === "build") return build(name, host, values.target);
  if (action === "status") {
    if (!values.job) throw new Error("Missing --job");
    return status(host, values.job);
  }
  throw new Error("Expected image plan|fetch|build|status");
}

if (import.meta.main) console.log(JSON.stringify(await main(Bun.argv.slice(2)), null, 2));
