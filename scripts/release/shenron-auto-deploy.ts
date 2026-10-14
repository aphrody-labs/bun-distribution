#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const infra = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(
  readFileSync(
    process.env.SHENRON_AUTO_DEPLOY_CONFIG ?? join(infra, "tools/config/shenron-auto-deploy.json"),
    "utf8",
  ),
);
const env: Record<string, string | undefined> = {
  ...process.env,
  PATH: "/home/ubuntu/.bun/bin:/home/ubuntu/.cargo/bin:/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin",
  SHENRON_BUN_EXECUTABLE: config.bun,
  SHENRON_CARGO_REMOTE: "off",
  APHRODY_BUILD_HOST: "vps",
  APHRODY_CARGO_SERIAL: join(infra, "scripts/build/rust/cargo-serial.sh"),
  APHRODY_CARGO_TARGET_DIR: "/home/ubuntu/build/cache/cargo/shenron",
  CARGO_TARGET_DIR: "/home/ubuntu/build/cache/cargo/shenron",
  APHRODY_CARGO_JOBS: "2",
  CARGO_BUILD_JOBS: "2",
  CARGO_INCREMENTAL: "0",
  APHRODY_FACTORY_RESOURCE: "/home/ubuntu/build/transient",
  APHRODY_FACTORY_LOCK_PATH: config.lock,
};

export function syncDecision(branch: string, status: string, fastForward: boolean): string {
  if (branch !== "main") return "branch-not-main";
  if (status.trim()) return "local-changes";
  if (!fastForward) return "divergent-history";
  return "fast-forward";
}

/** Current Shenron tracks its fork archives; no historical vendor bootstrap is needed. */
export async function verifyVendor(work: string): Promise<void> {
  const directory = join(work, "vendor/next-fork");
  const manifest = await Bun.file(join(directory, "manifest.json")).json();
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.packages) ||
    !manifest.packages.length
  )
    throw new Error("Invalid Next fork archive manifest");
  for (const entry of manifest.packages) {
    if (
      typeof entry.archive !== "string" ||
      !/^[\w.-]+\.tgz$/.test(entry.archive) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error("Invalid Next fork archive identity");
    if (!matches(join(directory, entry.archive), entry.sha256))
      throw new Error(`Next fork archive digest differs: ${entry.archive}`);
  }
}

