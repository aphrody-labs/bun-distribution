// SPDX-License-Identifier: Apache-2.0
/**
 * AST inventory for Bun workspaces. Knip remains the reachability/dead-code authority;
 * this script records source-level module edges and exports without regex heuristics.
 *
 * Usage: bun run scripts/scan-imports-exports.ts [--workspace <name-or-path>] [--json]
 */
import * as ts from "@typescript/typescript6";
import { dirname, join, relative, resolve, sep } from "node:path";

interface WorkspaceManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[];
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

interface ModuleReference {
  sourceFile: string;
  specifier: string;
  packageName: string | null;
  resolution:
    "builtin" | "workspace-source" | "installed-package" | "unresolved";
  resolvedPath?: string;
  kind:
    | "import"
    | "re-export"
    | "dynamic-import"
    | "require"
    | "import-type"
    | "reference-type";
  typeOnly: boolean;
  line: number;
}

interface SourceFileAudit {
  path: string;
  imports: ModuleReference[];
  exports: string[];
}

interface PackageAudit {
  path: string;
  name: string;
  workspaceRoot: string;
  version?: string;
  entries: string[];
  sourceFiles: number;
  imports: ModuleReference[];
  exportsByFile: Record<string, string[]>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  sourceUnmatchedDependencies: string[];
  unlistedExternalImports: string[];
}

interface AuditSummary {
  root: string;
  packages: PackageAudit[];
  packageCount: number;
  sourceFileCount: number;
  importCount: number;
  externalPackages: string[];
  versionSpecDifferences: Record<string, Record<string, string>>;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".turbo",
  ".next",
  ".next-build",
  ".output",
  ".cache",
  "node_modules",
  "dist",
  "target",
  "coverage",
  "vendor",
]);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "os",
  "path",
  "process",
  "stream",
  "timers",
  "url",
  "util",
  "v8",
  "worker_threads",
]);

function workspacePatterns(manifest: WorkspaceManifest): string[] {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return manifest.workspaces?.packages ?? [];
}

function packageName(specifier: string): string | null {
  const value = specifier.trim();
  if (
    !value ||
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("@/")
  )
    return null;
  if (
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    BUILTINS.has(value) ||
    BUILTINS.has(value.split("/")[0] ?? "")
  )
    return null;
  if (value.startsWith("@")) {
    const [scope, name] = value.split("/");
    return name ? `${scope}/${name}` : null;
  }
  return value.split("/")[0] || null;
}

function workspaceContains(
  root: string,
  patterns: string[],
  packageDir: string,
): boolean {
  const rel = relative(root, packageDir).split(sep).join("/");
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("/"))
    return false;
  let included = rel === ".";
  for (const entry of patterns) {
    const negated = entry.startsWith("!");
    const pattern = (negated ? entry.slice(1) : entry).replace(/\/$/, "");
    if (new Bun.Glob(pattern).match(rel)) included = !negated;
  }
  return included;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T;
  } catch {
    return null;
  }
}

async function packageManifests(
  root: string,
): Promise<Array<{ path: string; manifest: WorkspaceManifest }>> {
  const manifests: Array<{ path: string; manifest: WorkspaceManifest }> = [];
  const glob = new Bun.Glob("**/package.json");
  for await (const file of glob.scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (file.split("/").some((segment) => IGNORED_DIRS.has(segment))) continue;
    const path = resolve(root, file);
    const manifest = await readJson<WorkspaceManifest>(path);
    if (manifest) manifests.push({ path, manifest });
  }
  return manifests;
}

async function activeWorkspacePackages(
  root: string,
): Promise<
  Array<{ path: string; manifest: WorkspaceManifest; workspaceRoot: string }>
