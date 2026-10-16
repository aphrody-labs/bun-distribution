// SPDX-License-Identifier: Apache-2.0
/** Canonical documentation controller. Existing engines remain the owners of their algorithms. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  deriveStatus,
  domainOf,
  isGeneratedDocument,
  isNoticeFile,
  listRepositoryFiles,
  runDocsConsolidation,
  sha256Of,
  titleOf,
  type Status,
} from "./docs-consolidation.ts";
import { runDocsGen } from "./docs-gen.ts";
import { importedUpstreamMatcher, runDocsLinks } from "./docs-links.ts";
import { runDocsOverlaps } from "./docs-overlaps.ts";
import {
  generateSourceReference,
  type SourceReferenceTarget,
} from "./docs-source.ts";
import { exportDocumentationSite } from "./docs-site.ts";

export interface DocumentationConfig {
  schemaVersion: 1;
  owner: "@aphrody/workspace";
  visibility: "private";
  inventory: string;
  agentIndex: string;
  entrypoints: string[];
  sources: Array<SourceReferenceTarget & { root: string }>;
  site: { output: string; include: string[] };
}

export interface DocumentRecord {
  path: string;
  title: string;
  sha256: string;
  bytes: number;
  domain: string;
  status: Status;
  visibility: "private";
  canonical: string;
}

export interface DocumentationManifest {
  schemaVersion: 1;
  owner: "@aphrody/workspace";
  visibility: "private";
  documents: DocumentRecord[];
  duplicates: Array<{
    sha256: string;
    paths: string[];
    canonical: string;
    action: "retain";
  }>;
  sources: DocumentationConfig["sources"];
  excluded: Array<{ path: string; reason: string }>;
}

const CONFIG = "tools/config/docs/documentation.json";
const PRIVATE_CONTEXT =
  /(^|\/)(MEMORY|CONVERSATIONS|TRANSCRIPTS|LIVE)\.md$|(^|\/)(\.coord|\.git|node_modules|\.venv|target|privateMarkdown|private-markdown)(\/|$)/i;

/** Validate both the lexical path and every existing component, including symlinks. */
export function documentationPath(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw new Error(`Unsafe documentation path: ${path}`);
  const base = realpathSync(root);
  const target = resolve(base, path);
  for (let current = target; current !== base; current = dirname(current)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`Documentation symlink refused: ${path}`);
  }
  return target;
}

export function loadDocumentationConfig(root: string): DocumentationConfig {
  const config = JSON.parse(
    readFileSync(documentationPath(root, CONFIG), "utf8"),
  ) as DocumentationConfig;
  if (
    config.schemaVersion !== 1 ||
    config.owner !== "@aphrody/workspace" ||
    config.visibility !== "private"
  )
    throw new Error(
      "Documentation config requires schemaVersion 1, Workspace ownership and private visibility",
    );
  if (
    !Array.isArray(config.entrypoints) ||
    !Array.isArray(config.sources) ||
    !Array.isArray(config.site?.include)
  )
    throw new Error("Invalid documentation configuration");
  if (
    !/^docs\/reference\/workspace\/[a-zA-Z0-9_.-]+\.json$/.test(
      config.inventory,
    ) ||
    config.agentIndex !== "docs/llms.txt"
  )
    throw new Error(
      "Generated documentation destinations must stay in their owned docs paths",
    );
  for (const path of [
    config.inventory,
    config.agentIndex,
    ...config.entrypoints,
  ])
    documentationPath(root, path);
  // Sibling source roots are explicit read-only inputs, never import/publication destinations.
  const ids = new Set<string>();
  for (const source of config.sources) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id) || ids.has(source.id))
      throw new Error(
        `Duplicate or invalid documentation source id: ${source.id}`,
      );
    ids.add(source.id);
    if (![".", "../iecode"].includes(source.root))
      throw new Error(`Unmanaged source root: ${source.root}`);
  }
  return config;
}

const documentRank = (doc: DocumentRecord) =>
  (doc.status === "canonical" ? 0 : 10) +
  (/^(packages|crates|apps)\//.test(doc.path)
    ? 0
    : doc.path.startsWith("docs/")
      ? 1
      : 2);

