// SPDX-License-Identifier: MIT
import { copyFile, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertRuntimeFacts, hashFile, type RuntimePin } from "@aphrody/bun-workspace";
import type { RuntimeArtifactReceipt } from "@aphrody/bun-artifacts";
import { inspectLinuxABI } from "../../src/elf.ts";

/** Stage a qualified fork binary; Alpine never substitutes the upstream runtime. */
export async function stageAlpineRuntime(
  context: string,
  architecture: "amd64" | "arm64",
  binary: string,
  receiptPath: string,
  expected: RuntimePin,
) {
  const entry = await lstat(binary);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > 200 * 1024 * 1024)
    throw new Error("Alpine runtime must be a bounded regular executable");
  const receipt: RuntimeArtifactReceipt = await Bun.file(receiptPath).json();
  const arch = architecture === "amd64" ? "x64" : "arm64";
  if (
    receipt.target !== `bun-linux-${arch}-musl` ||
    !receipt.qualification ||
    !["native", "ssh", "docker"].includes(receipt.qualification.mode) ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(receipt.qualification.host) ||
    !Number.isFinite(Date.parse(receipt.qualification.observedAt))
  ) throw new Error("Alpine requires an actual musl target qualification receipt");
  assertRuntimeFacts(expected, receipt.facts);
  const digest = await hashFile(binary, { maxBytes: 200 * 1024 * 1024 });
  if (receipt.sha256 !== digest) throw new Error("Alpine runtime digest differs from its qualification receipt");
  await inspectLinuxABI(binary, arch, "musl");
  const directory = join(context, "runtime", architecture);
  await mkdir(directory, { recursive: true });
  const staged = join(directory, "bun");
  await copyFile(binary, staged);
  if (await hashFile(staged, { maxBytes: 200 * 1024 * 1024 }) !== digest)
    throw new Error("Alpine runtime changed during staging");
  await Bun.write(join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  return { architecture, sha256: digest, revision: expected.revision };
}
