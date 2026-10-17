#!/usr/bin/env bun
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess } from "@aphrody/bun-workspace/process";

const repositoryRoot = await realpath(resolve(import.meta.dir, ".."));
const defaultOutput = "build/frontend/artcraft";
const outputBase = resolve(repositoryRoot, "build/frontend");
const frontendScript = resolve(repositoryRoot, "packages/artcraft-frontend/scripts/artcraft.ts");
const frontendOwner = repositoryRoot;
const receiptPrefix = "APHRODY_FRONTEND_BUILD_RECEIPT=";
const usage = "Usage: bun scripts/build-frontend.ts build [--output build/frontend/<fresh-name>]";

function inside(base: string, target: string, allowEqual = false): boolean {
  const path = relative(resolve(base), resolve(target));
  return (allowEqual && path === "") || (!!path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function parseArguments(args: string[]): string {
  const [command, ...options] = args;
  if (command !== "build") throw new Error(usage);

  let output = defaultOutput;
  let outputWasSet = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option !== "--output" || outputWasSet || !options[index + 1]) throw new Error(usage);
    output = options[++index]!;
    outputWasSet = true;
  }

  if (output.includes("\0") || isAbsolute(output) || /^[a-z]:/i.test(output) || output.startsWith("\\")) {
    throw new Error("Output must be a relative path under build/frontend.");
  }
  const parts = output.replaceAll("\\", "/").split("/");
  if (parts.some(part => !part || part === "." || part === "..")) {
    throw new Error("Output must be a normalized relative path under build/frontend.");
  }
  const normalized = parts.join("/");
  if (
    !normalized.toLowerCase().startsWith("build/frontend/") ||
    normalized.toLowerCase().startsWith("build/frontend/.receipts/")
  ) {
    throw new Error("Output must stay under build/frontend.");
  }
  return normalized;
}

async function assertNoReparsePath(path: string): Promise<void> {
  if (!inside(repositoryRoot, path, true)) throw new Error("Output path escapes the repository.");
  const parts = relative(repositoryRoot, path).split(sep).filter(Boolean);
  let current = repositoryRoot;
  for (const part of parts) {
    current = join(current, part);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) throw new Error("Output path contains a reparse point.");
      const canonical = await realpath(current);
      if (!inside(repositoryRoot, canonical, true)) throw new Error("Output path resolves outside the repository.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("reparse point")) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function gitRevision(cwd: string): Promise<string> {
  const result = await runProcess(["git", "rev-parse", "HEAD"], cwd, {
    timeoutMs: 15_000,
    maxOutputBytes: 4096,
    stderr: "discard",
  });
  const revision = result.stdout.trim();
  if (result.code !== 0 || !/^[0-9a-f]{40}$/i.test(revision))
    throw new Error("Unable to fingerprint a build source revision.");
  return revision;
}

async function sha256File(path: string): Promise<string> {
  const digest = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) digest.update(chunk);
  return digest.digest("hex");
}

async function sourceFingerprint() {
  return {
    rootGitHead: await gitRevision(repositoryRoot),
    artcraftGitPin: await gitRevision(frontendOwner),
    bunLockSHA256: await sha256File(resolve(repositoryRoot, "bun.lock")),
  };
}

async function artifactTreeIdentity(root: string) {
  const started = Date.now();
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const pending = [root];
  let bytes = 0;
  while (pending.length) {
    if (Date.now() - started > 120_000) throw new Error("Artifact receipt hashing exceeded its deadline.");
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error("Built output contains a reparse point.");
      if (metadata.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!metadata.isFile()) throw new Error("Built output contains a non-file entry.");
      bytes += metadata.size;
      if (bytes > 10 * 1024 * 1024 * 1024 || files.length >= 100_000)
        throw new Error("Built output exceeds receipt bounds.");
      files.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: metadata.size,
        sha256: await sha256File(path),
      });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = new Bun.CryptoHasher("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return { files: files.length, bytes, sha256: digest.digest("hex") };
}

function buildBootstrap(output: string, outputPath: string): string {
  return `
const prefix = ${JSON.stringify(receiptPrefix)};
const owner = ${JSON.stringify(frontendOwner)};
const entry = ${JSON.stringify(pathToFileURL(frontendScript).href)};
const output = ${JSON.stringify(output)};
const outputPath = ${JSON.stringify(outputPath)};
const path = await import("node:path");
function safeFailure(error) {
  const first = error instanceof AggregateError ? error.errors[0] ?? error : error;
  const code = typeof first?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(first.code) ? first.code : "FRONTEND_BUILD_FAILED";
  const position = first?.position && typeof first.position === "object" ? first.position : undefined;
  const candidate = typeof position?.file === "string" ? position.file : typeof first?.path === "string" ? first.path : undefined;
  let sourcePath = output;
  if (candidate && candidate.length <= 1024 && !/[\\x00-\\x1f]/.test(candidate)) {
    const relativePath = path.relative(owner, path.resolve(candidate));
    if (relativePath && relativePath !== ".." && !relativePath.startsWith(".." + path.sep) && !path.isAbsolute(relativePath)) {
      sourcePath = relativePath.split(path.sep).join("/");
    }
  }
  const diagnostic = { code, path: sourcePath };
  if (Number.isInteger(position?.line) && position.line > 0) diagnostic.line = position.line;
  if (Number.isInteger(position?.column) && position.column >= 0) diagnostic.column = position.column;
  return diagnostic;
}
try {
  const { buildFrontend } = await import(entry);
  const result = await buildFrontend({ outdir: outputPath });
  console.log(prefix + JSON.stringify({ status: "success", artifacts: result.outputs.length }));
} catch (error) {
  console.log(prefix + JSON.stringify({ status: "failed", error: safeFailure(error) }));
  process.exitCode = 1;
}
`;
}

