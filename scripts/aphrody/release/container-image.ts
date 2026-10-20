#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Release the complete Aphrody container (the `runtime` target of tools/config/container/Dockerfile).
 *
 *   bun scripts/release/container-image.ts build [--release ID] [--on HOST]  # build + tag aphrody:<release>, aphrody:runtime (--on: remote Docker host, minimal context over SSH)
 *   bun scripts/release/container-image.ts ship --host vps|dbfr|NAME   # docker save | gzip | ssh NAME docker load
 *   bun scripts/release/container-image.ts push --ref REGISTRY/NAME    # tag + docker push (<release> and latest)
 *   bun scripts/release/container-image.ts release --host dbfr [--ref ..]  # build, ship each --host, push if --ref
 *
 * The image holds only the checksum-verified published Aphrody and Yolo artifacts (no source, no secret).
 * Hosts are SSH aliases of the owner configuration (`aphrody infra ssh` host catalog); dbfr runs the `prod`
 * compose profile on the shipped image, the owner and Omar PCs run `pc`, the VPS keeps the `build` profile.
 */
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../");
export const DOCKERFILE = "tools/config/container/Dockerfile";

export type Options = {
  release: string;
  hosts: string[];
  ref?: string;
  on?: string;
};

/** Files the `runtime` target copies from the build context: enough to build on a host without a checkout. */
export const RUNTIME_CONTEXT = [
  DOCKERFILE,
  "tools/config/container/entrypoint.sh",
  "packages/bun-workspace/assets/downloads/install-full.sh",
];

export function parseArgs(argv: string[]): {
  command: string;
  options: Options;
} {
  const [command = "release", ...rest] = argv;
  const options: Options = { release: "", hosts: [] };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    const known =
      (flag === "--on" || flag === "--release" || flag === "--host" || flag === "--ref") && value !== undefined;
    if (!known) throw new Error(`unknown or incomplete option: `);
    if (flag === "--on") options.on = value;
    else if (flag === "--release") options.release = value;
    else if (flag === "--host") options.hosts.push(value);
    else options.ref = value;
    i++;
  }
  return { command, options };
}

/** Immutable tag: the explicit release id, else the short commit of this checkout. */
export function releaseTag(explicit: string, commit: string): string {
  const tag = explicit || commit.trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new Error(`invalid image tag: ${tag}`);
  return tag;
}

export function buildArgs(tag: string, release: string, context = "."): string[] {
  return [
    "build",
    "-f",
    DOCKERFILE,
    "--target",
    "runtime",
    ...(release ? ["--build-arg", `APHRODY_RELEASE=${release}`] : []),
    "-t",
    `aphrody:${tag}`,
    "-t",
    "aphrody:runtime",
    context,
  ];
}

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${r.exitCode})`);
}

function imageTag(options: Options): string {
  const commit = Bun.spawnSync(["git", "rev-parse", "--short=9", "HEAD"], {
    cwd: ROOT,
  }).stdout.toString();
  return releaseTag(options.release, commit);
}

function ship(host: string, t: string, from?: string): void {
  for (const h of [host, from ?? host]) if (!/^[A-Za-z0-9_.-]+$/.test(h)) throw new Error(`invalid host: ${h}`);
  const load = `ssh ${host} 'gunzip | docker load && docker tag aphrody:${t} aphrody:runtime'`;
  const pipeline = `docker save aphrody:${t} | gzip -1 | ${load}`;
  run(["sh", "-c", from ? `ssh ${from} "${pipeline}"` : pipeline]);
}

/** Build on a remote Docker host from a minimal context streamed over SSH; the image stays there. */
function buildOn(host: string, t: string, release: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(host)) throw new Error(`invalid host: ${host}`);
  const args = buildArgs(t, release, "-")
    .map(a => `'${a}'`)
    .join(" ");
  run(["sh", "-c", `tar -cf - ${RUNTIME_CONTEXT.join(" ")} | ssh ${host} 'docker ${args}'`]);
}

function push(ref: string, t: string): void {
  for (const name of [t, "latest"]) {
    run(["docker", "tag", `aphrody:${t}`, `${ref}:${name}`]);
    run(["docker", "push", `${ref}:${name}`]);
  }
}

if (import.meta.main) {
  const { command, options } = parseArgs(Bun.argv.slice(2));
  const t = imageTag(options);
  if (command === "build" || command === "release") {
    if (options.on) buildOn(options.on, t, options.release);
    else run(["docker", ...buildArgs(t, options.release)]);
  }
  if (command === "ship" || command === "release") for (const host of options.hosts) ship(host, t, options.on);
  if ((command === "push" || command === "release") && options.ref) push(options.ref, t);
  if (!["build", "ship", "push", "release"].includes(command)) throw new Error(`unknown command: ${command}`);
  console.log(`aphrody:${t}`);
}