> {
  const manifests = await packageManifests(root);
  const rootManifest = manifests.find(
    ({ path }) => resolve(path) === resolve(root, "package.json"),
  );
  if (!rootManifest) throw new Error(`Missing root package.json at ${root}`);
  const nestedRoots = manifests.filter(
    ({ path, manifest }) =>
      path !== rootManifest.path && workspacePatterns(manifest).length > 0,
  );
  const roots = [
    {
      path: root,
      patterns: workspacePatterns(rootManifest.manifest),
      name: rootManifest.manifest.name ?? ".",
    },
    ...nestedRoots.map(({ path, manifest }) => ({
      path: dirname(path),
      patterns: workspacePatterns(manifest),
      name: manifest.name ?? relative(root, dirname(path)),
    })),
  ];

  const found = new Map<
    string,
    { path: string; manifest: WorkspaceManifest; workspaceRoot: string }
  >();
  found.set(rootManifest.path, { ...rootManifest, workspaceRoot: "." });
  for (const item of manifests) {
    if (item.path === rootManifest.path) continue;
    const dir = dirname(item.path);
    const memberships = roots
      .filter((workspace) =>
        workspaceContains(workspace.path, workspace.patterns, dir),
      )
      .toSorted((a, b) => b.path.length - a.path.length);
    const owner = memberships[0];
    if (owner)
      found.set(item.path, {
        ...item,
        workspaceRoot: relative(root, owner.path) || ".",
      });
  }
  return [...found.values()].toSorted((a, b) => a.path.localeCompare(b.path));
}

function externalModuleName(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function parseSource(
  path: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  packageDir: string,
): SourceFileAudit {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const scriptKind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".jsx"
        ? ts.ScriptKind.JSX
        : [".js", ".mjs", ".cjs"].includes(ext)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const imports: ModuleReference[] = [];
  const exports = new Set<string>();
  const addImport = (
    specifier: string | null,
    kind: ModuleReference["kind"],
    typeOnly: boolean,
    pos: number,
  ) => {
    if (!specifier) return;
    const externalName = packageName(specifier);
    const resolution =
      externalName === null
        ? specifier.startsWith(".") ||
          specifier.startsWith("/") ||
          specifier.startsWith("@/") ||
          specifier.startsWith("#")
          ? "unresolved"
          : "builtin"
        : "unresolved";
    const resolvedPath = ts.resolveModuleName(
      specifier,
      path,
      compilerOptions,
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    const normalizedResolved = resolvedPath?.replaceAll("\\", "/");
    const isWorkspaceSource = Boolean(
      normalizedResolved &&
      !normalizedResolved.includes("/node_modules/") &&
      (normalizedResolved === packageDir ||
        normalizedResolved.startsWith(`${packageDir}/`)),
    );
    imports.push({
      sourceFile: path,
      specifier,
      packageName: externalName,
      resolution: isWorkspaceSource
        ? "workspace-source"
        : resolvedPath
          ? "installed-package"
          : resolution,
      resolvedPath,
      kind,
      typeOnly,
      line: source.getLineAndCharacterOfPosition(Math.max(0, pos)).line + 1,
    });
  };
  const addBindingNames = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) exports.add(name.text);
    else
      for (const element of name.elements)
        if (ts.isBindingElement(element)) addBindingNames(element.name);
  };

  for (const directive of source.typeReferenceDirectives) {
    const pkg = directive.fileName.startsWith("@")
      ? directive.fileName.split("/").slice(0, 2).join("/")
      : `@types/${directive.fileName}`;
    addImport(pkg, "reference-type", true, directive.pos);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addImport(
        externalModuleName(node.moduleSpecifier),
        "import",
        Boolean(node.importClause?.isTypeOnly),
        node.getStart(source),
      );
    } else if (ts.isExportDeclaration(node)) {
      addImport(
        node.moduleSpecifier ? externalModuleName(node.moduleSpecifier) : null,
        "re-export",
        Boolean(node.isTypeOnly),
        node.getStart(source),
      );
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements)
          exports.add(element.name.text);
      } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        exports.add(node.exportClause.name.text);
      } else if (!node.exportClause) {
        exports.add("*");
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addImport(
        externalModuleName(node.moduleReference.expression!),
        "import",
        Boolean(node.isTypeOnly),
        node.getStart(source),
      );
      if (
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      )
        exports.add(node.name.text);
    } else if (ts.isImportTypeNode(node)) {
      const literal = ts.isLiteralTypeNode(node.argument)
        ? node.argument.literal
        : undefined;
      addImport(
        externalModuleName(literal),
        "import-type",
        Boolean(node.isTypeOf),
        node.getStart(source),
      );
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addImport(
          argument ? externalModuleName(argument as ts.Expression) : null,
          "dynamic-import",
          false,
          node.getStart(source),
        );
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        addImport(
          argument ? externalModuleName(argument as ts.Expression) : null,
          "require",
          false,
          node.getStart(source),
        );
      }
    }

    if (ts.isExportAssignment(node)) {
      exports.add(node.isExportEquals ? "export=" : "default");
    } else if (
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (
        ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      )
        exports.add("default");
      else if (ts.isVariableStatement(node))
        for (const decl of node.declarationList.declarations)
          addBindingNames(decl.name);
      else if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)
      ) {
        if (node.name && ts.isIdentifier(node.name))
          exports.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { path, imports, exports: [...exports].toSorted() };
}

