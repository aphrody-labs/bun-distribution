#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { loadConfig, repositoryRoot, type RuntimePin } from "@aphrody/bun-workspace";
import { buildAppArtifact, planAppArtifacts } from "./build.ts";
import { isObject, parseArtifactTarget } from "./manifest.ts";
import {
  ArtifactError,
  type NativeArtifactReceipt,
  type NativeFileInput,
  type RuntimeArtifactReceipt,
  type SharedAssetsReference,
  type AppManifest,
} from "./types.ts";

const usage = `Aphrody / Bun artifacts
  list [--json]
  build APP --target TARGET --bun FILE --runtime-pin JSON --native FILE --native-receipt JSON
    [--runtime-receipt JSON] [--resources JSON] [--shared-assets JSON] [--output FILE]
    [--protocol cli|cli-json|jsonl|mcp-stdio] [--root DIR] [--timeout MS]
Native artifacts are built by bun run workspace build LIBRARY.
`;

function required(value: string | undefined, label: string): string {
  if (!value) throw new ArtifactError("INVALID_OPTIONS", `${label} is required.`);
  return value;
}

async function readJSON<T>(path: string): Promise<T> {
  const file = Bun.file(path);
  if (!file.size || file.size > 1024 * 1024)
    throw new ArtifactError("INVALID_OPTIONS", "Artifact metadata must fit within 1 MiB.");
  return (await file.json()) as T;
}

try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      target: { type: "string" },
      bun: { type: "string" },
      "runtime-pin": { type: "string" },
      "builder-runtime-pin": { type: "string" },
      native: { type: "string" },
      "native-receipt": { type: "string" },
      "runtime-receipt": { type: "string" },
      resources: { type: "string" },
      "shared-assets": { type: "string" },
      output: { type: "string" },
      root: { type: "string" },
      timeout: { type: "string" },
      protocol: { type: "string" },
    },
  });
  const [command, appId, ...extra] = positionals;
  if (values.help || !command) console.log(usage);
  else if (command === "list" && !appId && !extra.length) {
    const plan = planAppArtifacts(await loadConfig(values.root ?? repositoryRoot));
    if (values.json) console.log(JSON.stringify(plan, null, 2));
    else for (const app of plan) console.log(`Aphrody ${app.title}: ${app.availability}`);
  } else if (command === "build" && appId && !extra.length) {
    const pin = await readJSON<RuntimePin>(required(values["runtime-pin"], "Runtime pin"));
    if (!isObject(pin)) throw new ArtifactError("INVALID_OPTIONS", "A pinned target runtime is required.");
    const protocol = values.protocol;
    if (protocol !== undefined && !["cli", "cli-json", "jsonl", "mcp-stdio"].includes(protocol)) {
      throw new ArtifactError("INVALID_OPTIONS", "Select a native engine protocol.");
    }
    const artifact = await buildAppArtifact({
      appId,
      target: parseArtifactTarget(required(values.target, "Target")),
      bunExecutable: required(values.bun, "Bun executable"),
      expectedRuntime: pin,
      builderRuntime: values["builder-runtime-pin"]
        ? await readJSON<RuntimePin>(values["builder-runtime-pin"])
        : undefined,
      nativeBinary: required(values.native, "Native engine"),
      nativeReceipt: await readJSON<NativeArtifactReceipt>(required(values["native-receipt"], "Native receipt")),
      targetRuntimeReceipt: values["runtime-receipt"]
        ? await readJSON<RuntimeArtifactReceipt>(values["runtime-receipt"])
        : undefined,
      nativeFiles: values.resources ? await readJSON<NativeFileInput[]>(values.resources) : undefined,
      sharedAssets: values["shared-assets"]
        ? await readJSON<SharedAssetsReference>(values["shared-assets"])
        : undefined,
      engineProtocol: protocol as AppManifest["engine"]["protocol"] | undefined,
      output: values.output,
      root: values.root,
      timeoutMs: values.timeout === undefined ? undefined : Number(values.timeout),
    });
    console.log(JSON.stringify(artifact, null, 2));
  } else throw new ArtifactError("INVALID_OPTIONS", "Use list or build with one application identifier.");
} catch (error) {
  const code = error instanceof ArtifactError ? error.code : "BUILD_FAILED";
  console.error(
    JSON.stringify({
      error: code,
      message: error instanceof ArtifactError ? error.message : "The artifact operation failed.",
    }),
  );
  process.exitCode = 1;
}
