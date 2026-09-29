#!/usr/bin/env bun
/** Emballe un `.next-build` produit hors VPS pour import bleu/vert vérifié. */
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");
const build = join(repo, "apps", "site", ".next-build");
const outputArg = process.argv[2] ?? "artifacts/site-build.tar.gz";
if (outputArg.startsWith("/") || outputArg.split("/").includes("..")) {
	throw new Error("chemin de sortie absolu ou traversant refusé");
}
const output = join(repo, outputArg);
const stage = join(repo, ".site-artifact-stage");
const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: repo, stdout: "pipe", stderr: "pipe" });

for (const name of ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json", "server/app-paths-manifest.json"]) {
	if (!existsSync(join(build, name))) throw new Error(`build incomplet : ${name} absent`);
}
const shaResult = run(["git", "rev-parse", "--short", "HEAD"]);
if (shaResult.exitCode !== 0) throw new Error(shaResult.stderr.toString());
const commit = shaResult.stdout.toString().trim();
const buildId = (await Bun.file(join(build, "BUILD_ID")).text()).trim();

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "build"), { recursive: true });
try {
	const copy = run(["rsync", "-a", "-L", "--exclude", "cache/", `${build}/`, `${join(stage, "build")}/`]);
	if (copy.exitCode !== 0) throw new Error(copy.stderr.toString());
	await Bun.write(
		join(stage, "artifact-manifest.json"),
		`${JSON.stringify({ schema: "shenron-site-artifact/v1", commit, buildId }, null, 2)}\n`
	);
	await mkdir(join(output, ".."), { recursive: true });
	const archive = run(["tar", "-czf", output, "-C", stage, "artifact-manifest.json", "build"]);
	if (archive.exitCode !== 0) throw new Error(archive.stderr.toString());
	const digest = run(["sha256sum", output]);
	if (digest.exitCode !== 0) throw new Error(digest.stderr.toString());
	const hash = digest.stdout.toString().trim().split(/\s+/)[0];
	await Bun.write(`${output}.sha256`, `${hash}  ${outputArg}\n`);
	console.log(JSON.stringify({ status: "FAIT", artifact: outputArg, commit, buildId, sha256: hash }));
} finally {
	await rm(stage, { recursive: true, force: true });
}
