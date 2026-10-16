/**
 * Reproducible vendoring of the Tauri-stack forks into `crates/aphrody-*` (zero dependencies).
 *
 * Reads `vendor.toml`, takes the committed HEAD of each git submodule (never the working tree),
 * and produces a self-contained set of crates:
 *  - package names get the configured prefix, library/binary names stay unchanged
 *  - `workspace = true` fields and dependencies are materialized from the source workspace
 *  - dependencies on imported crates point to the new directories (`package = "aphrody-x"`)
 *    with the version constraint aligned on the imported version
 *  - `vendor.lock` and `docs/reference/workspace/CRATES.md` describe the result
 *
 * Dry-run by default; `--apply` writes to `--out`; `--check` diffs against `--out`.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";

export interface SourceConfig {
  readonly name: string;
  readonly crates: readonly string[];
  readonly excludeCrates?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
  /**
   * rustfmt style of the upstream repository: a path to its `rustfmt.toml` (copied into each
   * crate) or `"default"` (a marker file keeps the default style despite the root config).
   */
  readonly rustfmt?: string | undefined;
  /** Optional new base name for crates whose upstream name is too generic (`api` → `tauri-api`). */
  readonly rename?: Readonly<Record<string, string>> | undefined;
}

export interface CopyConfig {
  readonly from: string;
  readonly to: string;
  /** Globs relative to `from` that are not copied. */
  readonly exclude?: readonly string[] | undefined;
}

export interface RewriteConfig {
  readonly files: string;
  readonly from: string;
  readonly to: string;
}

export interface VendorConfig {
  readonly prefix: string;
  readonly repository: string;
  readonly out: string;
  readonly exclude: readonly string[];
  readonly sources: readonly SourceConfig[];
  readonly copy: readonly CopyConfig[];
  readonly rewrite: readonly RewriteConfig[];
}

export interface CrateInfo {
  readonly source: string;
  /** Directory inside the source repository ("." for a crate at the repository root). */
  readonly srcDir: string;
  readonly name: string;
  readonly newName: string;
  readonly version: string;
  /** Directory of the imported crate, relative to the output root. */
  readonly newDir: string;
}

type Table = Record<string, unknown>;

export interface TransformContext {
  readonly crate: CrateInfo;
  readonly cfg: Pick<VendorConfig, "prefix" | "repository">;
  readonly byName: ReadonlyMap<string, CrateInfo>;
  /** Imported crates by `<source>:<srcDir>`. */
  readonly byDir: ReadonlyMap<string, CrateInfo>;
  readonly wsPackage: Table;
  readonly wsDeps: Table;
  readonly wsLints: Table | undefined;
  /** Directory of the workspace root in the source repository. */
  readonly wsRootDir: string;
  readonly hasFile: (srcPath: string) => boolean;
}

// ---------------------------------------------------------------------------------------------
// TOML text helpers
// ---------------------------------------------------------------------------------------------

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function serializeToml(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeToml).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Table);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${BARE_KEY.test(k) ? k : JSON.stringify(k)} = ${serializeToml(v)}`).join(", ")} }`;
  }
  throw new Error(`Cannot serialize TOML value: ${String(value)}`);
}

/** Net bracket depth change of a line, ignoring strings and comments. */
function bracketDelta(line: string): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quote !== undefined) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") break;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
  }
  return depth;
}

interface Section {
  readonly name: string;
  readonly isArray: boolean;
  /** Index of the header line. */
  readonly start: number;
  /** Exclusive end index (next header or end of file). */
  readonly end: number;
}

