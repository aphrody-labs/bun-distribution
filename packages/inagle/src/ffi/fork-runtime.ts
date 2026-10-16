import type { Python } from "bun:python";

export type ForkDotnetFramework = "net10.0" | "net9.0" | "net8.0" | "net472";
export interface ForkDotnetHost {
  load(assembly: string): void;
  [namespace: string]: unknown;
}
export interface ForkGraphRequest {
  op: "build" | "query" | "path" | "explain" | "analyze" | "export";
  scope: { source: `graph:${string}`; profile: string };
  [field: string]: unknown;
}
export interface ForkGraphResponse<T = unknown> {
  scope: ForkGraphRequest["scope"];
  result: T;
}

export interface ForkGraphDocument {
  nodes: {
    id: string;
    label: string;
    file_type?: "code" | "concept";
    source_file?: string | null;
    package?: string | null;
  }[];
  links: {
    source: string;
    target: string;
    relation: string;
    confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
    confidence_score?: number;
    source_file?: string | null;
    context?: string | null;
  }[];
  root?: string | null;
  built_at_commit?: string | null;
}

export interface ForkGraphArtifact {
  fileName: string;
  sha256: string;
  abiVersion: number;
  aliasOfCanonicalLibrary: boolean;
}

export interface ForkCapabilityCatalog {
  schemaVersion: 1;
  repository: "aphrody-labs/bun";
  source: {
    revision: string;
    upstreamRevision: string;
    mergeBase: string;
    dirty: boolean;
    trackedFileCount: number;
  };
  modules: { name: string; source: string; sha256: string; forkOnly?: boolean }[];
  packages: {
    name: string;
    version: string | null;
    manifest: string;
    sha256: string;
    exports?: unknown;
    os?: string[];
    cpu?: string[];
  }[];
  nativeCrates: { name: string; manifest: string; sha256: string; crateTypes: string[] }[];
  sourceDelta: { status: string; path: string }[];
  coverage: { modules: number; packages: number; nativeCrates: number; sourceDelta: number };
}

export interface ForkModuleEvidence {
  name: string;
  status: "importable" | "unavailable";
  exports?: string[];
  error?: string;
}

type ModuleImporter = (name: string) => Promise<Record<string, unknown>>;
const importModule: ModuleImporter = (name) => import(name);