export function buildDocumentationManifest(
  root: string,
  config: DocumentationConfig,
): DocumentationManifest {
  const imported = importedUpstreamMatcher(root);
  const paths = listRepositoryFiles(root, true)
    .files.filter(
      (path) => /\.(md|mdx)$/.test(path) && !PRIVATE_CONTEXT.test(path),
    )
    .toSorted();
  const documents: DocumentRecord[] = [];
  const excluded: DocumentationManifest["excluded"] = [];
  for (const path of paths) {
    let absolute: string;
    try {
      absolute = documentationPath(root, path);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("Documentation symlink refused:")
      )
        throw error;
      excluded.push({
        path,
        reason: "symlink alias inventoried without following its content",
      });
      continue;
    }
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
    const text = readFileSync(absolute, "utf8");
    const upstream =
      !!imported(path) ||
      /(^|\/)(upstream[^/]*|third_party|third-party|vendor)(\/|$)/.test(path);
    const history =
      /^docs\/(migration|history)\//.test(path) ||
      /\/(archive|historical)\//.test(path);
    const status = history
      ? "historical"
      : deriveStatus({
          path,
          text,
          imported: upstream,
          generated: isGeneratedDocument(path, text),
          notice: isNoticeFile(path),
        });
    documents.push({
      path,
      title: titleOf(text, path),
      sha256: sha256Of(text),
      bytes: Buffer.byteLength(text),
      domain: domainOf(path).domain,
      status,
      visibility: "private",
      canonical: path,
    });
  }
  const groups = new Map<string, DocumentRecord[]>();
  for (const doc of documents) {
    const group = groups.get(doc.sha256) ?? [];
    group.push(doc);
    groups.set(doc.sha256, group);
  }
  const duplicates: DocumentationManifest["duplicates"] = [];
  for (const [sha256, group] of groups) {
    if (group.length < 2) continue;
    // This is an authority alias, not permission to remove runtime templates or notices.
    const ranked = [...group].toSorted(
      (a, b) =>
        documentRank(a) - documentRank(b) || a.path.localeCompare(b.path),
    );
    const canonical = ranked[0]!.path;
    for (const doc of group) doc.canonical = canonical;
    duplicates.push({
      sha256,
      paths: group.map((doc) => doc.path),
      canonical,
      action: "retain",
    });
  }
  duplicates.sort((a, b) => a.canonical.localeCompare(b.canonical));
  return {
    schemaVersion: 1,
    owner: "@aphrody/workspace",
    visibility: "private",
    documents,
    duplicates,
    sources: config.sources,
    excluded,
  };
}

export function renderDocumentationAgentIndex(
  manifest: DocumentationManifest,
  config: DocumentationConfig,
): string {
  const selected = [
    ...config.entrypoints,
    ...config.sources.map((target) => `docs/apis/generated/${target.id}.md`),
  ];
  const byPath = new Map(manifest.documents.map((doc) => [doc.path, doc]));
  const lines = [
    "# Aphrody documentation",
    "",
    "> Private developer documentation. Markdown is the source of truth; generated references carry source provenance.",
    "",
    "Use the repository rules and active plan before changing code. Generated references describe declarations, not deployment health.",
    "",
    "## Documentation",
  ];
  for (const path of selected) {
    const doc = byPath.get(path);
    if (!doc)
      throw new Error(
        `Configured documentation entrypoint is missing: ${path}`,
      );
    const href = relative(dirname(config.agentIndex), path).replaceAll(
      sep,
      "/",
    );
    lines.push(
      `- [${doc.title.replaceAll("[", "").replaceAll("]", "")}](<${href}>): ${doc.status}, ${doc.domain}.`,
    );
  }
  lines.push(
    "",
    "## Optional",
    "",
    `- [Complete provenance inventory](<${relative(dirname(config.agentIndex), config.inventory).replaceAll(sep, "/")}>): paths, SHA-256, classifications and duplicate aliases.`,
    "",
  );
  return lines.join("\n");
}

