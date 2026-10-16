#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runProductCLI } from "../packages/bun-app-host/src/cli.ts";
import { inspectSourceWorkspace } from "./source-workspace.ts";
import { compositions, planArchDistribution, type Composition } from "../factory/arch/index.ts";
import { buildArchRootfs, planArchFactory, validateArchPackageLock } from "../factory/arch/pacman.ts";
import { resolveArchLock } from "../factory/arch/resolve.ts";
import { planFactoryGraph } from "../factory/graph.ts";
import { inspectMsys2Sources } from "../factory/arch/msys2.ts";
import {
  assembleSources,
  buildImage,
  buildWasm,
  packageRoot,
  plan,
  stageRuntime,
  stageArchRootfs,
  type Config,
  type Profile,
  type Target,
} from "./distribution.ts";

const usage = `Bun OS factory
  server serve [ROOT] | verify [BINARY] [RECEIPT] | --version
  plan [--profile full|perf] [--target linux-x64|linux-arm64|windows-x64|macos-arm64|wasm]
  workspace [--config FILE]
  graph [--profile full|perf] [--target TARGET]
  factory --action plan|host|resolve|rootfs --composition server|desktop|gaming [--snapshot YYYY-MM-DD]
          [--root ABSOLUTE_FACTORY] [--lock FILE] [--executor docker|native]
          [--msys-source-root DIR] [--msys-home DIR]
  sources --out DIR [--config FILE]
  stage --out DIR --runtime FILE --receipt FILE --profile full|perf --target TARGET
  rootfs-stage --out DIR --receipt ROOTFS_RECEIPT --composition server|desktop|gaming --target linux-x64
  wasm --out DIR [--config FILE]
  image --out DIR --root ABSOLUTE_FACTORY --profile full|perf --target linux-x64 --composition server|desktop|gaming --tag TAG

Config: { "checkouts": { "material": "../material", "cosmic-epoch": "../cosmic" } }
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
        action: { type: "string", default: "plan" },
        composition: { type: "string", default: "server" },
        snapshot: { type: "string" },
        root: { type: "string" },
        lock: { type: "string" },
        executor: { type: "string", default: "docker" },
        "msys-source-root": { type: "string" },
        "msys-home": { type: "string" },
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
    const required = (name: "out" | "runtime" | "receipt" | "material" | "tag" | "root" | "lock" | "snapshot") => {
      const value = values[name];
      if (!value) throw new Error(`Missing --${name}`);
      return value;
    };
    if (!compositions.includes(values.composition as Composition)) throw new Error("Unknown composition");
    const composition = values.composition as Composition;
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
      case "graph":
        result = await planFactoryGraph({ profile, target, config, composition, snapshot: values.snapshot });
        break;
      case "factory": {
        if (values.action === "host") {
          result = await inspectMsys2Sources({ sourceRoot: values["msys-source-root"], home: values["msys-home"] });
          break;
        }
        if (!["docker", "native"].includes(values.executor!)) throw new Error("Unknown factory executor");
        const distribution = await planArchDistribution({ target, composition, snapshot: values.snapshot });
        if (values.action === "resolve") {
          if (target !== "linux-x64") throw new Error("Arch resolution currently supports Linux x86_64 only");
          result = await resolveArchLock({
            root: required("root"),
            snapshot: required("snapshot"),
            composition,
            packages: distribution.requestedPackages,
          });
        } else if (values.action === "rootfs" || (values.action === "plan" && values.lock)) {
          const lock = validateArchPackageLock(await Bun.file(resolve(required("lock"))).json());
          if (lock.composition !== composition || target !== lock.target)
            throw new Error("Lock target/composition mismatch");
          const factoryProfile = await Bun.file(resolve(packageRoot, "factory/profile.json")).json();
          const options = {
            root: required("root"),
            lock,
            executor: values.executor as "docker" | "native",
            profile: factoryProfile,
          };
          result =
            values.action === "rootfs"
              ? await buildArchRootfs(options)
              : { distribution, factory: await planArchFactory(options) };
        } else if (values.action === "plan") result = distribution;
        else throw new Error("Unknown factory action");
        break;
      }
      case "workspace": {
        const workspace = await inspectSourceWorkspace(config);
        if (!workspace.allSelectedSourceOwnersCovered) process.exitCode = 1;
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
      case "rootfs-stage":
        result = await stageArchRootfs(resolve(required("out")), resolve(required("receipt")), target, composition);
        break;
      case "wasm":
        result = await buildWasm(resolve(required("out")), config);
        break;
      case "image":
        result = await buildImage(
          resolve(required("out")),
          profile,
          target,
          required("tag"),
          composition,
          required("root"),
        );
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
