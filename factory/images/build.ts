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
interface AgentTooling {
  packages: string[];
  skills: {
    name: string;
    source?: string;
    repo?: string;
    commit?: string;
    path?: string;
  }[];
  mcpServers: {
    name: string;
    command: string[];
    source?: string;
    env?: Record<string, string>;
  }[];
}
interface ImageSpec {
  usrComposition?: "server" | "cosmic" | "gaming";
  agentTooling?: AgentTooling;
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
  const bun = pins.bun!;
  const common = { BUN_VERSION: bun.version };
  if (name === "bunos-alpine") {
    const musl = pins["bun-musl"] as Pin & { assets: Record<string, string> };
    return {
      BUN_VERSION: musl.version,
      ALPINE_VERSION: pins.alpine.version,
      BUN_SHA256_AMD64: musl.assets["bun-linux-x64-musl.zip"]!,
      BUN_SHA256_ARM64: musl.assets["bun-linux-aarch64-musl.zip"]!,
    };
  }
  if (name === "bunos-ubuntu") {
    const kernel = pins["ubuntu-kernel"] as Pin & Record<"image" | "modules", { file: string; sha256: string }>;
    return {
      ...common,
      BUN_URL: bun.url!,
      BUN_SHA256_AMD64: bun.sha256!,
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
  return {
    ...common,
    OMARCHY_VERSION: pins.omarchy.version,
    OMARCHY_SHA256: pins.omarchy.sha256!,
  };
}

/** Generated inputs reused from the /usr factory: its pacman.conf, keys and composition package set. */
async function generated(name: string) {
  const composition = spec(name).usrComposition;
  if (!composition) return {};
  const usr = await planUsr(composition);
  const omarchy = manifest.pins.omarchy as Pin & {
    pacmanRepository: { name: string; server: string };
  };
  const bootOnly = new Set(["linux-cachyos", "linux-firmware", usr.manifest.kernelFallback]);
  const keys = [
    ...usr.manifest.repositories.flatMap(repo =>
      (repo.keys ?? []).map(key => `${key}@${(repo.keyserver ?? "keyserver.ubuntu.com").replace(/^hkps:\/\//, "")}`),
    ),
    `${omarchy.key}@${omarchy.keyserver}`,
  ];
  // Newest local /usr job of this composition provides the [bunos] package files.
  const artifacts = join(usr.manifest.localArtifacts.replace(/^~/, homedir()), composition);
  const jobs = (await Array.fromAsync(new Bun.Glob("*/repo/*.pkg.tar.zst").scan(artifacts))).sort();
  const latest = jobs.at(-1)?.split(/[/\\]/)[0];
  return {
    repo: latest ? join(artifacts, latest, "repo") : undefined,
    missingRepo: latest
      ? undefined
      : `No [bunos] packages under ${artifacts}; run bun factory usr build --composition ${composition}`,
    files: {
      "pacman.conf": `${usr.pacmanConf.replace("file:///job/repo", "file:///var/lib/bun-os/repo")}[${omarchy.pacmanRepository.name}]\nServer = ${omarchy.pacmanRepository.server}\n`,
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

const workspace = join(here, "../..");
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Stage agentTooling: local skills and MCP sources, pinned clones, Claude Code and Codex configs for /etc/skel. */
async function stageAgentTooling(dir: string, tooling: AgentTooling) {
  await mkdir(join(dir, "skills"), { recursive: true });
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "a=/usr/share/bun-os/agent",
    "s=/usr/share/bun-os/skills",
    'install -d "$s"',
  ];
  for (const skill of tooling.skills) {
    if (skill.source) {
      await cp(join(workspace, skill.source), join(dir, "skills", skill.name), {
        recursive: true,
      });
      script.push(`cp -a "$a/skills/${skill.name}" "$s/${skill.name}"`);
    } else if (skill.repo && skill.commit) {
      const tmp = `/tmp/skill-${skill.name}`;
      script.push(
        `git init -q ${tmp} && git -C ${tmp} fetch -q --depth 1 ${quote(skill.repo)} ${skill.commit} && git -C ${tmp} checkout -q FETCH_HEAD`,
        `install -d "$s/${skill.name}" && cp -a ${tmp}/${skill.path ?? "."}/. "$s/${skill.name}/"`,
        `rm -rf "$s/${skill.name}/.git" ${tmp}`,
      );
    }
  }
  for (const server of tooling.mcpServers)
    if (server.source) {
      await cp(join(workspace, server.source), join(dir, server.name), {
        recursive: true,
        filter: src => !/node_modules/.test(src),
      });
      script.push(`cp -a "$a/${server.name}" /usr/share/bun-os/${server.source.split("/").pop()}`);
    }
  const mcpServers = Object.fromEntries(
    tooling.mcpServers.map(({ name, command: [command, ...args], env }) => [
      name,
      { command, args, ...(env ? { env } : {}) },
    ]),
  );
  await Bun.write(join(dir, "claude.json"), JSON.stringify({ mcpServers }, null, 2) + "\n");
  const toml = (value: string) => JSON.stringify(value);
  const codex = tooling.mcpServers.flatMap(({ name, command: [command, ...args], env }) => [
    `[mcp_servers.${toml(name)}]`,
    `command = ${toml(command!)}`,
    `args = [${args.map(toml).join(", ")}]`,
    ...(env
      ? [
          `env = { ${Object.entries(env)
            .map(([k, v]) => `${k} = ${toml(v)}`)
            .join(", ")} }`,
        ]
      : []),
    "",
  ]);
  await Bun.write(join(dir, "codex.toml"), codex.join("\n"));
  await Bun.write(join(dir, "agent.packages"), tooling.packages.join("\n") + "\nuv\n");
  script.push(
    'bunos-install-packages "$a/agent.packages"',
    "install -d /etc/skel/.claude /etc/skel/.codex",
    'cp -a "$s" /etc/skel/.claude/skills && cp -a "$s" /etc/skel/.codex/skills',
    'install -m644 "$a/claude.json" /etc/skel/.claude.json && install -m644 "$a/claude.json" /etc/skel/.claude/mcp.json',
    'install -m644 "$a/codex.toml" /etc/skel/.codex/config.toml',
  );
  await Bun.write(join(dir, "install.sh"), script.join("\n") + "\n");
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
        const response = await fetch(url, {
          signal: AbortSignal.timeout(900_000),
        });
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
  const proc = Bun.spawn(argv, {
    cwd,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    timeout: timeoutMs,
  });
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
        ? ` && { ${base} --output type=tar,dest=out/${name}-${target}-rootfs.tar && zstd -T0 -19 --long --rm -f out/${name}-${target}-rootfs.tar && echo "${name}-${target}-rootfs.tar.zst ok" >>status || echo "${name}-${target}-rootfs failed" >>status; }`
        : "";
    lines.push(
      `${base} --output type=image,name=docker.io/library/${tag},compression=zstd,compression-level=19,force-compression=true,oci-mediatypes=true && echo "${tag} ok" >>status${rootfs} || echo "${tag} failed" >>status`,
    );
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
    if (image.agentTooling) await stageAgentTooling(join(stage, "context", "agent"), image.agentTooling);
    if (extra.missingRepo) throw new Error(extra.missingRepo);
    if (extra.repo)
      await cp(extra.repo, join(stage, "context", "bunos-repo"), {
        recursive: true,
      });
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
    return {
      name,
      job,
      host,
      remote,
      targets,
      status: `bun factory image status ${name} --job ${job}`,
    };
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
    options: {
      target: { type: "string" },
      host: { type: "string" },
      job: { type: "string" },
    },
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
