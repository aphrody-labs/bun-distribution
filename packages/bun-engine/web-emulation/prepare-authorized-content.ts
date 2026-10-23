#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Content rights are separate from this preparation script's source-code license.
import { lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import catalog from "./authorized-content.json";
import { qualificationSHA256 } from "./qualification";

export async function prepareAuthorizedContent(archiveOverride?: string) {
  if (process.platform !== "linux") throw new Error("Authorized content preparation runs on the Linux VPS only.");
  const root = await realpath(resolve(import.meta.dir, "../../.."));
  const content = catalog.content.find(entry => entry.id === "inazuma-eleven-2-tempete-de-glace-fr");
  if (!content?.archive || !content.member || !content.output) throw new Error("Pinned input metadata is missing.");
  const archive = resolve(root, archiveOverride ?? content.archive.path);
  if (!(await Bun.file(archive).exists())) throw new Error(`Archive not found: ${archive}`);
  if ((await qualificationSHA256(archive)) !== content.archive.sha256)
    throw new Error("Input archive SHA-256 does not match the owner-supplied artifact.");
  const unzip = Bun.which("unzip");
  if (!unzip) throw new Error("The VPS requires its existing unzip package.");

  // The root build owner may deliberately be a symlink. Resolve it once; reject
  // symlinks in the dedicated staging subtree and refuse to replace content.
  await mkdir(join(root, "build", "web-emulation"), { recursive: true });
  const build = await realpath(join(root, "build", "web-emulation"));
  let outputDirectory = build;
  for (const part of ["authorized-content"]) {
    outputDirectory = join(outputDirectory, part);
    await mkdir(outputDirectory, { recursive: true });
    const stat = await lstat(outputDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe staging directory: ${outputDirectory}`);
    if ((await realpath(outputDirectory)) !== outputDirectory)
      throw new Error("Staging directory changed during preparation.");
  }
  if (content.output !== content.output.split("/").pop() || /[\\:]/.test(content.output))
    throw new Error("Unsafe catalog output filename.");
  const output = join(outputDirectory, content.output);
  let existing = false;
  try {
    const stat = await lstat(output);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The staged output must be a regular file.");
    if (stat.size !== content.member.bytes || (await qualificationSHA256(output)) !== content.member.sha256)
      throw new Error("Existing staged content differs from the pinned artifact; refusing to overwrite it.");
    existing = true;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }

  const temporary = join(outputDirectory, `.prepare-${crypto.randomUUID()}.nds`);
  if (!existing) {
    const child = Bun.spawn([unzip, "-p", archive, content.member.path], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 120_000);
    try {
      const [, code, stderr] = await Promise.all([
        Bun.write(temporary, child.stdout),
        child.exited,
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`Archive member extraction failed (${code}): ${stderr.slice(0, 500)}`);
      if (
        Bun.file(temporary).size !== content.member.bytes ||
        (await qualificationSHA256(temporary)) !== content.member.sha256
      )
        throw new Error("Extracted ROM size or SHA-256 does not match the pinned member.");
      if ((await qualificationSHA256(archive)) !== content.archive.sha256)
        throw new Error("Input archive changed during extraction.");
      await rename(temporary, output);
    } finally {
      clearTimeout(timeout);
      child.kill();
      await unlink(temporary).catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  const declaration = catalog.declarations.find(entry => entry.id === content.rights.declaration);
  const receipt = {
    schemaVersion: 1,
    kind: "bun-engine-owner-authorized-content-preparation",
    preparedAt: new Date().toISOString(),
    content: { id: content.id, title: content.title, system: content.system, rights: content.rights, declaration },
    archive: { sha256: content.archive.sha256 },
    artifact: { path: content.output, sha256: content.member.sha256, bytes: content.member.bytes },
    qualification: "prepared-input-only-not-emulator-qualification",
    publication: "not-published-by-this-command",
  };
  const receiptPath = join(dirname(output), `${content.id}.receipt.json`);
  // Never write through an existing receipt symlink.
  try {
    if ((await lstat(receiptPath)).isSymbolicLink()) throw new Error("Unsafe receipt path.");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  return { output, receipt: receiptPath, sha256: content.member.sha256, existing };
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log("VPS only: bun prepare-authorized-content.ts [--archive=/tmp/bun-os-private-dust-rom.zip]");
  } else {
    if (args.length > 1 || args.some(arg => !arg.startsWith("--archive=") || !arg.slice(10)))
      throw new Error("Expected only --archive=<existing ZIP path>.");
    console.log(JSON.stringify(await prepareAuthorizedContent(args[0]?.slice(10)), null, 2));
  }
}