const HEADER = /^\s*(\[\[?)\s*(.+?)\s*\]\]?\s*(?:#.*)?$/;

function scanSections(lines: readonly string[]): Section[] {
  const headers: { name: string; isArray: boolean; start: number }[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (depth === 0) {
      const m = HEADER.exec(line);
      if (m !== null && line.trimStart().startsWith("[")) {
        headers.push({
          name: m[2] as string,
          isArray: m[1] === "[[",
          start: i,
        });
        continue;
      }
    }
    depth = Math.max(0, depth + bracketDelta(line));
  }
  return headers.map((h, idx) =>
    Object.assign(h, {
      end:
        idx + 1 < headers.length
          ? (
              headers[idx + 1] as {
                start: number;
              }
            ).start
          : lines.length,
    }),
  );
}

/** Ranges `[start, end)` of `key = value` entries (multi-line aware) in a section body. */
function entryRanges(
  lines: readonly string[],
  section: Section,
): { key: string; start: number; end: number }[] {
  const out: { key: string; start: number; end: number }[] = [];
  let i = section.start + 1;
  while (i < section.end) {
    const line = lines[i] as string;
    const m = /^\s*("[^"]+"|[A-Za-z0-9_.-]+)\s*=/.exec(line);
    if (m === null) {
      i++;
      continue;
    }
    let end = i + 1;
    let depth = bracketDelta(line.slice(m[0].length));
    while (depth > 0 && end < section.end) {
      depth += bracketDelta(lines[end] as string);
      end++;
    }
    out.push({ key: m[1] as string, start: i, end });
    i = end;
  }
  return out;
}

const DEP_SECTION = /^(target\..+\.)?(dev-|build-)?dependencies$/;
const DEP_DETAIL_SECTION =
  /^(target\..+\.)?(dev-|build-)?dependencies\.("[^"]+"|[A-Za-z0-9_-]+)$/;

function parseEntry(text: string): { key: string; value: unknown } {
  const parsed = Bun.TOML.parse(text) as Table;
  const key = Object.keys(parsed)[0];
  if (key === undefined) throw new Error(`Cannot parse TOML entry: ${text}`);
  return { key, value: parsed[key] };
}

function asSpec(value: unknown): Table {
  return typeof value === "string"
    ? { version: value }
    : { ...(value as Table) };
}

function relativeDir(from: string, to: string): string {
  const rel = posix.relative(from, to);
  return rel === "" ? "." : rel.startsWith(".") ? rel : `./${rel}`;
}

function alignVersion(requirement: string, version: string): string {
  const op = /^[=~^<>]*\s*/.exec(requirement)?.[0].trim() ?? "";
  return `${op}${version}`;
}

function mergeWorkspaceDependency(member: Table, ws: Table): Table {
  const out: Table = { ...ws };
  for (const [key, value] of Object.entries(member)) {
    if (key === "workspace") continue;
    if (key === "features") {
      out.features = [
        ...new Set([
          ...((ws.features as string[] | undefined) ?? []),
          ...(value as string[]),
        ]),
      ];
    } else if (key === "default-features") {
      if (ws["default-features"] !== false) out["default-features"] = value;
    } else out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Manifest transformation
// ---------------------------------------------------------------------------------------------

const resolvePath = (path: string, base: string): string =>
  posix.normalize(posix.join(base, path));

export interface TransformResult {
  readonly text: string;
  readonly warnings: readonly string[];
}

export function transformManifest(
  text: string,
  ctx: TransformContext,
): TransformResult {
  const warnings: string[] = [];
  const crate = ctx.crate;
  let lines = text.split("\n");

  // 1. Drop workspace-level tables that are meaningless for a member crate.
  const firstHeader = scanSections(lines)[0]?.start ?? lines.length;
  for (let i = firstHeader - 1; i >= 0; i--) {
    if (/^\s*workspace\s*=/.test(lines[i] as string)) lines.splice(i, 1);
  }
  const drop = /^(workspace(\..*)?|profile(\..*)?|patch(\..*)?|replace)$/;
  for (const section of scanSections(lines).toReversed()) {
    if (drop.test(section.name))
      lines.splice(section.start, section.end - section.start);
  }
  while (
    lines.length > 0 &&
    lines[lines.length - 1] === "" &&
    lines[lines.length - 2] === ""
  )
    lines.pop();

  const replaceRange = (
    start: number,
    end: number,
    replacement: string[],
  ): void => {
    lines.splice(start, end - start, ...replacement);
  };

  // 2. [package]
  let sections = scanSections(lines);
  const pkg = sections.find((s) => s.name === "package");
  if (pkg === undefined) throw new Error(`${crate.name}: missing [package]`);
  for (const entry of entryRanges(lines, pkg).toReversed()) {
    const raw = (lines.slice(entry.start, entry.end) as string[]).join("\n");
    const dotted =
      /^\s*([A-Za-z0-9_-]+)\.workspace\s*=\s*true\s*(?:#.*)?$/.exec(raw);
    const inline =
      /^\s*([A-Za-z0-9_-]+)\s*=\s*\{\s*workspace\s*=\s*true\s*\}\s*(?:#.*)?$/.exec(
        raw,
      );
    const field = dotted?.[1] ?? inline?.[1];
    if (field !== undefined) {
      const value =
        field === "repository" ? ctx.cfg.repository : ctx.wsPackage[field];
      if (value === undefined)
        throw new Error(
          `${crate.name}: workspace.package.${field} is not defined`,
        );
      replaceRange(entry.start, entry.end, [
        `${field} = ${serializeToml(value)}`,
      ]);
    } else if (entry.key === "name") {
      replaceRange(entry.start, entry.end, [
        `name = ${JSON.stringify(crate.newName)}`,
      ]);
    } else if (entry.key === "documentation") {
      replaceRange(entry.start, entry.end, [
        raw.replace(`docs.rs/${crate.name}`, `docs.rs/${crate.newName}`),
      ]);
    }
  }
  // repository always points to the monorepo (set after materialization).
  sections = scanSections(lines);
  const pkg2 = sections.find((s) => s.name === "package") as Section;
  const repo = entryRanges(lines, pkg2).find((e) => e.key === "repository");
  if (repo !== undefined)
    replaceRange(repo.start, repo.end, [
      `repository = ${JSON.stringify(ctx.cfg.repository)}`,
    ]);

  // 3. [lints] workspace = true
  sections = scanSections(lines);
  const lints = sections.find((s) => s.name === "lints");
  if (lints !== undefined) {
    const body = lines.slice(lints.start + 1, lints.end).join("\n");
    if (/^\s*workspace\s*=\s*true\s*$/m.test(body)) {
      const replacement: string[] = [];
      for (const [tool, rules] of Object.entries(ctx.wsLints ?? {})) {
        replacement.push(`[lints.${tool}]`);
        for (const [rule, level] of Object.entries(rules as Table)) {
          replacement.push(
            `${BARE_KEY.test(rule) ? rule : JSON.stringify(rule)} = ${serializeToml(level)}`,
          );
        }
        replacement.push("");
      }
      replaceRange(lints.start, lints.end, replacement);
    }
  }

  // 4. Dependencies
  const crateSrcAbs = crate.srcDir;
  const rewriteDependency = (
    key: string,
    input: Table,
  ): { spec: Table; changed: boolean } => {
    let spec = { ...input };
    let pathBase = crateSrcAbs;
    const realName = (spec.package as string | undefined) ?? key;
    let changed = false;

    if (spec.workspace === true) {
      const wsEntry = ctx.wsDeps[key];
      if (wsEntry === undefined)
        throw new Error(
          `${crate.name}: workspace dependency "${key}" is not defined`,
        );
      spec = mergeWorkspaceDependency(spec, asSpec(wsEntry));
      pathBase = ctx.wsRootDir;
      changed = true;
    }

    let target: CrateInfo | undefined;
    if (typeof spec.path === "string") {
      target = ctx.byDir.get(
        `${crate.source}:${resolvePath(spec.path, pathBase)}`,
      );
      if (target === undefined && ctx.byName.has(realName))
        target = ctx.byName.get(realName);
      if (target === undefined)
        warnings.push(
          `${crate.name}: path dependency "${key}" (${spec.path}) is not an imported crate`,
        );
    } else if (ctx.byName.has(realName)) {
      target = ctx.byName.get(realName);
    }

    if (target !== undefined) {
      spec.path = relativeDir(crate.newDir, target.newDir);
      spec.package = target.newName;
      if (typeof spec.version === "string")
        spec.version = alignVersion(spec.version, target.version);
      changed = true;
    }

    const ordered: Table = {};
    for (const k of ["version", "path", "package"])
      if (spec[k] !== undefined) ordered[k] = spec[k];
    for (const [k, v] of Object.entries(spec))
      if (ordered[k] === undefined) ordered[k] = v;
    return { spec: ordered, changed };
  };

  sections = scanSections(lines);
  for (const section of [...sections].toReversed()) {
    if (DEP_DETAIL_SECTION.test(section.name)) {
      const m =
        /\.(?:dev-|build-)?dependencies\.("[^"]+"|[A-Za-z0-9_-]+)$|^(?:dev-|build-)?dependencies\.("[^"]+"|[A-Za-z0-9_-]+)$/.exec(
          section.name,
        );
      const depKey = (m?.[1] ?? m?.[2] ?? "").replace(/"/g, "");
      const body = lines.slice(section.start + 1, section.end).join("\n");
      const { spec, changed } = rewriteDependency(
        depKey,
        Bun.TOML.parse(body) as Table,
      );
      if (!changed) continue;
      const rendered = Object.entries(spec).map(
        ([k, v]) =>
          `${BARE_KEY.test(k) ? k : JSON.stringify(k)} = ${serializeToml(v)}`,
      );
      replaceRange(section.start + 1, section.end, [...rendered, ""]);
      continue;
    }
    if (!DEP_SECTION.test(section.name)) continue;
    for (const entry of entryRanges(lines, section).toReversed()) {
      const { key, value } = parseEntry(
        lines.slice(entry.start, entry.end).join("\n"),
      );
      const { spec, changed } = rewriteDependency(key, asSpec(value));
      if (!changed) continue;
      const keys = Object.keys(spec);
      const out =
        keys.length === 1 && keys[0] === "version"
          ? serializeToml(spec.version)
          : serializeToml(spec);
      replaceRange(entry.start, entry.end, [
        `${BARE_KEY.test(key) ? key : JSON.stringify(key)} = ${out}`,
      ]);
    }
  }

  // 5. [lib] / [[bin]] names stay unchanged
  sections = scanSections(lines);
  const libName = crate.name.replace(/-/g, "_");
  const libSection = sections.find((s) => s.name === "lib" && !s.isArray);
  const hasLibFile = ctx.hasFile(posix.join(crate.srcDir, "src/lib.rs"));
  if (libSection !== undefined) {
    const hasName = entryRanges(lines, libSection).some(
      (e) => e.key === "name",
    );
    if (!hasName)
      lines.splice(
        libSection.start + 1,
        0,
        `name = ${JSON.stringify(libName)}`,
      );
  }
  const append: string[] = [];
  if (libSection === undefined && hasLibFile)
    append.push("[lib]", `name = ${JSON.stringify(libName)}`, "");
  sections = scanSections(lines);
  const hasMainFile = ctx.hasFile(posix.join(crate.srcDir, "src/main.rs"));
  const bins = sections.filter((s) => s.name === "bin" && s.isArray);
  const coversMain = bins.some((s) =>
    entryRanges(lines, s).some(
      (e) =>
        e.key === "path" &&
        /["']src\/main\.rs["']/.test(lines[e.start] as string),
    ),
  );
  if (hasMainFile && !coversMain) {
    append.push(
      "[[bin]]",
      `name = ${JSON.stringify(crate.name)}`,
      `path = "src/main.rs"`,
      "",
    );
  }
  if (append.length > 0) {
    // Insert right after the last package-related section.
    sections = scanSections(lines);
    const pkgSections = sections.filter(
      (s) => s.name === "package" || s.name.startsWith("package."),
    );
    const last = pkgSections[pkgSections.length - 1] as Section;
    let at = last.end;
    while (at > last.start + 1 && lines[at - 1] === "") at--;
    lines.splice(at, 0, "", ...append);
  }

  lines = lines.filter((line, idx) => !(line === "" && lines[idx - 1] === ""));
  const joined = lines.join("\n").replace(/\n*$/, "\n");
  // Validate that the result is still valid TOML with the expected identity.
  const reparsed = Bun.TOML.parse(joined) as Table;
  if ((reparsed.package as Table).name !== crate.newName) {
    throw new Error(
      `${crate.name}: transformed manifest has unexpected package name`,
    );
  }
  return { text: joined, warnings };
}

// ---------------------------------------------------------------------------------------------
// Import engine
// ---------------------------------------------------------------------------------------------

export interface OutputFile {
  readonly path: string;
  readonly data: Uint8Array;
  readonly mode: number;
}

export interface ImportResult {
  readonly files: Map<string, OutputFile>;
  readonly crates: readonly CrateInfo[];
  readonly sources: readonly { name: string; sha: string }[];
  readonly warnings: readonly string[];
  readonly removedDirs: readonly string[];
  /** Directories fully owned by a [[copy]] rule: wiped before writing, scanned by --check. */
  readonly copyDirs: readonly string[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err.trim()}`);
  return out;
}

function walk(dir: string, base = dir, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, acc);
    else
      acc.push(
        posix.relative(base.split("\\").join("/"), abs.split("\\").join("/")),
      );
  }
  return acc;
}

function globMatch(patterns: readonly string[], path: string): boolean {
  return patterns.some((p) => new Bun.Glob(p).match(path));
}

const asList = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function loadVendorConfig(path: string): Promise<VendorConfig> {
  const raw = Bun.TOML.parse(await Bun.file(path).text()) as Table;
  return {
    prefix: String(raw.prefix ?? "aphrody-"),
    repository: String(raw.repository ?? ""),
    out: String(raw.out ?? "crates"),
    exclude: asList<string>(raw.exclude),
    sources: asList<Table>(raw.source).map((s) => ({
      name: String(s.name),
      crates: asList<string>(s.crates),
      excludeCrates: asList<string>(s.exclude_crates),
      exclude: asList<string>(s.exclude),
      rename: (s.rename ?? {}) as Record<string, string>,
      rustfmt: s.rustfmt === undefined ? undefined : String(s.rustfmt),
    })),
    copy: asList<Table>(raw.copy).map((c) => ({
      from: String(c.from),
      to: String(c.to),
      exclude: asList<string>(c.exclude),
    })),
    rewrite: asList<Table>(raw.rewrite).map((r) => ({
      files: String(r.files),
      from: String(r.from),
      to: String(r.to),
    })),
  };
}

export interface ImportOptions {
  readonly rootDir: string;
  readonly config: VendorConfig;
  readonly cacheDir: string;
  /** Previously imported directories (from vendor.lock), removed on apply. */
  readonly previousDirs: readonly string[];
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const { rootDir, config: cfg } = options;
  const warnings: string[] = [];
  const checkouts = new Map<string, string>();
  const sources: { name: string; sha: string }[] = [];

  // Materialize the committed HEAD of each submodule.
  for (const source of cfg.sources) {
    const repo = resolve(rootDir, "vendor", source.name);
    if (!existsSync(repo))
      throw new Error(`Source repository not found: vendor/${source.name}`);
    // oxlint-disable-next-line no-await-in-loop -- sources are validated in config order; a dirty checkout must abort before any later source is touched
    const dirty = (
      await git(repo, ["status", "--porcelain", "--untracked-files=no"])
    ).trim();
    if (dirty !== "")
      throw new Error(
        `vendor/${source.name} has uncommitted changes; commit or reset them first`,
      );
    // oxlint-disable-next-line no-await-in-loop -- rev-parse runs per source in config order, after the same dirty-tree guard
    const sha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const dir = resolve(options.cacheDir, source.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- one checkout at a time: each source rewrites its own cache directory and failures must stay reproducible
    await git(repo, ["checkout-index", "-a", "-f", `--prefix=${dir}/`]);
    checkouts.set(source.name, dir);
    sources.push({ name: source.name, sha });
  }

  // Discover crates.
  const crates: CrateInfo[] = [];
  const manifests = new Map<string, Table>();
  const fileLists = new Map<string, string[]>();
  for (const source of cfg.sources) {
    const checkout = checkouts.get(source.name) as string;
    const all = walk(checkout).toSorted();
    fileLists.set(source.name, all);
    for (const file of all) {
      if (basename(file) !== "Cargo.toml" || file.includes("node_modules/"))
        continue;
      const dir = posix.dirname(file);
      const matches = source.crates.some((p) =>
        p === "." ? dir === "." : new Bun.Glob(p).match(dir),
      );
      if (!matches || globMatch(source.excludeCrates ?? [], dir)) continue;
      // oxlint-disable-next-line no-await-in-loop -- crates are collected in directory-walk order, which the generated vendor manifest records
      const manifest = Bun.TOML.parse(
        await Bun.file(join(checkout, file)).text(),
      ) as Table;
      const pkg = manifest.package as Table | undefined;
      if (pkg === undefined) continue;
      const name = String(pkg.name);
      const version = typeof pkg.version === "string" ? pkg.version : "";
      const info: CrateInfo = {
        source: source.name,
        srcDir: dir,
        name,
        newName: `${cfg.prefix}${source.rename?.[name] ?? name}`,
        version,
        newDir: posix.join(
          cfg.out,
          `${cfg.prefix}${source.rename?.[name] ?? name}`,
        ),
      };
      crates.push(info);
      manifests.set(`${source.name}:${dir}`, manifest);
    }
  }
  crates.sort((a, b) => a.newName.localeCompare(b.newName));
  const byName = new Map<string, CrateInfo>();
  for (const c of crates) {
    if (byName.has(c.name))
      throw new Error(
        `Duplicate crate name "${c.name}" in ${c.source} and ${byName.get(c.name)?.source}`,
      );
    byName.set(c.name, c);
  }
  const byDir = new Map(
    crates.map((c) => [`${c.source}:${c.srcDir}`, c] as const),
  );

  const files = new Map<string, OutputFile>();
  const put = (path: string, data: Uint8Array | string, mode = 0o644): void => {
    files.set(path, {
      path,
      data: typeof data === "string" ? new TextEncoder().encode(data) : data,
      mode,
    });
  };

  // Build outputs per crate.
  for (const source of cfg.sources) {
    const checkout = checkouts.get(source.name) as string;
    const list = fileLists.get(source.name) as string[];
    const present = new Set(list);
    const rootManifestPath = join(checkout, "Cargo.toml");
    const rootManifest = existsSync(rootManifestPath)
      ? // oxlint-disable-next-line no-await-in-loop -- the root manifest is read per source in config order, before its members are walked
        (Bun.TOML.parse(await Bun.file(rootManifestPath).text()) as Table)
      : {};
    const ws = (rootManifest.workspace ?? {}) as Table;
    const mine = crates.filter((c) => c.source === source.name);
    const srcExclude = [...cfg.exclude, ...(source.exclude ?? [])];

    for (const file of list) {
      if (globMatch(srcExclude, file)) continue;
      // The owner is the deepest imported crate directory containing the file.
      let owner: CrateInfo | undefined;
      for (const c of mine) {
        const inside =
          c.srcDir === "." ||
          file === c.srcDir ||
          file.startsWith(`${c.srcDir}/`);
        if (
          inside &&
          (owner === undefined || c.srcDir.length > owner.srcDir.length)
        )
          owner = c;
      }
      if (owner === undefined) continue;
      const rel =
        owner.srcDir === "." ? file : file.slice(owner.srcDir.length + 1);
      const dest = posix.join(owner.newDir, rel);
      const abs = join(checkout, file);
      if (rel === "Cargo.toml") {
        // oxlint-disable-next-line no-await-in-loop -- vendored files are rewritten in walk order so the output list and rewrite results stay deterministic
        const result = transformManifest(await Bun.file(abs).text(), {
          crate: owner,
          cfg,
          byName,
          byDir,
          wsPackage: (ws.package ?? {}) as Table,
          wsDeps: (ws.dependencies ?? {}) as Table,
          wsLints: ws.lints as Table | undefined,
          wsRootDir: ".",
          hasFile: (p) => present.has(p),
        });
        warnings.push(...result.warnings);
        put(dest, result.text);
      } else {
        const mode = lstatSync(abs).mode & 0o111 ? 0o755 : 0o644;
        // oxlint-disable-next-line no-await-in-loop -- each file is staged in walk order into the shared output map (deterministic filesGenerated)
        put(dest, new Uint8Array(await Bun.file(abs).arrayBuffer()), mode);
      }
    }
  }

  // Keep each crate formatted with the style of its upstream repository.
  for (const source of cfg.sources) {
    if (source.rustfmt === undefined) continue;
    const checkout = checkouts.get(source.name) as string;
    const style =
      source.rustfmt === "default"
        ? "# Vendored crate: upstream uses the default rustfmt style (the root rustfmt.toml does not apply).\n"
        : // oxlint-disable-next-line no-await-in-loop -- the rustfmt config is read per source in config order, as the staging loop it feeds
          (await Bun.file(join(checkout, source.rustfmt)).text())
            .split("\n")
            // nightly-only options only produce warnings on the stable toolchain
            .filter(
              (line) =>
                !/^\s*#?\s*(imports_granularity|wrap_comments|normalize_comments|license_template_path)\b/.test(
                  line,
                ),
            )
            .join("\n");
    for (const c of crates.filter((o) => o.source === source.name)) {
      put(posix.join(c.newDir, "rustfmt.toml"), style);
    }
  }

  // Extra copies (shared tooling that lives outside any crate).
  const copyDirs: string[] = [];
  for (const copy of cfg.copy) {
    const [sourceName, ...rest] = copy.from.split(":");
    const sub = rest.join(":");
    const checkout = checkouts.get(sourceName as string);
    if (checkout === undefined)
      throw new Error(`[[copy]] unknown source "${sourceName}"`);
    const absFrom = join(checkout, sub);
    if (!existsSync(absFrom))
      throw new Error(`[[copy]] path not found: ${copy.from}`);
    const isDirectory = lstatSync(absFrom).isDirectory();
    if (isDirectory) copyDirs.push(copy.to);
    const items = isDirectory
      ? walk(absFrom)
          .filter((f) => !globMatch(copy.exclude ?? [], f))
          .map((f) => [join(absFrom, f), posix.join(copy.to, f)] as const)
      : [[absFrom, copy.to] as const];
    for (const [from, to] of items) {
      put(
        to,
        // oxlint-disable-next-line no-await-in-loop -- files are copied in walk order into the shared put map (deterministic output)
        new Uint8Array(await Bun.file(from).arrayBuffer()),
        lstatSync(from).mode & 0o111 ? 0o755 : 0o644,
      );
    }
  }

  // Sibling directory references inside Rust sources, e.g. "../tauri-cli/x.json".
  const decoder = new TextDecoder();
  for (const c of crates) {
    const siblings = crates.filter(
      (o) =>
        o.source === c.source &&
        o !== c &&
        posix.dirname(o.srcDir) === posix.dirname(c.srcDir) &&
        o.srcDir !== ".",
    );
    if (siblings.length === 0) continue;
    for (const [path, file] of files) {
      if (!path.startsWith(`${c.newDir}/`) || !path.endsWith(".rs")) continue;
      let text = decoder.decode(file.data);
      let changed = false;
      for (const s of siblings) {
        const oldRef = `../${basename(s.srcDir)}/`;
        if (text.includes(oldRef)) {
          text = text.split(oldRef).join(`../${basename(s.newDir)}/`);
          changed = true;
        }
      }
      if (changed) put(path, text, file.mode);
    }
  }

  // Explicit rewrites.
  for (const rule of cfg.rewrite) {
    let hits = 0;
    for (const [path, file] of files) {
      if (!new Bun.Glob(rule.files).match(path)) continue;
      const text = decoder.decode(file.data);
      if (!text.includes(rule.from)) continue;
      put(path, text.split(rule.from).join(rule.to), file.mode);
      hits++;
    }
    if (hits === 0)
      warnings.push(
        `[[rewrite]] matched nothing: ${rule.files} (${rule.from})`,
      );
  }

  // Verify relative file references that must resolve inside the new layout.
  for (const [path, file] of files) {
    if (!path.endsWith(".rs")) continue;
    const text = decoder
      .decode(file.data)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    for (const m of text.matchAll(
      /\binclude(?:_str|_bytes)?!\(\s*"([^"$]+)"\s*\)/g,
    )) {
      const target = posix.normalize(
        posix.join(posix.dirname(path), m[1] as string),
      );
      if (!files.has(target))
        warnings.push(
          `${path}: include of "${m[1]}" does not resolve (${target})`,
        );
    }
  }

  const crateDirs = new Set(crates.map((c) => c.newDir));
  const removedDirs = options.previousDirs.filter((d) => !crateDirs.has(d));
  return { files, crates, sources, warnings, removedDirs, copyDirs };
}

export function renderLock(result: ImportResult): string {
  const lock = {
    version: 1,
    generator: "yolo import",
    sources: result.sources,
    crates: result.crates.map((c) => ({
      name: c.name,
      package: c.newName,
      version: c.version,
      source: c.source,
      from: c.srcDir,
      dir: c.newDir,
    })),
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function renderCratesDoc(
  result: ImportResult,
  cfg: VendorConfig,
): string {
  const rows = result.crates
    .map(
      (c) =>
        `| \`${c.newName}\` | \`${c.name}\` | ${c.version || "-"} | \`${c.source}\` | \`${c.newDir}\` |`,
    )
    .join("\n");
  const sha = result.sources
    .map((s) => `- \`${s.name}\`: \`${s.sha.slice(0, 12)}\``)
    .join("\n");
  return `# Imported crates\n\n_Generated by \`yolo import\` from \`vendor.toml\`. Do not edit by hand._\n\nPackages are prefixed with \`${cfg.prefix}\`; library and binary names are unchanged.\n\n| Package | Upstream crate | Version | Source | Directory |\n| :--- | :--- | :--- | :--- | :--- |\n${rows}\n\n## Source commits\n\n${sha}\n`;
}

async function writeOutputs(
  outRoot: string,
  result: ImportResult,
  extra: Map<string, string>,
): Promise<void> {
  for (const dir of [
    ...result.removedDirs,
    ...result.crates.map((c) => c.newDir),
    ...result.copyDirs,
  ]) {
    rmSync(resolve(outRoot, dir), { recursive: true, force: true });
  }
  for (const [path, file] of result.files) {
    const abs = resolve(outRoot, path);
    mkdirSync(dirname(abs), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- files are written one at a time: vendored trees hold thousands of files and sequential writes bound open handles
    await Bun.write(abs, file.data);
    chmodSync(abs, file.mode);
  }
  for (const [path, text] of extra) {
    const abs = resolve(outRoot, path);
    mkdirSync(dirname(abs), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- files are written one at a time: vendored trees hold thousands of files and sequential writes bound open handles
    await Bun.write(abs, text);
  }
}

/** Lists every Cargo manifest of the sources and whether it is imported (`yolo import --scan`). */
export async function scanSources(
  rootDir: string,
  cfg: VendorConfig,
): Promise<number> {
  let missed = 0;
  for (const source of cfg.sources) {
    const repo = resolve(rootDir, "vendor", source.name);
    // oxlint-disable-next-line no-await-in-loop -- sources are listed in config order; each listing feeds the ordered manifest set
    const listing = await git(repo, [
      "ls-files",
      "-z",
      "--",
      "Cargo.toml",
      "**/Cargo.toml",
    ]);
    const manifests = listing.split("\0").filter(Boolean).toSorted();
    console.log(`\x1b[1m${source.name}\x1b[0m (${manifests.length} manifests)`);
    for (const file of manifests) {
      const dir = posix.dirname(file);
      const imported =
        source.crates.some((p) =>
          p === "." ? dir === "." : new Bun.Glob(p).match(dir),
        ) && !globMatch(source.excludeCrates ?? [], dir);
      let name = "";
      try {
        // oxlint-disable-next-line no-await-in-loop -- manifests are parsed one by one in listing order to keep the reported names deterministic
        const manifest = Bun.TOML.parse(
          await Bun.file(join(repo, file)).text(),
        ) as Table;
        name = String(
          (manifest.package as Table | undefined)?.name ?? "(workspace root)",
        );
      } catch {
        name = "(unparsable)";
      }
      if (!imported) missed++;
      console.log(
        `  ${imported ? "\x1b[32m✔ imported\x1b[0m" : "\x1b[33m· skipped \x1b[0m"} ${file}  ${name}`,
      );
    }
  }
  console.log(`${missed} manifest(s) not imported.`);
  return 0;
}

/** `yolo import [--apply] [--check] [--scan] [--out <dir>] [--config <file>]` */
export async function runImportCommand(
  args: readonly string[],
  rootDir: string = process.cwd(),
): Promise<number> {
  let apply = false;
  let check = false;
  let scan = false;
  let out = rootDir;
  let configPath = resolve(rootDir, "vendor.toml");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--help" || arg === "-h" || arg === "help") {
      console.log(
        `Usage: yolo import [--apply] [--check] [--scan] [--out <dir>] [--config <file>]\n\n` +
          `  (no flags)  dry run: what would be imported from vendor.toml into crates/aphrody-*\n` +
          `  --apply     write the import (normally done on the \`vendor\` branch; see docs/guides/workspace/VENDORING.md)\n` +
          `  --check     fail if crates/ differs from a fresh import of the pinned submodule commits\n` +
          `  --scan      report what vendor.toml could add from the configured sources, without importing\n` +
          `  --out DIR   import into DIR instead of this checkout (used by import-check's worktree)\n` +
          `  --config F  vendor config to read (default: vendor.toml)`,
      );
      return 0;
    }
    if (arg === "--apply") apply = true;
    else if (arg === "--check") check = true;
    else if (arg === "--scan") scan = true;
    else if (arg === "--out") out = resolve(rootDir, args[++i] ?? "");
    else if (arg === "--config") configPath = resolve(rootDir, args[++i] ?? "");
    else throw new Error(`Unknown option ${arg}`);
  }

  const config = await loadVendorConfig(configPath);
  if (scan) return scanSources(rootDir, config);
  const lockPath = resolve(out, "vendor.lock");
  const previous = existsSync(lockPath)
    ? ((
        (await Bun.file(lockPath).json()) as { crates?: { dir: string }[] }
      ).crates?.map((c) => c.dir) ?? [])
    : [];
  const started = Bun.nanoseconds();
  const result = await runImport({
    rootDir,
    config,
    cacheDir: resolve(rootDir, ".cache/import"),
    previousDirs: previous,
  });
  const extra = new Map<string, string>([
    ["vendor.lock", renderLock(result)],
    ["docs/reference/workspace/CRATES.md", renderCratesDoc(result, config)],
  ]);
  const elapsed = ((Bun.nanoseconds() - started) / 1e6).toFixed(0);
  console.log(
    `\x1b[1m[import]\x1b[0m ${result.crates.length} crates, ${result.files.size} files from ${result.sources.length} sources (${elapsed} ms)`,
  );
  for (const w of result.warnings) console.warn(`  warning: ${w}`);

  if (check) {
    const diffs: string[] = [];
    const expected = new Map<string, Uint8Array>(
      [...result.files].map(([p, f]) => [p, f.data] as const),
    );
    for (const [p, t] of extra) expected.set(p, new TextEncoder().encode(t));
    for (const [path, data] of expected) {
      const abs = resolve(out, path);
      if (!existsSync(abs)) {
        diffs.push(`missing: ${path}`);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- verification reads one file at a time so diffs are reported in path order
      const actual = new Uint8Array(await Bun.file(abs).arrayBuffer());
      if (Bun.hash.wyhash(actual) !== Bun.hash.wyhash(data))
        diffs.push(`differs: ${path}`);
    }
    for (const dir of [
      ...result.crates.map((c) => c.newDir),
      ...result.copyDirs,
    ]) {
      const abs = resolve(out, dir);
      if (!existsSync(abs)) continue;
      for (const f of walk(abs)) {
        const rel = posix.join(dir, f);
        if (!expected.has(rel)) diffs.push(`extra: ${rel}`);
      }
    }
    for (const d of diffs.slice(0, 50)) console.log(`  ${d}`);
    if (diffs.length > 50) console.log(`  … ${diffs.length - 50} more`);
    console.log(
      diffs.length === 0
        ? "In sync with the sources."
        : `${diffs.length} difference(s).`,
    );
    return diffs.length === 0 ? 0 : 1;
  }

  if (!apply) {
    console.log(
      "Dry-run only. Re-run with --apply (and --out <worktree>) to write.",
    );
    return 0;
  }
  await writeOutputs(out, result, extra);
  console.log(`Written to ${out}`);
  return 0;
}
