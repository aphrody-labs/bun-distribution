// SPDX-License-Identifier: Apache-2.0
// Distribution factory commands: plan, graph, sources, stage, rootfs-stage, wasm, image, msys2, arch, workspace.
// Moved from the former src/cli.ts so that one registry (src/cli/commands.ts) owns every entry point.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compositions, planArchDistribution, type Composition } from "../../factory/arch/index.ts";
import { inspectMsys2Sources } from "../../factory/arch/msys2.ts";
import { buildArchRootfs, planArchFactory, validateArchPackageLock } from "../../factory/arch/pacman.ts";
import { resolveArchLock } from "../../factory/arch/resolve.ts";
import { planFactoryGraph } from "../../factory/graph.ts";
import {
  captureMsys2DesktopLock,
  doctorMsys2Desktop,
  planMsys2Desktop,
  type Msys2DesktopABI,
} from "../../factory/msys2/index.ts";
import {
  assembleSources,
  buildImage,
  buildWasm,
  packageRoot,
  plan,
  stageArchRootfs,
  stageRuntime,
  type Config,
  type Profile,
  type Target,
} from "../distribution.ts";
import { inspectSourceWorkspace } from "../source-workspace.ts";

const OPTIONS = {
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
  "msys-root": { type: "string" },
  "msys-pacman": { type: "string" },
  abi: { type: "string" },
} as const;

export const FACTORY_USAGE = `  --profile full|perf  --target linux-x64|linux-arm64|windows-x64|macos-arm64|wasm  --config FILE
  --composition server|desktop|gaming  --snapshot YYYY-MM-DD  --root ABSOLUTE_FACTORY  --lock FILE
  --out DIR  --runtime FILE  --receipt FILE  --tag TAG  --executor docker|native
  --action plan|host|resolve|rootfs  (arch)   --abi msvc-x64|msvc-arm64|msys-x64|ucrt64-x64|clang64-x64|clangarm64-arm64  (msys2)

Config: { "checkouts": { "material": "../material", "cosmic-epoch": "../cosmic" } }
Checkout paths resolve relative to the config file. Bun resolves from explicit configuration or the installed executable.
Sources contain committed, pinned files and every locked submodule; protected stores are never copied.
WASM builds libm3's portable API. Native Bun/JSC and the Linux compositor require their native targets.`;

/** `command` is the factory verb (plan, graph, ...); `msys2` takes its action as the first extra positional. */
export async function runFactoryCli(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  if (positionals.length !== (positionals[0] === "msys2" ? 2 : 1))
    throw new Error("Expected one factory command, or msys2 plan|doctor|lock");
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
    for (const [id, path] of Object.entries(config.checkouts ?? {})) config.checkouts![id] = resolve(file, "..", path);
    if (config.msys2) {
      for (const key of ["sourceRoot", "installationRoot", "pacmanPath", "home"] as const) {
        if (config.msys2[key]) config.msys2[key] = resolve(file, "..", config.msys2[key]);
      }
    }
    if (config.sourceExport) {
      if (config.sourceExport.cache) config.sourceExport.cache = resolve(file, "..", config.sourceExport.cache);
      for (const [id, path] of Object.entries(config.sourceExport.repositories ?? {}))
        config.sourceExport.repositories![id] = resolve(file, "..", path);
      config.sourceExport.protectedRoots = config.sourceExport.protectedRoots?.map(path => resolve(file, "..", path));
    }
  }
  let exitCode = 0;
  let result: unknown;
  const msys2Options = {
    ...config.msys2,
    ...(values["msys-source-root"] ? { sourceRoot: values["msys-source-root"] } : {}),
    ...(values["msys-home"] ? { home: values["msys-home"] } : {}),
    ...(values["msys-root"] ? { installationRoot: values["msys-root"] } : {}),
    ...(values["msys-pacman"] ? { pacmanPath: values["msys-pacman"] } : {}),
  };
  switch (positionals[0]) {
    case "msys2": {
      const options = {
        ...msys2Options,
        abi: values.abi as Msys2DesktopABI | undefined,
        ...(values.lock ? { packageLock: await Bun.file(resolve(values.lock)).json() } : {}),
      };
      if (positionals[1] === "plan") result = await planMsys2Desktop(options);
      else if (positionals[1] === "doctor") {
        const doctor = await doctorMsys2Desktop(options);
        if (!doctor.metadataReady) exitCode = 1;
        result = doctor;
      } else if (positionals[1] === "lock") {
        const planned = await planMsys2Desktop(options);
        result = captureMsys2DesktopLock(planned.inspection, planned.abi);
      } else throw new Error("Unknown MSYS2 action");
      if (values.out) await Bun.write(resolve(values.out), `${JSON.stringify(result, null, 2)}\n`);
      break;
    }
    case "graph":
      result = await planFactoryGraph({ profile, target, config, composition, snapshot: values.snapshot });
      break;
    case "factory": {
      if (values.action === "host") {
        result = await inspectMsys2Sources(msys2Options);
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
      if (!workspace.allSelectedSourceOwnersCovered) exitCode = 1;
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
      throw new Error(`Unknown factory command ${positionals[0]}`);
  }
  console.log(JSON.stringify(result, null, 2));
  return exitCode;
}
