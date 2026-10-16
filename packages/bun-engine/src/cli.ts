#!/usr/bin/env bun
import { policyFor } from "./catalog";
import { basename, extname, resolve } from "node:path";
import { loadConsoleReferences, validateConsoleReferences } from "./console/references";
import { listReplicaSkills, readReplicaSkill } from "./core/replica";
import { initializeReplicaInput } from "./core/replica-input";
import { launch, trace } from "./launcher";
import { identifyWithMagika, setupMagika } from "./ml/magika";
import { runNdsCli } from "./nds/cli";
import { inspectNdsReplica } from "./pipeline/nds-replica";
import { replicaPipeline } from "./pipeline/replica";
import { reverseEngineeringPipeline } from "./pipeline/reverse";
import { probeHost } from "./probe";
import { buildGhidraWindows, inspectPeForGhidra, probeGhidraWindows } from "./re/ghidra";
import { buildWorkspace, compileWorkspace, isCompileTarget, serveWorkspace, testWorkspace } from "./workspace";

async function main(): Promise<void> {
  const [command = "probe", appId, target, sources] = process.argv.slice(2);
  if (command === "probe") console.log(JSON.stringify(await probeHost(), null, 2));
  else if (command === "build") process.exitCode = await buildWorkspace(appId === "--release");
  else if (command === "test") process.exitCode = await testWorkspace();
  else if (command === "ml:setup") process.exitCode = await setupMagika();
  else if (command === "ml:identify" && appId) console.log(JSON.stringify(await identifyWithMagika(appId), null, 2));
  else if (command === "skills") console.log(JSON.stringify(await listReplicaSkills(), null, 2));
  else if (command === "references") {
    const references = await loadConsoleReferences();
    const errors = await validateConsoleReferences(references);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(JSON.stringify(references, null, 2));
  } else if (command === "skill" && appId) console.log(await readReplicaSkill(appId));
  else if (command === "pipeline" && appId === "replica") console.log(JSON.stringify(await replicaPipeline(), null, 2));
  else if (command === "pipeline" && appId === "reverse")
    console.log(JSON.stringify(reverseEngineeringPipeline, null, 2));
  else if (command === "replica:nds" && appId) console.log(JSON.stringify(await inspectNdsReplica(appId), null, 2));
  else if (command === "replica:init" && appId)
    console.log(
      JSON.stringify(
        await initializeReplicaInput(
          appId,
          target ?? resolve(import.meta.dir, "../../../var/replica", basename(appId, extname(appId))),
        ),
        null,
        2,
      ),
    );
  else if (command === "nds:info" && appId)
    process.exitCode = await runNdsCli(["info", appId, ...(target ? [target] : [])]);
  else if (command === "ghidra:probe") console.log(JSON.stringify(await probeGhidraWindows(), null, 2));
  else if (command === "ghidra:inspect" && appId) console.log(JSON.stringify(await inspectPeForGhidra(appId), null, 2));
  else if (command === "ghidra:build") process.exitCode = await buildGhidraWindows();
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
      "usage: bun-engine build [--release] | compile [bun-<os>-<arch>] [outfile] [bytecode-order] | test | web | probe | skills | references | skill <replica-name> | pipeline <replica|reverse> | replica:nds <rom.nds> | replica:init <rom.nds> [output] | nds:info <rom.nds> [--json] | ghidra:probe | ghidra:inspect <pe> | ghidra:build | ml:setup | ml:identify <path> | qualify <appid> | launch <appid> | trace <appid>",
    );
  }
}

void main();