function generatedOutput(
  root: string,
  path: string,
  text: string,
  check: boolean,
): boolean {
  const target = documentationPath(root, path);
  const same = existsSync(target) && readFileSync(target, "utf8") === text;
  if (same) return true;
  if (check) {
    console.error(`stale ${path}`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return true;
}

export async function generateDocumentation(
  root: string,
  config: DocumentationConfig,
  check: boolean,
  extra: string[] = [],
): Promise<number> {
  let failures = 0;
  for (const target of config.sources) {
    // Sibling repositories (../iecode) are not checked out on every host.
    if (!existsSync(resolve(root, target.root))) {
      console.warn(
        `docs: skipped ${target.root}: repository not present on this host`,
      );
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- sources traitées séquentiellement : les sorties générées sont écrites dans l'ordre de configuration
    const outputs = await generateSourceReference(resolve(root, target.root), [
      target,
    ]);
    for (const [path, text] of outputs)
      if (!generatedOutput(root, path, text, check)) failures++;
  }
  // The existing documentation index counts files. Materialize new views before
  // it runs, then refresh their hashes after its generated pages are current.
  if (!check) {
    const initial = buildDocumentationManifest(root, config);
    generatedOutput(
      root,
      config.inventory,
      `${JSON.stringify(initial, null, 2)}\n`,
      false,
    );
    generatedOutput(
      root,
      config.agentIndex,
      renderDocumentationAgentIndex(initial, config),
      false,
    );
  }
  failures += await runDocsGen([
    "--root",
    root,
    ...(check ? ["--check"] : []),
    ...extra,
  ]);
  const manifest = buildDocumentationManifest(root, config);
  if (
    !generatedOutput(
      root,
      config.inventory,
      `${JSON.stringify(manifest, null, 2)}\n`,
      check,
    )
  )
    failures++;
  if (
    !generatedOutput(
      root,
      config.agentIndex,
      renderDocumentationAgentIndex(manifest, config),
      check,
    )
  )
    failures++;
  console.log(
    `documentation: ${manifest.documents.length} documents, ${manifest.duplicates.length} exact duplicate groups retained, ${failures} failure(s)`,
  );
  return failures ? 1 : 0;
}

export async function runDocumentation(argv: string[]): Promise<number> {
  const args = [...argv];
  const rootIndex = args.indexOf("--root");
  let root = process.cwd();
  if (rootIndex >= 0) {
    const value = args[rootIndex + 1];
    if (!value || value.startsWith("--"))
      throw new Error("--root requires a path");
    root = resolve(value);
    args.splice(rootIndex, 2);
  }
  root = resolve(root);
  const [command = "status", ...rest] = args;
  if (["--help", "-h", "help"].includes(command)) {
    console.log(
      "Usage: yolo ops docs <status|generate|check|audit|links|overlaps|consolidate|site|ai> [--root <repository>]\ngenerate: --check --deps --skip-ecosystem; site: --output <directory>; audit: --json; ai: translate <file> [language] --apply --online",
    );
    return 0;
  }
  if (
    (command === "generate" || command === "check") &&
    rest.some((arg) => arg === "--help" || arg === "-h")
  ) {
    console.log(
      `Usage: yolo ops docs ${command} [--root <repository>] [--check] [--deps] [--skip-ecosystem]`,
    );
    return 0;
  }
  if (command === "links")
    return runDocsLinks(["--root", root, "--scope", "repository", ...rest]);
  if (command === "overlaps") return runDocsOverlaps(["--root", root, ...rest]);
  if (command === "consolidate")
    return runDocsConsolidation([
      ...rest,
      ...(!rest.includes("--scope") ? ["--scope", "all"] : []),
      "--root",
      root,
    ]);
  const config = loadDocumentationConfig(root);
  if (command === "generate" || command === "check") {
    if (
      rest.some(
        (arg) => !["--check", "--deps", "--skip-ecosystem"].includes(arg),
      )
    )
      throw new Error("Unknown documentation generation argument");
    return generateDocumentation(
      root,
      config,
      command === "check" || rest.includes("--check"),
      rest.filter((arg) => arg !== "--check"),
    );
  }
  const manifest = buildDocumentationManifest(root, config);
  if (command === "status" || command === "audit") {
    if (rest.some((arg) => arg !== "--json"))
      throw new Error("Unknown documentation audit argument");
    console.log(
      JSON.stringify(
        rest.includes("--json")
          ? manifest
          : {
              owner: manifest.owner,
              visibility: manifest.visibility,
              documents: manifest.documents.length,
              duplicates: manifest.duplicates.length,
              statuses: Object.fromEntries(
                [...new Set(manifest.documents.map((doc) => doc.status))]
                  .toSorted()
                  .map((status) => [
                    status,
                    manifest.documents.filter((doc) => doc.status === status)
                      .length,
                  ]),
              ),
            },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "site") {
    if (
      rest.length &&
      (rest.length !== 2 ||
        rest[0] !== "--output" ||
        !rest[1] ||
        rest[1].startsWith("--"))
    )
      throw new Error("site accepts --output <directory>");
    const includes = config.site.include.map(
      (pattern) => new Bun.Glob(pattern),
    );
    const pages = manifest.documents.filter(
      (doc) =>
        includes.some((pattern) => pattern.match(doc.path)) &&
        doc.canonical === doc.path &&
        ["canonical", "generated"].includes(doc.status),
    );
    if (!pages.length)
      throw new Error(
        "No eligible documents in the explicit private site allowlist",
      );
    console.log(
      JSON.stringify(
        await exportDocumentationSite(
          root,
          pages,
          resolve(root, rest[1] ?? config.site.output),
        ),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "ai") {
    const apply = rest.includes("--apply");
    const online = rest.includes("--online");
    const invocation = rest.filter(
      (arg) => arg !== "--apply" && arg !== "--online",
    );
    const [operation, path, language] = invocation;
    if (operation !== "translate" || !path || invocation.length > 3)
      throw new Error(
        "ai accepts translate <file> [language] --apply --online",
      );
    const doc = manifest.documents.find((entry) => entry.path === path);
    if (
      !doc ||
      doc.status !== "canonical" ||
      !config.entrypoints.includes(path)
    )
      throw new Error(
        "AI input must be an explicitly configured canonical documentation entrypoint",
      );
    if (!apply || !online) {
      console.log(
        `plan: translate ${path} to ${language ?? "fr"}; execution requires --apply --online`,
      );
      return 0;
    }
    const child = Bun.spawn(
      [
        process.execPath,
        join(root, "packages/engine/yolo/src/index.ts"),
        "doc-ai",
        "translate",
        documentationPath(root, path),
        language ?? "fr",
      ],
      {
        windowsHide: true,
        cwd: root,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, DOC_AI_REQUIRE_ONLINE: "1" },
      },
    );
    return child.exited;
  }
  // Compatibility adapter: an explicit invocation retains doc-ai's original arguments.
  if (command === "assist") {
    const child = Bun.spawn(
      [
        process.execPath,
        join(root, "packages/engine/yolo/src/index.ts"),
        "doc-ai",
        ...rest,
      ],
      {
        windowsHide: true,
        cwd: root,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    return child.exited;
  }
  throw new Error(`Unknown documentation command: ${command}`);
}
