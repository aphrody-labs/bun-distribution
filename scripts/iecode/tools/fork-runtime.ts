#!/usr/bin/env bun
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { ptr } from "bun:ffi";
import {
  inspectForkModules,
  buildForkCapabilityGraph,
  parseForkCapabilityCatalog,
  type ForkCapabilityCatalog,
} from "../../../packages/inagle/src/ffi/fork-runtime";
import { checkBunRuntime } from "../validation/bun-runtime";

export function selectForkCatalogSource(values: {
  "bun-source"?: string;
  "bun-root"?: string;
  catalog?: string;
  "producer-docs"?: string;
}) {
  if ([values["bun-source"], values["bun-root"], values.catalog].filter(Boolean).length !== 1)
    throw new Error("Select exactly one of --bun-source, --bun-root and --catalog");
  const bunSource = values["bun-source"] ?? values["bun-root"];
  if (values["producer-docs"] && !bunSource)
    throw new Error("--producer-docs requires an explicit Bun source checkout");
  return { bunSource, catalog: values.catalog, producerDocs: values["producer-docs"] };
}

function newExternalDirectory(path: string, repositories: string[]) {
  if (!isAbsolute(path)) throw new Error("Output directory must be absolute");
  const output = resolve(realpathSync(dirname(path)), basename(path));
  if (existsSync(output)) throw new Error("Output directory already exists");
  for (const repository of repositories) {
    const selected = relative(realpathSync(repository), output);
    if (!selected || (!selected.startsWith(`..${sep}`) && selected !== ".." && !isAbsolute(selected)))
      throw new Error("Output directory must be outside the selected source repositories");
  }
  return output;
}

export async function exportForkCatalog(
  bunRoot: string,
  options: { producerDocs?: string; consumerRoot?: string } = {},
): Promise<ForkCapabilityCatalog> {
  if (!isAbsolute(bunRoot)) throw new Error("Bun source must be an absolute checkout path");
  const root = realpathSync(bunRoot);
  const exporter = resolve(root, "scripts/aphrody/fork-capabilities.ts");
  if (!existsSync(exporter)) throw new Error("The selected Bun checkout lacks its capability exporter");
  const producerDocs = options.producerDocs
    ? newExternalDirectory(options.producerDocs, [root, ...(options.consumerRoot ? [options.consumerRoot] : [])])
    : undefined;
  const child = Bun.spawn(
    [process.execPath, exporter, "--root", root, ...(producerDocs ? ["--graph-docs", producerDocs] : [])],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 300_000);
  const drain = async (stream: ReadableStream<Uint8Array>, limit: number) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let output = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return output + decoder.decode();
        bytes += next.value.byteLength;
        if (bytes > limit) {
          child.kill("SIGKILL");
          throw new Error("Bun capability exporter exceeded its output budget");
        }
        output += decoder.decode(next.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(child.stdout, 16 * 1024 * 1024),
      drain(child.stderr, 4 * 1024 * 1024),
      child.exited,
    ]);
    if (timedOut) throw new Error("Bun capability exporter exceeded its 300-second deadline");
    if (exitCode !== 0) throw new Error(`Bun capability export failed (${exitCode}): ${stderr.trim()}`);
    return parseForkCapabilityCatalog(JSON.parse(stdout));
  } finally {
    clearTimeout(deadline);
  }
}

async function artifactHash(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}

export async function inspectNativeEngine() {
  const nie = await import("../../../packages/inagle/src/ffi/nie");
  const symbols = nie.getNativeLib();
  const path = nie.getNativeLibraryPath();
  if (!symbols || !path)
    return {
      status: "unavailable" as const,
      error: nie.getNativeLoadError() ?? "IECODE native library not found",
    };
  const build = nie.nieBuildInfo();
  const expectedOs =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform;
  const expectedArch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  if (
    !build ||
    build.product !== "iecode" ||
    build.abiVersion !== 1 ||
    build.targetOs !== expectedOs ||
    build.targetArch !== expectedArch
  )
    throw new Error("IECODE native build identity or ABI differs from the current host");
  const bytes = new TextEncoder().encode("123456789");
  const crc32 = Number(symbols.nie_crc32(ptr(bytes), BigInt(bytes.length)));
  if (crc32 !== 0xcbf43926) throw new Error("IECODE native CRC32 witness failed");
  const formats = nie.nieFormatCatalog();
  if (!formats.length || formats.length !== Number(symbols.nie_format_count()))
    throw new Error("IECODE native format catalog/count witness failed");
  return {
    status: "qualified" as const,
    path,
    sha256: await artifactHash(path),
    build,
    witness: { crc32, formatCount: formats.length },
  };
}

