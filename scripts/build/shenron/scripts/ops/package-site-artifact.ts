#!/usr/bin/env bun
/** Emballe un `.next-build` produit hors VPS pour import bleu/vert vérifié. */
import { existsSync } from "node:fs";
import { mkdir, rm, readdir, lstat, readlink, unlink, cp } from "node:fs/promises";
import { join, relative as relativePath } from "node:path";

const repo = join(import.meta.dir, "..", "..", "..", "..", "..");
const build = join(repo, "apps", "shenron", "site", ".next-build");
const outputArg = process.argv[2] ?? "artifacts/site-build.tar.gz";
if (outputArg.startsWith("/") || outputArg.split("/").includes("..")) {
  throw new Error("chemin de sortie absolu ou traversant refusé");
}
const output = join(repo, outputArg);
const stage = join(repo, ".site-artifact-stage");
const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: repo, stdout: "pipe", stderr: "pipe" });

for (const name of [
  "BUILD_ID",
  "prerender-manifest.json",
  "routes-manifest.json",
  "server/app-paths-manifest.json",
]) {
  if (!existsSync(join(build, name))) throw new Error(`build incomplet : ${name} absent`);
}
const shaResult = run(["git", "rev-parse", "HEAD"]);
if (shaResult.exitCode !== 0) throw new Error(shaResult.stderr.toString());
const commit = shaResult.stdout.toString().trim();
const buildId = (await Bun.file(join(build, "BUILD_ID")).text()).trim();

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "build"), { recursive: true });
try {
  const copy = run([
    "rsync",
    "-a",
    "-L",
    "--exclude",
    "cache/",
    `${build}/`,
    `${join(stage, "build")}/`,
  ]);
  if (copy.exitCode !== 0) throw new Error(copy.stderr.toString());
  await Bun.write(
    join(stage, "artifact-manifest.json"),
    `${JSON.stringify({ schema: "shenron-site-artifact/v1", commit, buildId }, null, 2)}\n`,
  );
  await mkdir(join(output, ".."), { recursive: true });
  const archive = run(["tar", "-czf", output, "-C", stage, "artifact-manifest.json", "build"]);
  if (archive.exitCode !== 0) throw new Error(archive.stderr.toString());
  const digest = run(["sha256sum", output]);
  if (digest.exitCode !== 0) throw new Error(digest.stderr.toString());
  const hash = digest.stdout.toString().trim().split(/\s+/)[0];
  await Bun.write(`${output}.sha256`, `${hash}  ${outputArg}\n`);
  console.log(
    JSON.stringify({ status: "FAIT", artifact: outputArg, commit, buildId, sha256: hash }),
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}

// Optional immutable Infra payload from the same committed monorepo source.
// Owner build/compile happens before this step; packaging does not run runtime
// processes, migrations, or databases.
if (process.argv[3] === "--release-dir") {
  const releaseArg = process.argv[4];
  if (!releaseArg || releaseArg.startsWith("/") || releaseArg.split("/").includes("..")) {
    throw new Error("release directory must be relative to the owner checkout");
  }
  const releaseDir = join(repo, releaseArg);
  if (existsSync(releaseDir)) throw new Error("release directory already exists");
  const dirty = run(["git", "status", "--porcelain", "--untracked-files=no"]);
  if (dirty.exitCode || dirty.stdout.toString().trim())
    throw new Error("release source must be committed and clean");
  const botBinary = join(repo, "apps/shenron/bot/dist/shenron");
  if (!existsSync(botBinary)) throw new Error("compile the Shenron bot owner before packaging");
  const payloadStage = `${releaseDir}.staging`;
  if (existsSync(payloadStage)) throw new Error("release staging directory already exists");
  await mkdir(join(payloadStage, "systemd"), { recursive: true });
  await mkdir(join(payloadStage, "nginx"), { recursive: true });
  const sourceStage = join(payloadStage, ".source");
  await mkdir(sourceStage);
  try {
    const sourceArchive = join(payloadStage, ".source.tar");
    for (const cmd of [
      ["git", "archive", "--format=tar", "--output", sourceArchive, commit],
      ["tar", "-xf", sourceArchive, "-C", sourceStage],
    ]) {
      const result = run(cmd);
      if (result.exitCode) throw new Error(result.stderr.toString());
    }
    // Host-only Python dispatchers belong to the sibling Python workspace;
    // this is the same precise exclusion used by the RG release owner.
    await Promise.all(
      (await readdir(sourceStage, { recursive: true })).map(async (relative) => {
        const path = join(sourceStage, relative);
        if (
          (await lstat(path)).isSymbolicLink() &&
          (await readlink(path)).endsWith(
            "/aphrody-py/tools/infra/scripts/python-workspace-dispatch.py",
          )
        ) {
          await unlink(path);
        }
      }),
    );
    const { dependencyBuildPlan } = await import(
      join(repo, "packages/infra/workspace/src/bun-dependency-builds.ts")
    );
    const firstPartyArtifacts = await Promise.all(
      (await dependencyBuildPlan(repo, ["@shenron/site", "@shenron/bot"])).map(async (owner) => {
        const manifest = await Bun.file(join(owner.path, "package.json")).json();
        const roots = new Set<string>();
        const collect = (value: unknown) => {
          if (typeof value === "string") {
            const match = /^(?:\.\/)?(dist|build)\//.exec(value);
            if (match) roots.add(match[1]!);
          } else if (value !== null && typeof value === "object") {
            for (const nested of Object.values(value)) collect(nested);
          }
        };
        collect([manifest.exports, manifest.main, manifest.module, manifest.types, manifest.bin]);
        const ownerRelative = relativePath(repo, owner.path);
        if (ownerRelative.startsWith(".."))
          throw new Error("compiled artifact owner outside monorepo");
        await Promise.all(
          [...roots].map(async (root) => {
            const source = join(owner.path, root);
            const destination = join(sourceStage, ownerRelative, root);
            if (!existsSync(source) || !(await lstat(source)).isDirectory())
              throw new Error(`missing owner-built artifact: ${owner.name}/${root}`);
            if (existsSync(destination))
              throw new Error(
                `compiled artifact collides with tracked source: ${owner.name}/${root}`,
              );
            await cp(source, destination, {
              recursive: true,
              dereference: false,
              errorOnExist: true,
              force: false,
            });
          }),
        );
        return { name: owner.name, path: ownerRelative, roots: [...roots].toSorted() };
      }),
    );
    const pinnedPackageDir = join(repo, ".cache/iecode-packages");
    if (existsSync(join(pinnedPackageDir, "manifest.json"))) {
      const provenance = await Bun.file(join(pinnedPackageDir, "manifest.json")).json();
      if (provenance.dirty !== false || !/^[a-f0-9]{40}$/.test(provenance.sourceRevision)) {
        throw new Error("IECODE package provenance must be a clean full revision");
      }
      const consumerManifest = await Bun.file(join(repo, "package.json")).text();
      const targetPackages = join(sourceStage, ".cache/iecode-packages");
      await mkdir(targetPackages, { recursive: true });
      await Promise.all(
        provenance.packages.map(async (entry: { archive: string; sha256: string }) => {
          if (
            !/^[a-z0-9-]+\.tgz$/.test(entry.archive) ||
            !consumerManifest.includes(entry.archive)
          ) {
            throw new Error("IECODE archive differs from pinned consumer manifest");
          }
          const archive = Bun.file(join(pinnedPackageDir, entry.archive));
          const hash = new Bun.CryptoHasher("sha256")
            .update(await archive.arrayBuffer())
            .digest("hex");
          if (hash !== entry.sha256) throw new Error("IECODE archive provenance hash mismatch");
          await Bun.write(join(targetPackages, entry.archive), archive);
        }),
      );
      await Bun.write(
        join(targetPackages, "manifest.json"),
        Bun.file(join(pinnedPackageDir, "manifest.json")),
      );
    }
    await mkdir(join(sourceStage, "apps/shenron/bot/dist"), { recursive: true });
    await Bun.write(join(sourceStage, "apps/shenron/bot/dist/shenron"), Bun.file(botBinary));
    const mode = run(["chmod", "0755", join(sourceStage, "apps/shenron/bot/dist/shenron")]);
    if (mode.exitCode) throw new Error(mode.stderr.toString());
    const tar = run(["tar", "-czf", join(payloadStage, "source.tar.gz"), "-C", sourceStage, "."]);
    if (tar.exitCode) throw new Error(tar.stderr.toString());
    await rm(sourceStage, { recursive: true });
    await rm(sourceArchive);
    await Bun.write(join(payloadStage, "site-build.tar.gz"), Bun.file(output));
    await Promise.all(
      ["shenron-site", "shenron-bot"].map((unit) =>
        Bun.write(
          join(payloadStage, "systemd", `${unit}.service`),
          Bun.file(join(repo, "systemd", `${unit}.service`)),
        ),
      ),
    );
    const fragments = [
      "00-shenron-cache",
      "dragonballfr.com",
      "bot.dragonballfr.com",
      "cdn.dragonballfr.com",
    ];
    const nginx =
      "# Infra-owned Shenron immutable release\n" +
      (
        await Promise.all(
          fragments.map((fragment) =>
            Bun.file(join(repo, "nginx", `${fragment}.conf.example`)).text(),
          ),
        )
      ).join("\n");
    await Bun.write(join(payloadStage, "nginx/shenron.conf"), nginx);
    await Bun.write(
      join(payloadStage, "release.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repository: "aphrody-labs/aphrody",
          commit,
          sourceLayout: "monorepo",
          target: "dbfr",
          builtAt: new Date().toISOString(),
          services: ["shenron-site", "shenron-bot"],
          firstPartyArtifacts,
          siteArtifact: { buildId },
        },
        null,
        2,
      )}\n`,
    );
    const files = [
      "source.tar.gz",
      "site-build.tar.gz",
      "release.json",
      "systemd/shenron-site.service",
      "systemd/shenron-bot.service",
      "nginx/shenron.conf",
    ];
    // Native streaming hashes keep archive-sized buffers off the JS heap.
    const checksumResult = Bun.spawnSync(["sha256sum", ...files], {
      cwd: payloadStage,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (checksumResult.exitCode) throw new Error(checksumResult.stderr.toString());
    await Bun.write(join(payloadStage, "SHA256SUMS"), checksumResult.stdout);
    const { rename } = await import("node:fs/promises");
    await rename(payloadStage, releaseDir);
    console.log(JSON.stringify({ release: releaseArg, commit, target: "dbfr" }));
  } catch (error) {
    await rm(payloadStage, { recursive: true, force: true });
    throw error;
  }
}
