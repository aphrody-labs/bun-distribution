#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/** Producer-owned SDK archive from a committed revision; never builds native engines. */
import {
  copyFile,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function command(argv: string[], cwd: string): Promise<Uint8Array> {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv[0]} ${argv[1]} failed: ${err.trim()}`);
  return new Uint8Array(out);
}

export async function packRuntimeSdk(options: {
  root: string;
  destination: string;
  revision?: string | undefined;
}) {
  if (options.revision !== undefined && !/^[a-f0-9]{40}$/.test(options.revision))
    throw new Error("A full pinned revision is required");
  const root = resolve(options.root);
  const revision = new TextDecoder()
    .decode(
      await command(
        ["git", "rev-parse", "--verify", `${options.revision ?? "HEAD"}^{commit}`],
        root,
      ),
    )
    .trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full Git revision is required");
  const packageJson = JSON.parse(
    new TextDecoder().decode(
      await command(["git", "show", `${revision}:packages/runtime/package.json`], root),
    ),
  ) as { files: string[] };
  const hasApacheSources = packageJson.files.includes("LICENSE-APACHE");
  const paths = [
    "LICENSE",
    "packages/runtime/package.json",
    "packages/runtime/README.md",
    "packages/runtime/runtime.d.ts",
    "packages/runtime/src",
    ...(hasApacheSources ? ["packages/runtime/LICENSE-APACHE"] : []),
  ];
  const tree = new TextDecoder().decode(
    await command(["git", "ls-tree", "-r", revision, "--", ...paths], root),
  );
  for (const entry of tree.trim().split("\n")) {
    const [metadata, path] = entry.split("\t");
    if (!metadata?.startsWith("100644 blob ") && !metadata?.startsWith("100755 blob "))
      throw new Error(`SDK source must contain regular files only: ${path}`);
    if (
      path !== "LICENSE" &&
      !/^packages\/runtime\/(?:package\.json|README\.md|runtime\.d\.ts|LICENSE-APACHE|src\/[^/]+\.ts)$/.test(
        path ?? "",
      )
    )
      throw new Error(`SDK source outside the allowlist: ${path}`);
  }
  const destination = resolve(options.destination);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), ".yolo-sdk-pack-"));
  try {
    const tar = join(temporary, "source.tar");
    await writeFile(tar, await command(["git", "archive", revision, "--", ...paths], root));
    await command(["tar", "-xf", tar, "-C", temporary], root);
    const sdk = join(temporary, "packages/runtime");
    // Preserve the producer license in the consumer package.
    await copyFile(join(temporary, "LICENSE"), join(sdk, "LICENSE"));
    const metadata = JSON.parse(await readFile(join(sdk, "package.json"), "utf8")) as {
      name: string;
      version: string;
      dependencies?: Record<string, string>;
      files: string[];
    };
    if (
      metadata.name !== "@aphrody/runtime-sdk" ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
      Object.keys(metadata.dependencies ?? {}).length ||
      JSON.stringify(metadata.files) !==
        JSON.stringify([
          "src",
          "runtime.d.ts",
          "README.md",
          ...(hasApacheSources ? ["LICENSE-APACHE"] : []),
        ])
    )
      throw new Error("Unsupported lightweight SDK package contract");
    const output = join(temporary, "output");
    await mkdir(output);
    await command(
      [process.execPath, "pm", "pack", "--ignore-scripts", "--destination", output],
      sdk,
    );
    const produced = (await readdir(output)).filter((name) => name.endsWith(".tgz"));
    if (produced.length !== 1) throw new Error("Expected one SDK archive");
    const archivePath = join(output, produced[0]!);
    const bytes = await readFile(archivePath);
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const archive = `aphrody-runtime-sdk-${metadata.version}-${sha256.slice(0, 8)}.tgz`;
    const provenance = {
      name: metadata.name,
      version: metadata.version,
      archive,
      sha256,
      bytes: bytes.byteLength,
      yoloRevision: revision,
      dirty: false,
    };
    const directory = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
      throw new Error("SDK destination must be a real directory");
    await mkdir(destination, { recursive: true });
    const target = join(destination, archive);
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || !bytes.equals(await readFile(target)))
        throw new Error("Existing SDK archive conflicts with the pinned content");
    } else {
      try {
        await link(archivePath, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const status = await lstat(target);
        if (!status.isFile() || status.isSymbolicLink() || !bytes.equals(await readFile(target)))
          throw new Error("Existing SDK archive conflicts with the pinned content", { cause: error });
      }
    }
    const metadataPath = join(destination, `${archive}.json`);
    const metadataStatus = await lstat(metadataPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (metadataStatus && (!metadataStatus.isFile() || metadataStatus.isSymbolicLink()))
      throw new Error("SDK provenance must be a regular file");
    const metadataStage = join(temporary, "provenance.json");
    await writeFile(metadataStage, `${JSON.stringify(provenance, null, 2)}\n`);
    await rename(metadataStage, metadataPath);
    return { ...provenance, path: target };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: runtime_sdk_pack.ts [destination] [--revision <commit>]. Packs committed SDK files and LICENSE; no Cargo, hooks or engine sources.",
    );
  } else {
    let destination = "dist/sdk";
    let revision: string | undefined;
    while (args.length) {
      const arg = args.shift()!;
      if (arg === "--revision") {
        revision = args.shift();
        if (!revision || !/^[a-f0-9]{40}$/.test(revision))
          throw new Error("--revision requires a full commit");
      } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
      else destination = arg;
    }
    const root = resolve(import.meta.dir, "../..");
    console.log(
      (await packRuntimeSdk({ root, destination: resolve(root, destination), revision })).path,
    );
  }
}