export async function inspectManagedNative(libraryPath?: string) {
  const { NativeDotnetBridge, findNativeLibrary } = await import("../../../packages/inagle/src/dotnet/native");
  const bridge = NativeDotnetBridge.tryLoad(libraryPath);
  if (!bridge)
    return {
      status: "unavailable" as const,
      path: libraryPath ?? findNativeLibrary(),
      error: "IECODE .NET NativeAOT library unavailable; no TypeScript fallback qualifies this gate",
    };
  if (bridge.status.mode !== "native-aot" || bridge.status.schema !== "iecode.ffi/v1")
    throw new Error("IECODE managed native schema witness failed");
  const crc32 = bridge.computeLevel5Crc32("123456789");
  if (crc32 !== 0xcbf43926) throw new Error("IECODE managed native CRC32 witness failed");
  return {
    status: "qualified" as const,
    ...bridge.status,
    sha256: await artifactHash(bridge.status.libraryPath!),
    witness: { crc32 },
  };
}

export async function exportNativeAlias(
  native: Awaited<ReturnType<typeof inspectNativeEngine>> | { status: "not-run" },
  outputDirectory: string,
  repositoryRoot: string,
) {
  if (native.status !== "qualified") throw new Error("A qualified IECODE native library is required before export");
  if (!isAbsolute(outputDirectory)) throw new Error("Native export directory must be absolute");
  const output = resolve(outputDirectory);
  const repoRelative = relative(realpathSync(repositoryRoot), output);
  if (!repoRelative || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative)))
    throw new Error("Native artifacts must be exported outside the source repository");
  if (existsSync(output)) throw new Error("Native export directory already exists");
  const fileName = process.platform === "win32" ? "ie.dll" : process.platform === "darwin" ? "ie.dylib" : "ie.so";
  const bytes = await Bun.file(native.path).bytes();
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (sha256 !== native.sha256) throw new Error("The qualified native artifact changed before export");
  mkdirSync(output);
  writeFileSync(resolve(output, fileName), bytes, { flag: "wx" });
  const provenance = {
    schemaVersion: 1,
    fileName,
    canonicalFileName: basename(native.path),
    sha256,
    build: native.build,
    witness: native.witness,
    aliasOfCanonicalLibrary: true,
    engineEmbeddedInNativeLibrary: false,
  };
  writeFileSync(resolve(output, "ie-native.json"), `${JSON.stringify(provenance, null, 2)}\n`, {
    flag: "wx",
  });
  return { path: resolve(output, fileName), ...provenance };
}