async function sourceFiles(
  packageDir: string,
  nestedWorkspaceDirs: string[],
): Promise<string[]> {
  const results: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const file of glob.scan({
    cwd: packageDir,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    const segments = file.split("/");
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) continue;
    const absolute = resolve(packageDir, file);
    if (
      nestedWorkspaceDirs.some(
        (workspaceDir) =>
          absolute === workspaceDir ||
          absolute.startsWith(`${workspaceDir}${sep}`),
      )
    )
      continue;
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext) || file.endsWith(".d.ts")) continue;
    results.push(resolve(packageDir, file));
  }
  return results;
}

function manifestEntries(manifest: WorkspaceManifest): string[] {
  const result = new Set<string>();
  for (const value of [
    manifest.main,
    manifest.module,
    manifest.types,
    manifest.typings,
  ])
    if (value) result.add(value);
  if (typeof manifest.bin === "string") result.add(manifest.bin);
  else if (manifest.bin)
    for (const value of Object.values(manifest.bin)) result.add(value);
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value === "string") result.add(value);
    else if (value && typeof value === "object") {
      for (const target of Object.values(value as Record<string, unknown>))
        if (typeof target === "string") result.add(target);
    }
    if (key === ".") continue;
  }
  return [...result].toSorted();
}

async function auditPackage(
  root: string,
  item: { path: string; manifest: WorkspaceManifest; workspaceRoot: string },
  workspaceDirs: string[],
): Promise<PackageAudit> {
  const dir = dirname(item.path);
  const nestedWorkspaceDirs = workspaceDirs.filter(
    (workspaceDir) =>
      workspaceDir !== dir && workspaceDir.startsWith(`${dir}${sep}`),
  );
  const files = await sourceFiles(dir, nestedWorkspaceDirs);
  const configPath = join(dir, "tsconfig.json");
  const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = configRead.error
    ? { options: ts.getDefaultCompilerOptions() }
    : ts.parseJsonConfigFileContent(configRead.config, ts.sys, dir);
  const parsedFiles: SourceFileAudit[] = await Promise.all(
    files.map(async (file) =>
      parseSource(file, await Bun.file(file).text(), parsedConfig.options, dir),
    ),
  );

  const dependencies = item.manifest.dependencies ?? {};
  const devDependencies = item.manifest.devDependencies ?? {};
  const peerDependencies = item.manifest.peerDependencies ?? {};
  const declared = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
    ...Object.keys(peerDependencies),
    ...Object.keys(item.manifest.optionalDependencies ?? {}),
    ...(item.manifest.bundledDependencies ?? []),
  ]);
  const imports = parsedFiles.flatMap((file) => file.imports);
  const used = new Set(
    imports.flatMap((ref) => (ref.packageName ? [ref.packageName] : [])),
  );
  const subpathUsed = new Set(
    imports.flatMap((ref) => {
      if (!ref.packageName) return [];
      const scoped = ref.specifier.startsWith("@")
        ? ref.specifier.split("/").slice(0, 2).join("/")
        : ref.specifier.split("/")[0];
      return [scoped];
    }),
  );
  const externalImports = [...used].filter(
    (name) =>
      name !== "bun" && (!name.startsWith("@aphrody/") || declared.has(name)),
  );
  const unlisted = externalImports
    .filter((name) => !declared.has(name) && !name.startsWith("@types/"))
    .toSorted();
  // Development tools are usually invoked by package scripts rather than imported
  // from application source, so only runtime/peer/optional dependencies are audited
  // for unused declarations.
  const sourceUnmatched = Object.keys({
    ...dependencies,
    ...peerDependencies,
    ...item.manifest.optionalDependencies,
  })
    .filter((name) => !subpathUsed.has(name) && !name.startsWith("@types/"))
    .toSorted();
  const exportsByFile: Record<string, string[]> = {};
  for (const file of parsedFiles) {
    if (file.exports.length)
      exportsByFile[relative(root, file.path).split(sep).join("/")] =
        file.exports;
  }
  return {
    path: relative(root, item.path).split(sep).join("/"),
    name: item.manifest.name ?? relative(root, dir).split(sep).join("/"),
    workspaceRoot: item.workspaceRoot.split(sep).join("/"),
    version: item.manifest.version,
    entries: manifestEntries(item.manifest),
    sourceFiles: files.length,
    imports,
    exportsByFile,
    dependencies,
    devDependencies,
    peerDependencies,
    sourceUnmatchedDependencies: sourceUnmatched,
    unlistedExternalImports: unlisted,
  };
}

