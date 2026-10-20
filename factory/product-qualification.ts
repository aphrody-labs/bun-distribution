// SPDX-License-Identifier: MIT
import { mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { productIdentity, sameProductIdentity, verifyProductPayload } from "../container/product-payload.ts";
import { verifyQualifiedProduct, type ProductQualification } from "../container/verify-product.ts";

/** Qualify CLI discovery and route targets; native commands retain their own gates. */
export async function qualifyProductPayload(workspace: string, receiptPath: string, executable: string, output: string) {
  if (process.platform !== "linux") throw new Error("Product CLI qualification runs on the Linux factory");
  workspace = resolve(workspace);
  executable = await realpath(executable);
  output = resolve(output);
  const destination = relative(workspace, output);
  if (!destination || (destination !== ".." && !destination.startsWith(`..${sep}`) && !isAbsolute(destination)))
    throw new Error("Product qualification receipt must be outside the frozen workspace");
  const input = await Bun.file(receiptPath).json();
  const target = process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : "";
  const expected = { target, runtime: input.runtime };
  const receipt = await verifyProductPayload(workspace, receiptPath, expected);
  if (!sameProductIdentity(await productIdentity(executable), receipt.runtime))
    throw new Error("Product qualification executable differs from its prepared runtime");
  const evidence = [];
  let commands: { group: string; name: string }[] = [];
  for (const args of [["--help"], ["commands", "--all", "--json"], ["commands", "--check"]]) {
    const result = await runProcess([resolve(executable), "--no-env-file", "src/cli.ts", ...args], workspace, {
      timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
      env: { ...Bun.env, BUN_BE_BUN: undefined },
    });
    if (result.code !== 0) throw new Error(`Product CLI qualification failed (${args.join(" ")}): ${result.stderr.slice(-3000)}`);
    if (args.includes("--json")) {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(parsed) || parsed.some(entry => !entry || typeof entry.group !== "string" || typeof entry.name !== "string"))
        throw new Error("Product command discovery returned an invalid catalog");
      commands = parsed;
    }
    evidence.push({ args, exitCode: result.code, stdoutSHA256: new Bun.CryptoHasher("sha256").update(result.stdout).digest("hex") });
  }
  if (!["mcp", "agent-plugin", "wasm"].every(name => commands.some(entry => entry.group === "" && entry.name === name)))
    throw new Error("Product CLI is missing a required native capability route");
  await verifyProductPayload(workspace, receiptPath, expected);
  if (!sameProductIdentity(await productIdentity(executable), receipt.runtime))
    throw new Error("Product runtime changed during CLI qualification");
  const qualification: ProductQualification = {
    schemaVersion: 1, kind: "bun-os-product-qualification", passed: true,
    target: receipt.target, sourceRevision: receipt.sourceRevision,
    installedTreeSHA256: receipt.installedTreeSHA256, runtimeSHA256: receipt.runtime.sha256,
    installedModesSHA256: receipt.installedModesSHA256,
    gates: ["product-cli"],
  };
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  const physicalDestination = relative(await realpath(workspace), resolve(parent, basename(output)));
  if (!physicalDestination || (physicalDestination !== ".." && !physicalDestination.startsWith(`..${sep}`) && !isAbsolute(physicalDestination)))
    throw new Error("Product qualification output resolves inside the frozen workspace");
  const file = await open(output, "wx");
  try {
    await file.writeFile(JSON.stringify({ ...qualification, scope: "CLI discovery and route targets", evidence,
      commandCount: commands.length, nativeCommandsQualified: false, fullProductQualified: false }, null, 2) + "\n");
  } finally { await file.close(); }
  await verifyQualifiedProduct(workspace, receiptPath, output, expected);
  return qualification;
}
