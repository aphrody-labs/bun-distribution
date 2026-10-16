#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Live WinClean/RE artifact run through a private hidden Aphrody OS kernel: hashes, strings,
 * entropy, XOR/AES-CTR transforms, `.text` section dump, PE header, AOB scan, app.asar listing,
 * OS info and one A2A round trip, on the ChatGPT executable of the `OpenAI.Codex` MSIX or an
 * explicit file.
 *
 * Usage: bun scripts/tools/os/scripts/live-winclean-artifacts.ts [--source <file>] [--artifact-root var/winclean-live]
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  artifactDirs,
  parseOptions,
  repoRoot,
  sessionStamp,
  withKernel,
  writeArtifacts,
} from "./kernel-session.ts";
import { findMsixPackage } from "./msix.ts";

const OWNER_BY_ARTIFACT = {
  "binary-hash-multi.json": "aphrody-re",
  "binary-extract-strings.json": "aphrody-re",
  "binary-entropy-map.json": "aphrody-re",
  "binary-xor-decrypt.json": "aphrody-re",
  "binary-aes-ctr-decrypt.json": "aphrody-re",
  "binary-section-dump.json": "aphrody-re",
  "binary-parse-pe-header.json": "aphrody-re",
  "aob-scan.json": "aphrody-re",
  "asar-list.json": "aphrody-re",
  "os-info.json": "aphrody-winclean",
  "a2a-codex-gui-electron.json": "aphrody-re",
};
const BINARY_OUTPUTS = [
  "xor-output.bin",
  "aes-output.bin",
  "pe-text-section.bin",
];
const ZERO_128 = "0".repeat(32);

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2), [
    "source",
    "artifact-root",
  ]);
  if (options.has("help")) {
    console.log(
      "Usage: bun scripts/tools/os/scripts/live-winclean-artifacts.ts [--source <file>] [--artifact-root var/winclean-live]",
    );
    return 0;
  }
  let targetKind = "chatgpt-msix";
  let source: string;
  const explicit = options.get("source");
  if (explicit) {
    targetKind = "explicit";
    source = resolve(repoRoot, explicit);
  } else {
    const pkg = findMsixPackage("OpenAI.Codex");
    if (!pkg)
      throw new Error(
        "OpenAI.Codex MSIX package not installed; --source <file> is required.",
      );
    source = join(pkg.installLocation, "app", "ChatGPT.exe");
  }
  if (!existsSync(source) || !statSync(source).isFile())
    throw new Error(`Source file missing: ${source}`);
  const asarPath = join(dirname(source), "resources", "app.asar");

  const stamp = sessionStamp();
  const dirs = artifactDirs(
    options.get("artifact-root") ?? "var/winclean-live",
    stamp,
  );
  return withKernel("winclean-live", stamp, async (kernel) => {
    const tools = await kernel.client.request("tools/list", {});
    const toolCount = ((tools as { tools?: unknown[] })?.tools ?? []).length;
    const outputs = {
      "kernel-tools.json": tools,
      "binary-hash-multi.json": await kernel.call("binary_hash_multi", {
        path: source,
      }),
      "binary-extract-strings.json": await kernel.call(
        "binary_extract_strings",
        {
          path: source,
          minLength: 4,
          maxResults: 32,
        },
      ),
      "binary-entropy-map.json": await kernel.call("binary_entropy_map", {
        path: source,
        blockSize: 256,
      }),
      "binary-xor-decrypt.json": await kernel.call("binary_xor_decrypt", {
        inputPath: source,
        outputPath: join(dirs.session, "xor-output.bin"),
        keyHex: "A5 5A",
      }),
      "binary-aes-ctr-decrypt.json": await kernel.call(
        "binary_aes_ctr_decrypt",
        {
          inputPath: source,
          outputPath: join(dirs.session, "aes-output.bin"),
          keyHex: ZERO_128,
          ivHex: ZERO_128,
        },
      ),
      "binary-section-dump.json": await kernel.call("binary_section_dump", {
        path: source,
        sectionName: ".text",
        outputPath: join(dirs.session, "pe-text-section.bin"),
      }),
      "binary-parse-pe-header.json": await kernel.call(
        "binary_parse_pe_header",
        { path: source },
      ),
      "aob-scan.json": await kernel.call("aob_scan", {
        path: source,
        pattern: "4D 5A ?",
        maxMatches: 10,
      }),
      "asar-list.json": existsSync(asarPath)
        ? await kernel.call("asar_list", { path: asarPath })
        : {
            success: false,
            skipped: true,
            error: `app.asar not found: ${asarPath}`,
          },
      "os-info.json": await kernel.call("get_os_info"),
      // The GUI consumer asks the kernel, which routes to the owning subsystem.
      "a2a-codex-gui-electron.json": await kernel.a2a(
        "kernel",
        "binary_hash_multi",
        { path: source },
        "codex-gui-electron",
      ),
    };
    const manifest = {
      schema: "aphrody.winclean.live.v1",
      status: "verified-live",
      session: stamp,
      generatedAt: new Date().toISOString(),
      producer: "aphrody-kernel",
      source,
      targetKind,
      consumers: ["aphrody-re", "codex", "gui-electron"],
      transport: ["mcp/tools-call", "a2a/message/send", "cli"],
      ownerByArtifact: OWNER_BY_ARTIFACT,
      toolCount,
      artifacts: [
        "manifest.json",
        "kernel-tools.json",
        ...Object.keys(OWNER_BY_ARTIFACT),
        ...BINARY_OUTPUTS,
      ],
    };
    writeArtifacts(
      dirs,
      { "manifest.json": manifest, ...outputs },
      BINARY_OUTPUTS,
    );
    console.log(
      JSON.stringify({
        status: "verified-live",
        session: stamp,
        latest: dirs.latest,
        source,
        toolCount,
      }),
    );
    return 0;
  });
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