export async function scanImportsExports(
  root: string,
  workspaceFilter?: string,
): Promise<AuditSummary> {
  const active = await activeWorkspacePackages(root);
  const workspaceDirs = active.map((item) => dirname(item.path));
  const packages = await Promise.all(
    active.map((item) => auditPackage(root, item, workspaceDirs)),
  );
  const filtered = workspaceFilter
    ? packages.filter(
        (pkg) =>
          pkg.name === workspaceFilter ||
          pkg.path === workspaceFilter ||
          pkg.workspaceRoot === workspaceFilter,
      )
    : packages;
  const versions = new Map<string, Map<string, string>>();
  for (const pkg of filtered) {
    for (const [name, value] of Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    })) {
      if (
        value === "workspace:*" ||
        value.startsWith("catalog:") ||
        value.startsWith("file:") ||
        value.startsWith("link:")
      )
        continue;
      const users = versions.get(name) ?? new Map<string, string>();
      users.set(pkg.name, value);
      versions.set(name, users);
    }
  }
  const versionSpecDifferences = Object.fromEntries(
    [...versions.entries()]
      .filter(([, specs]) => new Set(specs.values()).size > 1)
      .map(([name, specs]) => [name, Object.fromEntries(specs)]),
  );
  const imports = filtered.flatMap((pkg) => pkg.imports);
  return {
    root,
    packages: filtered,
    packageCount: filtered.length,
    sourceFileCount: filtered.reduce(
      (count, pkg) => count + pkg.sourceFiles,
      0,
    ),
    importCount: imports.length,
    externalPackages: [
      ...new Set(
        imports.flatMap((ref) => (ref.packageName ? [ref.packageName] : [])),
      ),
    ].toSorted(),
    versionSpecDifferences,
  };
}

function parseArgs(args: string[]): { json: boolean; workspace?: string } {
  let json = false;
  let workspace: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--workspace") {
      workspace = args[++i];
      if (!workspace || workspace.startsWith("--"))
        throw new Error("--workspace requires a package name or path");
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "Usage: bun run scripts/scan-imports-exports.ts [--workspace <name-or-path>] [--json]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return { json, workspace };
}

export async function runImportsExports(
  args: string[],
  root = process.cwd(),
): Promise<void> {
  const { json, workspace } = parseArgs(args);
  const summary = await scanImportsExports(resolve(root), workspace);
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(
    `AST inventory: ${summary.packageCount} workspaces, ${summary.sourceFileCount} source files, ${summary.importCount} module references.`,
  );
  for (const pkg of summary.packages) {
    const unmatched = pkg.sourceUnmatchedDependencies.length
      ? `; source-unmatched candidates: ${pkg.sourceUnmatchedDependencies.join(", ")}`
      : "";
    const unlisted = pkg.unlistedExternalImports.length
      ? `; unlisted source imports: ${pkg.unlistedExternalImports.join(", ")}`
      : "";
    console.log(
      `${pkg.name} (${pkg.path}): ${pkg.sourceFiles} files, ${Object.keys(pkg.exportsByFile).length} exporting modules${unmatched}${unlisted}`,
    );
  }
  const drifts = Object.entries(summary.versionSpecDifferences);
  console.log(`Version-spec differences: ${drifts.length}`);
  for (const [name, users] of drifts)
    console.log(
      `  ${name}: ${Object.entries(users)
        .map(([pkg, spec]) => `${pkg}=${spec}`)
        .join(", ")}`,
    );
}

if (import.meta.main) await runImportsExports(process.argv.slice(2));