function command(args: string[], cwd = config.source, inherited = false): string {
  console.log(new Date().toISOString(), args[0], args[1] ?? "");
  const p = Bun.spawnSync(args, {
    cwd,
    env,
    stdout: inherited ? "inherit" : "pipe",
    stderr: "inherit",
  });
  if (p.exitCode !== 0)
    throw new Error(`Command failed (${p.exitCode}): ${args[0]} ${args[1] ?? ""}`);
  return inherited ? "" : (p.stdout?.toString().trim() ?? "");
}
function git(args: string[], cwd = config.source): string {
  return command(["git", ...args], cwd);
}
function matches(p: string, hash: string): boolean {
  return existsSync(p) && createHash("sha256").update(readFileSync(p)).digest("hex") === hash;
}
async function state(status: string, fields: Record<string, unknown> = {}) {
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const p = join(config.state, process.argv[2]?.startsWith("sync") ? "sync.json" : "deploy.json");
  await Bun.write(
    p,
    JSON.stringify({ status, at: new Date().toISOString(), ...fields }, null, 2) + "\n",
  );
  chmodSync(p, 0o600);
}
async function syncSource(): Promise<string | undefined> {
  git(["fetch", "--quiet", "origin", "main"]);
  const branch = git(["branch", "--show-current"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  const ancestor = Bun.spawnSync(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"], {
    cwd: config.source,
    env,
  });
  const decision = syncDecision(branch, dirty, ancestor.exitCode === 0);
  if (decision !== "fast-forward") {
    await state("skipped", { reason: decision });
    return;
  }
  git(["merge", "--quiet", "--ff-only", "origin/main"]);
  const sha = git(["rev-parse", "HEAD"]);
  await state("synchronized", { commit: sha });
  return sha;
}
async function sync(): Promise<string | undefined> {
  mkdirSync(config.state, { recursive: true, mode: 0o700 });
  const p = Bun.spawnSync(
    [
      "flock",
      "--exclusive",
      "--close",
      "--timeout",
      "60",
      join(config.state, "source.lock"),
      config.bun,
      fileURLToPath(import.meta.url),
      "sync-source",
    ],
    { env, stdout: "inherit", stderr: "inherit" },
  );
  if (p.exitCode === 75) return;
  if (p.exitCode !== 0) throw new Error("Checkout synchronization failed");
  return JSON.parse(readFileSync(join(config.state, "sync.json"), "utf8")).commit;
}
function remote(args: string): string {
  return command([
    "aphrody",
    "infra",
    "--root",
    infra,
    "ssh",
    "exec",
    "--host",
    config.targetHost,
    "-c",
    args,
  ]);
}
function active(): string {
  const p = remote(`readlink -f ${config.remoteRoot}/current`);
  const sha = p
    .split("/")
    .pop()
    ?.replace(/^docker-/, "");
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid active remote release");
  return sha;
}
function native(sha: string, work: string) {
  const n = config.nativeCache;
  const noChanges = (base: string, paths: string[]) =>
    Bun.spawnSync(["git", "diff", "--quiet", base, sha, "--", ...paths], {
      cwd: config.source,
      env,
    }).exitCode === 0;
  const ffi = join(config.source, "target/release/libshenron_ffi.so");
  const re = join(config.source, "target/release/libshenron_re.so");
  const reuse =
    noChanges(n.mcpRevision, ["crates", "Cargo.toml", "Cargo.lock"]) &&
    noChanges(n.librariesRevision, [
      "crates",
      ":!crates/shenron-mcp",
      "Cargo.toml",
      "Cargo.lock",
    ]) &&
    matches(ffi, n.ffiSha256) &&
    matches(re, n.reSha256);
  const out = join(work, "target/release");
  mkdirSync(out, { recursive: true });
  if (reuse) {
    const cache = join(config.state, "native");
    mkdirSync(cache, { recursive: true });
    const mcp = join(cache, "shenron-mcp-linux-x64");
    if (!matches(mcp, n.mcpSha256))
      command(
        [
          "gh",
          "release",
          "download",
          n.releaseTag,
          "-R",
          "aphrody-labs/shenron",
          "--pattern",
          "shenron-mcp-linux-x64",
          "--dir",
          cache,
          "--clobber",
        ],
        work,
        true,
      );
    if (!matches(mcp, n.mcpSha256)) throw new Error("Qualified MCP digest differs");
    for (const [from, name] of [
      [mcp, "shenron-mcp"],
      [ffi, "libshenron_ffi.so"],
      [re, "libshenron_re.so"],
    ]) {
      copyFileSync(from, join(out, name));
      chmodSync(join(out, name), 0o755);
    }
    console.log("Native artifacts reused after source-input and SHA-256 comparison");
  } else {
    for (const crate of ["shenron-mcp", "shenron-ffi", "shenron-re"]) {
      for (const args of [
        ["clippy", "-p", crate, "--all-targets", "--locked", "--", "-D", "warnings"],
        ["test", "-p", crate, "--locked"],
        ["build", "--release", "--locked", "-p", crate],
      ])
        command([config.bun, "scripts/build/rust/cargo.ts", ...args], work, true);
    }
    for (const name of ["shenron-mcp", "libshenron_ffi.so", "libshenron_re.so"])
      copyFileSync(join(env.CARGO_TARGET_DIR!, "release", name), join(out, name));
  }
  mkdirSync(join(work, "dist/mcp/linux-x64"), { recursive: true });
  copyFileSync(join(out, "shenron-mcp"), join(work, "dist/mcp/linux-x64/shenron-mcp"));
  chmodSync(join(work, "dist/mcp/linux-x64/shenron-mcp"), 0o755);
}
async function buildDeploy() {
  const sha = git(["rev-parse", "HEAD"]);
  if (
    git(["branch", "--show-current"]) !== "main" ||
    git(["status", "--porcelain", "--untracked-files=normal"])
  )
    throw new Error("Source checkout changed before build");
  const previous = active();
  if (previous === sha) {
    await state("current", { commit: sha });
    return;
  }
  await state("building", { commit: sha, previous });
  const work = config.worktree,
    job = join(config.artifacts, sha);
  mkdirSync(dirname(work), { recursive: true });
  mkdirSync(job, { recursive: true, mode: 0o700 });
  if (!existsSync(join(work, ".git"))) git(["worktree", "add", "--detach", work, sha]);
  else {
    if (git(["status", "--porcelain", "--untracked-files=normal"], work))
      throw new Error("Build worktree contains changes; preserved");
    git(["checkout", "--detach", sha], work);
  }
  await verifyVendor(work);
  git(["submodule", "update", "--init", "--", "packages/config"], work);
  command([config.bun, "install", "--frozen-lockfile"], work, true);
  native(sha, work);
  env.SHENRON_RE_LIB = join(work, "target/release/libshenron_re.so");
  mkdirSync(join(work, "dist/vfs"), { recursive: true });
  copyFileSync(
    join(config.source, "dist/vfs/shenron-vfs.public.sqlite"),
    join(work, "dist/vfs/shenron-vfs.public.sqlite"),
  );
  command(
    [
      config.bun,
      "-e",
      'import {requireProductionVfs} from "./scripts/build/server-vfs-policy.ts";requireProductionVfs("dist/vfs/shenron-vfs.public.sqlite",false)',
    ],
    work,
    true,
  );
  command([config.bun, "packages/koharu/scripts/build-wasm.ts", "--check"], work, true);
  for (const gate of ["typecheck", "lint", "format:check", "test"])
    command([config.bun, "run", gate], work, true);
  for (const args of [
    ["packages/api/scripts/openapi.ts", "--check"],
    ["packages/ui/scripts/generate-tokens.ts", "--check"],
    ["packages/pipeline/scripts/ai/check-contracts.ts"],
  ])
    command([config.bun, ...args], work, true);
  command([config.bun, "scripts/build/bot.ts", "--target", "linux-x64"], work, true);
  command(
    [config.bun, "scripts/build/server.ts", "--flavor", "production", "--target", "linux-x64"],
    work,
    true,
  );
  mkdirSync(join(work, "dist/server/linux-x64/native"), { recursive: true });
  copyFileSync(
    join(work, "target/release/libshenron_ffi.so"),
    join(work, "dist/server/linux-x64/native/libshenron_ffi.so"),
  );
  command(
    [
      "docker",
      "build",
      "--network=host",
      "-f",
      "deploy/docker/Dockerfile",
      "--build-arg",
      `SHENRON_REVISION=${sha}`,
      "-t",
      `localhost/shenron:${sha}`,
      ".",
    ],
    work,
    true,
  );
  command(
    ["docker", "run", "--rm", "--network", "none", `localhost/shenron:${sha}`, "version"],
    work,
    true,
  );
  command(
    [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "/usr/local/bin/shenron-bot",
      `localhost/shenron:${sha}`,
      "--smoke",
    ],
    work,
    true,
  );
  const image = command(
    ["docker", "image", "inspect", "-f", "{{.Id}}", `localhost/shenron:${sha}`],
    work,
  );
  await state("built", { commit: sha, previous, image });
  // Promotion uses the same sealed Infra adapter as manual Shenron releases.
  command(
    [
      config.bun,
      join(infra, "scripts/release/shenron-auto-promote.ts"),
      sha,
      image,
      work,
      job,
      previous,
    ],
    work,
    true,
  );
  if (active() !== sha) throw new Error("Remote active commit differs after promotion");
  const health = await fetch(`${config.site}/api/health`, { signal: AbortSignal.timeout(20000) });
  if (!health.ok || (await health.json()).status !== "ok")
    throw new Error("Public health probe failed");
  await state("deployed", { commit: sha, previous, image, health: "ok" });
}

if (import.meta.main) {
  try {
    const mode = process.argv[2];
    if (Bun.version !== "1.4.4") throw new Error("Bun 1.4.4 is required");
    if (mode === "sync") {
      if (!(await sync())) process.exitCode = 75;
    } else if (mode === "sync-source") {
      if (!(await syncSource())) process.exitCode = 75;
    } else if (mode === "deploy") {
      const sha = await sync();
      if (!sha) process.exitCode = 75;
      else if (active() === sha) await state("current", { commit: sha });
      else {
        mkdirSync(dirname(config.lock), { recursive: true });
        const child = Bun.spawn(
          [
            "flock",
            "--exclusive",
            "--close",
            "--nonblock",
            "--conflict-exit-code",
            "75",
            config.lock,
            config.bun,
            fileURLToPath(import.meta.url),
            "build-deploy",
          ],
          { env, stdout: "inherit", stderr: "inherit" },
        );
        process.exitCode = await child.exited;
        if (process.exitCode === 75)
          await state("waiting", { reason: "factory-lock", commit: sha });
      }
    } else if (mode === "build-deploy") {
      command(
        [
          config.bun,
          join(infra, "packages/infra/workspace/src/build-factory-cleanup.ts"),
          "--held",
        ],
        infra,
      );
      await buildDeploy();
    } else throw new Error("Usage: shenron-auto-deploy.ts sync|deploy");
  } catch (error) {
    await state("failed", { error: String(error) });
    console.error(String(error));
    process.exitCode = 1;
  }
}
