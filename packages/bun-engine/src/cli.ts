#!/usr/bin/env bun
import { policyFor } from "./catalog";
import { loadConsoleReferences, validateConsoleReferences } from "./console/references";
import { launch, trace } from "./launcher";
import { runNative } from "./nds/cli";
import { probeHost } from "./probe";
import { buildWorkspace, compileWorkspace, isCompileTarget, serveWorkspace, testWorkspace } from "./workspace";

async function main(): Promise<void> {
  const [command = "probe", appId, target, sources] = process.argv.slice(2);
  if (command === "probe") console.log(JSON.stringify(await probeHost(), null, 2));
  else if (command === "build") process.exitCode = await buildWorkspace(appId === "--release");
  else if (command === "test") process.exitCode = await testWorkspace();
  else if (command === "references") {
    const references = await loadConsoleReferences();
    const errors = await validateConsoleReferences(references);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(JSON.stringify(references, null, 2));
  }
  else if (command === "nds:info" && appId)
    process.exitCode = await runNative(["info", appId, ...(target ? [target] : [])]);
  else if (command === "run" && appId) process.exitCode = await runNative(process.argv.slice(2));
  else if (command === "compile") {
    const compileTarget = isCompileTarget(appId) ? appId : undefined;
    if (appId && !compileTarget && appId.startsWith("bun-"))
      throw new TypeError(`unsupported compile target: ${appId}`);
    process.exitCode = await compileWorkspace({
      target: compileTarget,
      outfile: compileTarget ? target : appId,
      bytecodeOrder: (compileTarget ? sources : target)?.split(","),
    });
  } else if (command === "web") await serveWorkspace();
  else if (command === "qualify" && appId) console.log(JSON.stringify(policyFor(appId), null, 2));
  else if (command === "launch" && appId) process.exitCode = await launch(appId);
  else if (command === "trace" && appId) process.exitCode = await trace(appId);
  else {
    throw new Error(
      "reverse engineering (Replica, Ghidra, Magika, pipeline) lives in `re`.\nusage: bun-engine build [--release] | compile [bun-<os>-<arch>] [outfile] [bytecode-order] | test | web | probe | references | nds:info <rom.nds> [--json] | run <nds|arm|x86|linux> <image> [--headless] [--frames N] [--out DIR] | qualify <appid> | launch <appid> | trace <appid>",
    );
  }
}

void main();
