#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runProductCLI } from "../packages/bun-app-host/src/cli.ts";
import { inspectSourceWorkspace } from "./source-workspace.ts";
import {
  assembleSources,
  buildImage,
  buildWasm,
  packageRoot,
  plan,
  stageRuntime,
  type Config,
  type Profile,
  type Target,
} from "./distribution.ts";

const usage = `Bun OS factory
  server serve [ROOT] | verify [BINARY] [RECEIPT] | --version
  plan [--profile full|perf] [--target linux-x64|linux-arm64|windows-x64|macos-arm64|wasm]
  workspace [--config FILE]
  sources --out DIR [--config FILE]
  stage --out DIR --runtime FILE --receipt FILE --profile full|perf --target TARGET
  wasm --out DIR [--config FILE]
  image --out DIR --profile full|perf --target linux-x64|linux-arm64 --tag TAG

Config: { "checkouts": { "material": "libraries/material", "bun": "toolchains/bun", "cosmic-epoch": "../cosmic" } }
Checkout paths resolve relative to the config file. Bun resolves from explicit configuration or the installed executable.
Sources contain committed, pinned files and every locked submodule; protected stores are never copied.
WASM builds libm3's portable API. Native Bun/JSC and the Linux compositor require their native targets.`;

try {
  if (Bun.argv[2] === "server") {
    await runProductCLI(Bun.argv.slice(3));
  } else {
    const { positionals, values } = parseArgs({
      args: Bun.argv.slice(2),
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        profile: { type: "string", default: "perf" },
        target: { type: "string", default: "linux-x64" },
        out: { type: "string" },
        config: { type: "string" },
        runtime: { type: "string" },
        receipt: { type: "string" },
        material: { type: "string" },
        tag: { type: "string" },
      },
    });
    if (values.help || !positionals.length) {
      console.log(usage);
      process.exit(0);
    }
    if (positionals.length !== 1) throw new Error("Expected one factory command");
    if (values.profile !== "full" && values.profile !== "perf") throw new Error("Unknown distribution profile");
    const profile: Profile = values.profile;
    if (!["linux-x64", "linux-arm64", "windows-x64", "macos-arm64", "wasm"].includes(values.target!))
      throw new Error("Unknown target");
    const target = values.target as Target;
    const required = (name: "out" | "runtime" | "receipt" | "material" | "tag") => {
      const value = values[name];
      if (!value) throw new Error(`Missing --${name}`);
      return value;
    };
    let config: Config = {};
    if (values.config) {
      const file = resolve(values.config);
      config = await Bun.file(file).json();
      for (const [id, path] of Object.entries(config.checkouts ?? {}))
        config.checkouts![id] = resolve(file, "..", path);
      if (config.sourceExport) {
        if (config.sourceExport.cache) config.sourceExport.cache = resolve(file, "..", config.sourceExport.cache);
        for (const [id, path] of Object.entries(config.sourceExport.repositories ?? {}))
          config.sourceExport.repositories![id] = resolve(file, "..", path);
        config.sourceExport.protectedRoots = config.sourceExport.protectedRoots?.map(path => resolve(file, "..", path));
      }
    }
    let result: unknown;
    switch (positionals[0]) {
      case "workspace": {
        const workspace = await inspectSourceWorkspace(config);
        if (!workspace.allSourceOwnersCovered) process.exitCode = 1;
        result = workspace;
        break;
      }
      case "plan":
        result = await plan(profile, target, config);
        break;
      case "sources":
        result = await assembleSources(resolve(required("out")), config);
        break;
      case "stage":
        if (target === "wasm") throw new Error("Use the wasm command for the portable library target");
        await stageRuntime(
          resolve(required("out")),
          resolve(required("runtime")),
          resolve(required("receipt")),
          profile,
          target,
        );
        result = { staged: true, profile, target };
        break;
      case "wasm":
        result = await buildWasm(resolve(required("out")), config);
        break;
      case "image":
        result = await buildImage(resolve(required("out")), profile, target, required("tag"));
        break;
      default:
        throw new Error(`Unknown command ${positionals[0]}; run ${packageRoot}/src/cli.ts --help`);
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