async function main(): Promise<void> {
  const output = parseArguments(Bun.argv.slice(2));
  const outputPath = resolve(repositoryRoot, output);
  if (!inside(outputBase, outputPath)) throw new Error("Output must stay below build/frontend.");

  const frontendMetadata = await lstat(frontendScript);
  if (frontendMetadata.isSymbolicLink()) throw new Error("The ArtCraft build entry point cannot be a reparse point.");
  if (!inside(frontendOwner, await realpath(frontendScript))) {
    throw new Error("The ArtCraft build entry point resolves outside its source owner.");
  }

  await assertNoReparsePath(dirname(outputPath));
  await mkdir(dirname(outputPath), { recursive: true });
  await assertNoReparsePath(dirname(outputPath));
  const canonicalParent = await realpath(dirname(outputPath));
  if (!inside(outputBase, canonicalParent, true)) throw new Error("Output parent resolves outside build/frontend.");

  try {
    await mkdir(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Output must be fresh; choose a new --output path for each build.", { cause: error });
    }
    throw error;
  }
  await assertNoReparsePath(outputPath);
  const canonicalOutput = await realpath(outputPath);
  if (!inside(outputBase, canonicalOutput)) throw new Error("Output resolves outside build/frontend.");

  if (Bun.version !== "1.4.4") throw new Error("Use the workspace Bun 1.4.4 runtime.");
  const sourcesBefore = await sourceFingerprint();
  let childCode = -1;
  let childStdout = "";
  let processErrorCode: string | undefined;
  try {
    const child = await runProcess([process.execPath, "-e", buildBootstrap(output, canonicalOutput)], repositoryRoot, {
      timeoutMs: 20 * 60 * 1000,
      maxOutputBytes: 16 * 1024 * 1024,
      stdout: "capture",
      stderr: "capture",
    });
    childCode = child.code;
    childStdout = child.stdout;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    processErrorCode = typeof code === "string" && /^[A-Z0-9_-]{1,64}$/.test(code) ? code : "PROCESS_FAILED";
  }
  const receiptLine = childStdout.split(/\r?\n/).find(line => line.startsWith(receiptPrefix));
  let childReceipt: {
    status?: string;
    artifacts?: number;
    error?: { code?: string; path?: string; line?: number; column?: number };
  } = {};
  if (receiptLine) {
    try {
      childReceipt = JSON.parse(receiptLine.slice(receiptPrefix.length)) as typeof childReceipt;
    } catch {
      childReceipt = {
        status: "failed",
        error: { code: "INVALID_CHILD_RECEIPT", path: output },
      };
    }
  } else {
    childReceipt = {
      status: "failed",
      error: {
        code: processErrorCode ?? `CHILD_EXIT_${childCode}`,
        path: output,
      },
    };
  }

  const sourcesAfter = await sourceFingerprint();
  const pinsUnchanged = JSON.stringify(sourcesBefore) === JSON.stringify(sourcesAfter);
  const status = childCode === 0 && childReceipt.status === "success" && pinsUnchanged ? "success" : "failed";
  const artifactTree = status === "success" ? await artifactTreeIdentity(canonicalOutput) : undefined;
  const report = {
    schemaVersion: 1,
    action: "build",
    status,
    runtime: { name: "Bun", version: Bun.version, revision: Bun.revision },
    sources: sourcesBefore,
    sourcePinsUnchangedDuringBuild: pinsUnchanged,
    output,
    artifactsBuilt: childReceipt.artifacts ?? 0,
    artifactTree,
    compiled: status === "success",
    executed: false,
    deployed: false,
    error:
      status === "success"
        ? undefined
        : (childReceipt.error ?? {
            code: processErrorCode ?? (pinsUnchanged ? `CHILD_EXIT_${childCode}` : "SOURCE_PINS_CHANGED_DURING_BUILD"),
            path: output,
          }),
  };
  const receiptPath = join(canonicalOutput, "build-receipt.json");
  const receiptFile = await open(receiptPath, "wx");
  try {
    await receiptFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await receiptFile.close();
  }
  console.log(JSON.stringify(report));
  if (status !== "success") process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "ArtCraft frontend build failed.");
  process.exitCode = 1;
}