async function probeModule(name: string): Promise<Record<string, unknown>> {
  const source = `try { const loaded = await import(${JSON.stringify(name)}); console.log(JSON.stringify(Object.keys(loaded).sort())); process.exit(0); } catch(error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }`;
  const child = Bun.spawn([process.execPath, "-e", source], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(
      `Module import failed (exit ${exitCode}): ${stderr.trim() || "native process failed or timed out"}`,
    );
  const exports: unknown = JSON.parse(stdout);
  if (!Array.isArray(exports) || exports.some((value) => typeof value !== "string"))
    throw new Error("Module import produced an invalid export inventory");
  return Object.fromEntries(exports.map((name) => [name, true]));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid fork capability catalog: ${label}`);
  return value as Record<string, unknown>;
}

function sourcePath(value: unknown): void {
  if (
    typeof value !== "string" ||
    !value ||
    /^[a-z]:|^[\\/]|\\|:|(?:^|\/)\.\.?(?:\/|$)/i.test(value)
  )
    throw new Error("Invalid fork capability catalog: nonportable source path");
}

function hash(value: unknown, length: number): void {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value))
    throw new Error("Invalid fork capability catalog: provenance hash");
}

export function parseForkCapabilityCatalog(value: unknown): ForkCapabilityCatalog {
  const catalog = record(value, "root");
  if (catalog.schemaVersion !== 1 || catalog.repository !== "aphrody-labs/bun")
    throw new Error("Unsupported fork capability catalog");
  const source = record(catalog.source, "source");
  for (const key of ["revision", "upstreamRevision", "mergeBase"]) hash(source[key], 40);
  if (
    typeof source.dirty !== "boolean" ||
    !Number.isSafeInteger(source.trackedFileCount) ||
    Number(source.trackedFileCount) < 0
  )
    throw new Error("Invalid fork capability catalog: source evidence");
  const coverage = record(catalog.coverage, "coverage");
  for (const section of ["modules", "packages", "nativeCrates", "sourceDelta"] as const) {
    const entries = catalog[section];
    if (!Array.isArray(entries) || coverage[section] !== entries.length)
      throw new Error(`Fork capability coverage mismatch: ${section}`);
    const names = new Set<string>();
    for (const value of entries) {
      const entry = record(value, section);
      if (section === "sourceDelta") {
        if (typeof entry.status !== "string" || !/^[A-Z? ][A-Z? ]?$/.test(entry.status))
          throw new Error("Invalid fork capability catalog: source delta status");
        sourcePath(entry.path);
        if (names.has(String(entry.path))) throw new Error("Duplicate fork source delta path");
        names.add(String(entry.path));
        continue;
      }
      if (
        typeof entry.name !== "string" ||
        (section === "modules"
          ? !/^bun:[a-z0-9_./-]+$/.test(entry.name)
          : section === "packages"
            ? !/^@aphrody\/[a-z0-9_.-]+$/.test(entry.name)
            : !/^[a-z0-9_.-]+$/.test(entry.name))
      )
        throw new Error(`Invalid fork capability catalog: ${section} name`);
      if (names.has(entry.name)) throw new Error(`Duplicate fork capability: ${entry.name}`);
      names.add(entry.name);
      sourcePath(section === "modules" ? entry.source : entry.manifest);
      hash(entry.sha256, 64);
      if (
        section === "modules" &&
        entry.forkOnly !== undefined &&
        typeof entry.forkOnly !== "boolean"
      )
        throw new Error("Invalid fork capability catalog: fork module classification");
      if (section === "packages") {
        if (entry.version !== null && (typeof entry.version !== "string" || !entry.version))
          throw new Error("Invalid fork capability catalog: package version");
        for (const field of ["os", "cpu"])
          if (
            entry[field] !== undefined &&
            (!Array.isArray(entry[field]) || entry[field].some((item) => typeof item !== "string"))
          )
            throw new Error(`Invalid fork capability catalog: package ${field}`);
      }
      if (
        section === "nativeCrates" &&
        (!Array.isArray(entry.crateTypes) ||
          entry.crateTypes.some((item) => typeof item !== "string"))
      )
        throw new Error("Invalid fork capability catalog: native crate types");
    }
  }
  return catalog as unknown as ForkCapabilityCatalog;
}

export async function importForkModule<T = Record<string, unknown>>(
  catalog: ForkCapabilityCatalog,
  name: string,
): Promise<T> {
  parseForkCapabilityCatalog(catalog);
  if (!catalog.modules.some((entry) => entry.name === name))
    throw new Error(`Module is absent from the Bun producer catalog: ${name}`);
  return (await importModule(name)) as T;
}

export async function inspectForkModules(
  catalog: ForkCapabilityCatalog,
  importer: ModuleImporter = probeModule,
): Promise<ForkModuleEvidence[]> {
  parseForkCapabilityCatalog(catalog);
  const evidence: ForkModuleEvidence[] = [];
  // A separate process contains native loader crashes and runtime registration.
  for (const entry of catalog.modules) {
    try {
      const loaded = await importer(entry.name);
      evidence.push({
        name: entry.name,
        status: "importable",
        exports: Object.keys(loaded).sort(),
      });
    } catch (error) {
      evidence.push({
        name: entry.name,
        status: "unavailable",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return evidence;
}

export async function loadForkDotnetAssembly(
  catalog: ForkCapabilityCatalog,
  assembly: string,
  framework: ForkDotnetFramework = "net10.0",
): Promise<ForkDotnetHost> {
  const dotnet = await importForkModule<{
    load(assembly: string, framework: ForkDotnetFramework): ForkDotnetHost;
  }>(catalog, "bun:dotnet");
  return dotnet.load(assembly, framework);
}

export async function openForkPython(
  catalog: ForkCapabilityCatalog,
  options?: Parameters<typeof import("bun:python").Python.open>[0],
): Promise<Python> {
  const python = await importForkModule<typeof import("bun:python")>(catalog, "bun:python");
  return python.Python.open(options);
}

export async function executeForkGraph<T = unknown>(
  catalog: ForkCapabilityCatalog,
  request: ForkGraphRequest,
  options?: { signal?: AbortSignal },
): Promise<ForkGraphResponse<T>> {
  const graph = await importForkModule<{
    executeGraph(
      request: ForkGraphRequest,
      options?: { signal?: AbortSignal },
    ): Promise<ForkGraphResponse<T>>;
  }>(catalog, "bun:graph-native");
  return graph.executeGraph(request, options);
}

export async function buildForkCapabilityGraph(
  catalog: ForkCapabilityCatalog,
  options: {
    files?: { path: string; content: string }[];
    consumerRevision?: string;
    artifacts?: ForkGraphArtifact[];
    signal?: AbortSignal;
  } = {},
) {
  parseForkCapabilityCatalog(catalog);
  if (options.consumerRevision !== undefined) hash(options.consumerRevision, 40);
  const scope = { source: "graph:iecode-bun-fork" as const, profile: "ie" };
  const root = `bun-catalog:${catalog.source.revision}`;
  const graph: ForkGraphDocument = {
    nodes: [
      {
        id: root,
        label: `Aphrody Bun source catalog ${catalog.source.revision}`,
        file_type: "concept",
      },
    ],
    links: [],
    root: null,
    built_at_commit: null,
  };
  function metadata(kind: string, name: string, source?: string) {
    const id = `${root}:${kind}:${name}`;
    graph.nodes.push({ id, label: name, file_type: "concept", source_file: source ?? null });
    graph.links.push({
      source: root,
      target: id,
      relation: `catalog_${kind}`,
      confidence: "INFERRED",
      confidence_score: 1,
      source_file: source ?? null,
      context:
        "Producer inventory metadata; this edge is not an extracted AST call or runtime qualification.",
    });
  }
  for (const entry of catalog.modules) metadata("module", entry.name, entry.source);
  for (const entry of catalog.packages)
    metadata("package", `${entry.name}@${entry.version ?? "unversioned"}`, entry.manifest);
  for (const entry of catalog.nativeCrates) metadata("native_crate", entry.name, entry.manifest);
  for (const entry of catalog.sourceDelta)
    metadata("source_delta", `${entry.status} ${entry.path}`, entry.path);
  for (const entry of options.artifacts ?? []) {
    sourcePath(entry.fileName);
    hash(entry.sha256, 64);
    if (
      !Number.isSafeInteger(entry.abiVersion) ||
      entry.abiVersion < 1 ||
      typeof entry.aliasOfCanonicalLibrary !== "boolean"
    )
      throw new Error("Invalid qualified native artifact graph evidence");
    metadata(
      "artifact_witness",
      `${entry.fileName} sha256:${entry.sha256} ABI:${entry.abiVersion}`,
    );
  }
  const files = options.files ?? [];
  const paths = new Set<string>();
  for (const file of files) {
    sourcePath(file.path);
    if (
      !/^(?:crates\/nie\/|packages\/inagle\/).+\.(?:rs|tsx?)$/.test(file.path) ||
      typeof file.content !== "string"
    )
      throw new Error(
        "Graph extraction accepts selected NIE Rust and Inagle TypeScript source only",
      );
    if (paths.has(file.path)) throw new Error("Duplicate selected graph source");
    paths.add(file.path);
  }
  let extraction: {
    graph: ForkGraphDocument;
    stats: unknown;
    parse_errors: { path: string; error: string }[];
  } | null = null;
  if (files.length) {
    const response = await executeForkGraph<{
      graph: ForkGraphDocument;
      stats: unknown;
      parse_errors: { path: string; error: string }[];
    }>(
      catalog,
      {
        op: "build",
        scope,
        files,
        built_at_commit: options.consumerRevision ?? null,
        limits: {
          max_files: files.length,
          max_source_bytes: 32 * 1024 * 1024,
          max_nodes: 100_000,
          max_edges: 500_000,
          max_output_bytes: 32 * 1024 * 1024,
        },
      },
      { signal: options.signal },
    );
    extraction = response.result;
    if (
      !extraction?.graph ||
      !Array.isArray(extraction.graph.nodes) ||
      !Array.isArray(extraction.graph.links)
    )
      throw new Error("Native graph extraction returned invalid evidence");
    graph.nodes.push(...extraction.graph.nodes);
    graph.links.push(...extraction.graph.links);
  }
  const response = await executeForkGraph<{ graph: ForkGraphDocument }>(
    catalog,
    {
      op: "export",
      scope,
      graph,
      limits: {
        max_nodes: Math.max(100_000, graph.nodes.length),
        max_edges: Math.max(500_000, graph.links.length),
        max_output_bytes: 64 * 1024 * 1024,
      },
    },
    { signal: options.signal },
  );
  return {
    schemaVersion: 1,
    scope,
    producerRevision: catalog.source.revision,
    consumerRevision: options.consumerRevision ?? null,
    coverage: catalog.coverage,
    graph: response.result.graph,
    extraction: extraction
      ? { stats: extraction.stats, parseErrors: extraction.parse_errors }
      : null,
    sourceFiles: files.map((file) => ({
      path: file.path,
      sha256: new Bun.CryptoHasher("sha256").update(file.content).digest("hex"),
    })),
    artifacts: options.artifacts ?? [],
    metadataConfidence: "INFERRED" as const,
  };
}