export async function qualifyForkRuntime(options: {
  iecodeRoot: string;
  catalog: ForkCapabilityCatalog;
  inspectModules?: boolean;
  inspectNative?: boolean;
  managedLibrary?: string;
}) {
  const catalog = parseForkCapabilityCatalog(options.catalog);
  const runtime = await checkBunRuntime(options.iecodeRoot);
  const modules = options.inspectModules ? await inspectForkModules(catalog) : [];
  const native = options.inspectNative ? await inspectNativeEngine() : { status: "not-run" as const };
  const managed = options.inspectNative
    ? await inspectManagedNative(options.managedLibrary)
    : { status: "not-run" as const };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime,
    sourceRevisionMatchesRuntime: runtime.revision === catalog.source.revision,
    catalog,
    qualification: {
      modules,
      native,
      managed,
      importableModules: modules.filter(entry => entry.status === "importable").length,
      unavailableModules: modules.filter(entry => entry.status === "unavailable").length,
      engineEmbeddedInNativeLibrary: false,
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "bun-source": { type: "string" },
      "bun-root": { type: "string" },
      "producer-docs": { type: "string" },
      catalog: { type: "string" },
      out: { type: "string" },
      modules: { type: "boolean", default: false },
      native: { type: "boolean", default: false },
      "require-native": { type: "boolean", default: false },
      "managed-library": { type: "string" },
      "native-export": { type: "string" },
      "graph-out": { type: "string" },
      "graph-source": { type: "string", multiple: true },
      "docs-out": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: bun scripts/iecode/tools/fork-runtime.ts (--bun-source ABSOLUTE_PATH | --catalog ABSOLUTE_JSON) [--producer-docs ABSOLUTE_NEW_DIRECTORY] [--modules] [--native] [--require-native] [--managed-library ABSOLUTE_PATH] [--native-export ABSOLUTE_NEW_DIRECTORY] [--graph-out ABSOLUTE_NEW_JSON] [--graph-source RELATIVE_NIE_OR_INAGLE_SOURCE] [--docs-out ABSOLUTE_NEW_DIRECTORY] [--out ABSOLUTE_NEW_JSON] (--bun-root remains an alias for --bun-source)",
    );
  } else {
    const source = selectForkCatalogSource(values);
    for (const path of [
      values.catalog,
      values.out,
      values["managed-library"],
      values["native-export"],
      values["graph-out"],
      values["docs-out"],
      source.producerDocs,
    ])
      if (path && !isAbsolute(path)) throw new Error("Catalog, artifact and receipt paths must be absolute");
    const iecodeRoot = resolve(import.meta.dir, "../../..");
    if (values["docs-out"])
      newExternalDirectory(values["docs-out"], [iecodeRoot, ...(source.bunSource ? [source.bunSource] : [])]);
    if (values["native-export"])
      newExternalDirectory(values["native-export"], [iecodeRoot, ...(source.bunSource ? [source.bunSource] : [])]);
    await checkBunRuntime(iecodeRoot);
    const catalog = source.bunSource
      ? await exportForkCatalog(source.bunSource, {
          producerDocs: source.producerDocs,
          consumerRoot: iecodeRoot,
        })
      : parseForkCapabilityCatalog(await Bun.file(values.catalog!).json());
    const qualification = await qualifyForkRuntime({
      iecodeRoot,
      catalog,
      inspectModules: values.modules,
      inspectNative: values.native || values["require-native"] || Boolean(values["native-export"]),
      managedLibrary: values["managed-library"],
    });
    const producer = source.bunSource
      ? {
          root: realpathSync(source.bunSource),
          exporter: realpathSync(resolve(source.bunSource, "scripts/aphrody/fork-capabilities.ts")),
          docs: source.producerDocs ?? null,
          evidence: source.producerDocs ? await Bun.file(resolve(source.producerDocs, "evidence.json")).json() : null,
        }
      : null;
    if (
      producer?.evidence &&
      (producer.evidence.schema !== "bun-fork-native-docs/1" ||
        producer.evidence.source?.revision !== catalog.source.revision ||
        producer.evidence.catalogSHA256 !==
          new Bun.CryptoHasher("sha256").update(JSON.stringify(catalog)).digest("hex"))
    )
      throw new Error("Bun graph/documentation evidence differs from the selected catalog");
    const receipt = { ...qualification, producer };
    const artifact = values["native-export"]
      ? await exportNativeAlias(receipt.qualification.native, values["native-export"], iecodeRoot)
      : null;
    const artifacts = [
      ...(receipt.qualification.native.status === "qualified"
        ? [
            {
              fileName: basename(receipt.qualification.native.path),
              sha256: receipt.qualification.native.sha256,
              abiVersion: receipt.qualification.native.build.abiVersion,
              aliasOfCanonicalLibrary: false,
            },
          ]
        : []),
      ...(receipt.qualification.managed.status === "qualified"
        ? [
            {
              fileName: basename(receipt.qualification.managed.libraryPath!),
              sha256: receipt.qualification.managed.sha256,
              abiVersion: 1,
              aliasOfCanonicalLibrary: false,
            },
          ]
        : []),
      ...(artifact
        ? [
            {
              fileName: artifact.fileName,
              sha256: artifact.sha256,
              abiVersion: artifact.build.abiVersion,
              aliasOfCanonicalLibrary: true,
            },
          ]
        : []),
    ];
    const files: { path: string; content: string }[] = [];
    for (const selected of values["graph-source"] ?? []) {
      if (!/^(?:crates\/nie\/|packages\/inagle\/).+\.(?:rs|tsx?)$/.test(selected) || selected.split("/").includes(".."))
        throw new Error("Select a portable NIE/Inagle source path for graph extraction");
      const path = realpathSync(resolve(iecodeRoot, selected));
      const actual = relative(realpathSync(iecodeRoot), path).replaceAll("\\", "/");
      if (!actual.startsWith("crates/nie/") && !actual.startsWith("packages/inagle/"))
        throw new Error("Selected graph source resolves outside its owning domain");
      const file = Bun.file(path);
      if (file.size > 1024 * 1024) throw new Error("Selected graph source exceeds its 1 MiB budget");
      files.push({ path: actual, content: await file.text() });
    }
    if (files.length && !values["graph-out"] && !values["docs-out"])
      throw new Error("Selected graph sources require --graph-out or --docs-out");
    let graph: Awaited<ReturnType<typeof buildForkCapabilityGraph>> | undefined;
    if (values["graph-out"] || values["docs-out"]) {
      const revision = Bun.spawnSync(["git", "-C", iecodeRoot, "rev-parse", "HEAD"]);
      if (revision.exitCode !== 0) throw new Error("Cannot establish IECODE source revision for graph provenance");
      graph = await buildForkCapabilityGraph(catalog, {
        files,
        artifacts,
        consumerRevision: revision.stdout.toString().trim(),
      });
      if (values["graph-out"])
        writeFileSync(values["graph-out"], `${JSON.stringify(graph, null, 2)}\n`, { flag: "wx" });
    }
    if (values["docs-out"]) {
      const output = resolve(values["docs-out"]);
      const repoRelative = relative(realpathSync(iecodeRoot), output);
      if (
        existsSync(output) ||
        !repoRelative ||
        (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))
      )
        throw new Error("Documentation output must be a new directory outside the source repository");
      const { exportDocsToDirectory } = await import("../../../packages/inagle/src/docs/index");
      await exportDocsToDirectory(output, {
        catalog,
        runtimeRevision: receipt.runtime.revision,
        modules: receipt.qualification.modules,
        artifacts,
        graph,
        producer,
      });
    }
    if (values.out) writeFileSync(values.out, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    console.log(
      JSON.stringify(
        {
          sourceRevision: catalog.source.revision,
          runtimeRevision: receipt.runtime.revision,
          sourceRevisionMatchesRuntime: receipt.sourceRevisionMatchesRuntime,
          coverage: catalog.coverage,
          importableModules: receipt.qualification.importableModules,
          unavailableModules: receipt.qualification.unavailableModules,
          native: receipt.qualification.native.status,
          managed: receipt.qualification.managed.status,
          artifact,
          graph: graph
            ? {
                source: graph.scope.source,
                profile: graph.scope.profile,
                nodes: graph.graph.nodes.length,
                links: graph.graph.links.length,
                sourceFiles: graph.sourceFiles.length,
                parseErrors: graph.extraction?.parseErrors.length ?? 0,
              }
            : null,
          documents: values["docs-out"] ?? null,
          producerDocuments: producer?.docs ?? null,
          receipt: values.out ?? null,
        },
        null,
        2,
      ),
    );
    if (
      values["require-native"] &&
      (receipt.qualification.native.status !== "qualified" || receipt.qualification.managed.status !== "qualified")
    )
      process.exitCode = 1;
  }
}
