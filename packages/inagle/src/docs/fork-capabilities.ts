import type {
  ForkCapabilityCatalog,
  ForkGraphArtifact,
  ForkModuleEvidence,
  buildForkCapabilityGraph,
} from "../ffi/fork-runtime";

export interface ForkDocumentation {
  catalog: ForkCapabilityCatalog;
  runtimeRevision?: string;
  modules?: ForkModuleEvidence[];
  artifacts?: ForkGraphArtifact[];
  graph?: Awaited<ReturnType<typeof buildForkCapabilityGraph>>;
  producer?: {
    root: string;
    exporter: string;
    docs: string | null;
    evidence: unknown;
  } | null;
}

function cell(value: unknown): string {
  return String(value ?? "unversioned")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]/g, " ");
}

export function generateForkCapabilitiesMarkdown(document: ForkDocumentation): string {
  const { catalog } = document;
  const moduleEvidence = new Map((document.modules ?? []).map(entry => [entry.name, entry.status]));
  const sections = [
    "# Aphrody Bun capabilities in IECODE",
    `Producer source revision: ${catalog.source.revision}. Upstream baseline: ${catalog.source.mergeBase}.`,
    `Qualified runtime revision: ${document.runtimeRevision ?? "not supplied"}. Source and runtime revisions match: ${document.runtimeRevision === catalog.source.revision}.`,
    "Source inventory records availability in the producer checkout. Importability establishes module loading only. Native artifacts require separate ABI and operation witnesses. Bun is hosted by the qualified executable; it is not embedded into the NIE shared library.",
    "Inagle delegates .NET 10 assembly objects to loadForkDotnetAssembly, native CPython to openForkPython, and code graphs to executeForkGraph/buildForkCapabilityGraph. NIE Rust and managed IECODE retain their existing C ABI adapters.",
    "## Modules\n\n| Module | Source | SHA256 | Evidence |\n| --- | --- | --- | --- |\n" +
      catalog.modules
        .map(
          entry =>
            `| ${cell(entry.name)} | ${cell(entry.source)} | ${entry.sha256} | ${moduleEvidence.get(entry.name) ?? "source-only"} |`,
        )
        .join("\n"),
    "## Producer packages\n\n| Package | Version | Manifest | SHA256 |\n| --- | --- | --- | --- |\n" +
      catalog.packages
        .map(entry => `| ${cell(entry.name)} | ${cell(entry.version)} | ${cell(entry.manifest)} | ${entry.sha256} |`)
        .join("\n"),
    "## Native crate producers\n\n| Crate | Manifest | Crate types | SHA256 |\n| --- | --- | --- | --- |\n" +
      catalog.nativeCrates
        .map(
          entry =>
            `| ${cell(entry.name)} | ${cell(entry.manifest)} | ${cell(entry.crateTypes.join(", "))} | ${entry.sha256} |`,
        )
        .join("\n"),
    "## Fork source delta\n\n| Status | Source path |\n| --- | --- |\n" +
      catalog.sourceDelta.map(entry => `| ${cell(entry.status)} | ${cell(entry.path)} |`).join("\n"),
    "## Native artifact witnesses\n\n| Artifact | SHA256 | ABI | Alias |\n| --- | --- | --- | --- |\n" +
      (document.artifacts ?? [])
        .map(
          entry =>
            `| ${cell(entry.fileName)} | ${entry.sha256} | ${entry.abiVersion} | ${entry.aliasOfCanonicalLibrary} |`,
        )
        .join("\n"),
  ];
  if (document.graph) {
    sections.push(
      `## Native code graph\n\nScope: ${document.graph.scope.source}, profile ${document.graph.scope.profile}. Inventory edges carry INFERRED confidence and describe metadata; selected NIE/Inagle AST relationships retain native extractor confidence. Selected source files: ${document.graph.sourceFiles.length}. Parse errors: ${document.graph.extraction?.parseErrors.length ?? 0}. Provider authentication, conversations and raw sessions are excluded.`,
    );
  }
  if (document.producer?.docs) {
    sections.push(
      `## Bun producer graph and documentation\n\nThe same IECODE command delegates native Bun indexing and immutable documentation to the selected producer exporter. Checkout: ${cell(document.producer.root)}. Exporter: ${cell(document.producer.exporter)}. Native graph snapshots and documentation: ${cell(document.producer.docs)}. The linked evidence.json retains source hashes, runtime provenance, extraction coverage and domain results. Its catalog hash and source revision are checked before IECODE accepts it.`,
    );
  }
  return sections.join("\n\n") + "\n";
}

export function generateForkCapabilityArtifacts(document: ForkDocumentation): Record<string, string> {
  return {
    "FORK-CAPABILITIES.md": generateForkCapabilitiesMarkdown(document),
    "FORK-CAPABILITIES.json": JSON.stringify(document, null, 2) + "\n",
    ...(document.graph ? { "FORK-GRAPH.json": JSON.stringify(document.graph, null, 2) + "\n" } : {}),
  };
}
