/**
 * Mass, rule-based renamer for git repositories (zero dependencies, native Bun).
 *
 * - Git tracked and non-ignored untracked file discovery
 * - Concurrent zero-copy I/O (Bun.file / Bun.write), cheap `includes` prefilter before any regex
 * - Identifier boundaries on both ends, with punctuation-ended scope prefixes supported
 * - Binary/non-UTF8 content is skipped; explicit globs and CHANGELOG/LICENSE are excluded
 * - Preflight and dry-run by default; private JSONL recovery journal before --apply writes
 */
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  existsSync,
  renameSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";

export interface RenameRule {
  readonly from: string;
  readonly to: string;
}

export interface RenameOptions {
  readonly cwd: string;
  readonly rules: readonly RenameRule[];
  readonly apply: boolean;
  readonly paths: boolean;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly concurrency: number;
  readonly journalDir: string;
}

export interface FileChange {
  readonly path: string;
  readonly replacements: number;
  readonly before: string;
  readonly after: string;
}

export interface RenameReport {
  readonly cwd: string;
  readonly scanned: number;
  readonly skippedBinary: number;
  readonly changedFiles: number;
  readonly replacements: number;
  readonly renamedPaths: number;
  readonly applied: boolean;
  readonly elapsedMs: number;
  readonly journal?: string | undefined;
}

export const DEFAULT_EXCLUDES: readonly string[] = [
  "**/CHANGELOG*",
  "**/LICENSE*",
  "**/node_modules/**",
  "**/audits/**",
  "**/.changes/*.md",
];

/** Built-in rule presets. `aphrody` moves every upstream npm scope to @aphrody. */
export const PRESETS: Record<string, readonly RenameRule[]> = {
  aphrody: [{ from: "@tauri-apps/", to: "@aphrody/" }],
};

const IDENT = /[\p{L}\p{N}\p{M}_$-]/u;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function validateRules(rules: readonly RenameRule[]) {
  for (const rule of rules) if (!rule.from) throw new Error("--from must not be empty");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Literal replacements with identifier boundaries and punctuation-ended prefix support. */
export function applyRules(
  input: string,
  rules: readonly RenameRule[],
): { output: string; count: number } {
  validateRules(rules);
  let output = input;
  let count = 0;
  for (const rule of rules) {
    if (!output.includes(rule.from)) continue;
    const re = new RegExp(escapeRegExp(rule.from), "g");
    output = output.replace(re, (match, offset: number, whole: string) => {
      const prev = whole.slice(Math.max(0, offset - 2), offset).match(/.$/u)?.[0];
      if (prev !== undefined && IDENT.test(prev)) return match;
      const next = whole
        .slice(offset + match.length)
        [Symbol.iterator]()
        .next().value;
      if (IDENT.test([...rule.from].at(-1)!) && next !== undefined && IDENT.test(next))
        return match;
      count++;
      return rule.to;
    });
  }
  return { output, count };
}

function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

async function listFiles(cwd: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ls-files failed in ${cwd}`);
  return out.split("\0").filter(Boolean);
}

async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

interface JournalEntry {
  path: string;
  destination: string;
  replacements: number;
  before: string;
  after: string;
  originalBase64: string;
  mode: number;
}
interface JournalHeader {
  version: 2;
  cwd: string;
}

/** Reject traversal, symlink components and non-file leaves, including missing destinations. */
function safePath(root: string, path: string, missing = false): string {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel.split(sep).includes(".git")
  )
    throw new Error(`Unsafe path: ${path}`);
  let current = root;
  const parts = rel.split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]!);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symlink rejected: ${path}`);
    if (i < parts.length - 1 && !stat.isDirectory())
      throw new Error(`Non-directory ancestor: ${path}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Not a regular file: ${path}`);
  }
  return abs;
}

function atomicWrite(path: string, bytes: Uint8Array, mode: number) {
  const temporary = resolve(dirname(path), `.yolo-rename-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: mode & 0o777 });
    chmodSync(temporary, mode & 0o777);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function checkPlan(root: string, entries: readonly JournalEntry[], restore = false) {
  const destinations = new Set<string>();
  const sources = new Set<string>();
  for (const entry of entries) {
    const source = safePath(root, restore ? entry.destination : entry.path);
    if (sources.has(source)) throw new Error(`Duplicate source: ${source}`);
    sources.add(source);
    const destination = safePath(root, restore ? entry.path : entry.destination, true);
    if (destinations.has(destination)) throw new Error(`Path collision: ${destination}`);
    destinations.add(destination);
    if (source !== destination && existsSync(destination))
      throw new Error(`Destination exists: ${destination}`);
    if (
      hash(new Uint8Array(await Bun.file(source).arrayBuffer())) !==
      (restore ? entry.after : entry.before)
    )
      throw new Error(`File changed since ${restore ? "rename" : "planning"}: ${source}`);
  }
  for (const destination of destinations)
    for (const other of destinations)
      if (other !== destination && other.startsWith(destination + sep))
        throw new Error(`Destination ancestor collision: ${destination}`);
}

export async function renameRepo(options: RenameOptions): Promise<RenameReport> {
  validateRules(options.rules);
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1)
    throw new Error("Invalid concurrency");
  const started = Bun.nanoseconds();
  const cwd = realpathSync(options.cwd);
  const journalRelative = relative(cwd, resolve(options.journalDir));
  const globs = options.exclude.map((pattern) => new Bun.Glob(pattern));
  const includes = options.include.map((pattern) => new Bun.Glob(pattern));
  const files = [...new Set(await listFiles(cwd))].filter(
    (f) =>
      f !== journalRelative &&
      !f.startsWith(journalRelative + sep) &&
      !globs.some((g) => g.match(f)) &&
      (includes.length === 0 || includes.some((g) => g.match(f))),
  );
  const entries: JournalEntry[] = [];
  const outputs = new Map<string, Uint8Array>();
  let skippedBinary = 0;
  await pool(files, options.concurrency, async (rel) => {
    const abs = safePath(cwd, rel);
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer());
    let output = bytes;
    let count = 0;
    if (isBinary(bytes)) skippedBinary++;
    else {
      try {
        const result = applyRules(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
          options.rules,
        );
        count = result.count;
        if (count) output = new TextEncoder().encode(result.output);
      } catch (error) {
        if (error instanceof TypeError) skippedBinary++;
        else throw error;
      }
    }
    const destination = options.paths ? applyRules(rel, options.rules).output : rel;
    if (!count && destination === rel) return;
    entries.push({
      path: rel,
      destination,
      replacements: count,
      before: hash(bytes),
      after: hash(output),
      originalBase64: Buffer.from(bytes).toString("base64"),
      mode: lstatSync(abs).mode,
    });
    outputs.set(rel, output);
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  await checkPlan(cwd, entries);
  let journal: string | undefined;
  if (options.apply && entries.length) {
    // Save recovery data before any source mutation, with private permissions.
    mkdirSync(options.journalDir, { recursive: true, mode: 0o700 });
    if (realpathSync(options.journalDir) !== resolve(options.journalDir))
      throw new Error("Symlink journal directory rejected");
    journal = resolve(options.journalDir, `rename-${randomUUID()}.jsonl`);
    const header: JournalHeader = { version: 2, cwd };
    writeFileSync(journal, [header, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    for (const entry of entries) {
      const source = safePath(cwd, entry.path);
      if (hash(new Uint8Array(await Bun.file(source).arrayBuffer())) !== entry.before)
        throw new Error(`Concurrent edit: ${entry.path}`);
      if (entry.replacements) atomicWrite(source, outputs.get(entry.path)!, entry.mode);
      if (entry.destination !== entry.path) {
        const destination = safePath(cwd, entry.destination, true);
        if (existsSync(destination)) throw new Error(`Destination exists: ${entry.destination}`);
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(source, destination);
      }
    }
  }
  return {
    cwd,
    scanned: files.length,
    skippedBinary,
    changedFiles: entries.filter((e) => e.replacements > 0).length,
    replacements: entries.reduce((n, e) => n + e.replacements, 0),
    renamedPaths: entries.filter((e) => e.path !== e.destination).length,
    applied: options.apply,
    elapsedMs: (Bun.nanoseconds() - started) / 1e6,
    journal,
  };
}

/** Restores only files whose current contents still match the recorded post-rename hash. */
export async function restoreRenameJournal(
  journalPath: string,
  apply = false,
): Promise<{ files: number; applied: boolean }> {
  const records = (await Bun.file(journalPath).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const header = records.shift() as JournalHeader;
  if (header?.version !== 2 || typeof header.cwd !== "string")
    throw new Error("Unsupported rename journal");
  const cwd = realpathSync(header.cwd);
  const entries = records as JournalEntry[];
  for (const entry of entries) {
    if (
      typeof entry.path !== "string" ||
      typeof entry.destination !== "string" ||
      typeof entry.originalBase64 !== "string" ||
      !Number.isInteger(entry.mode)
    )
      throw new Error("Invalid journal entry");
    if (hash(Buffer.from(entry.originalBase64, "base64")) !== entry.before)
      throw new Error(`Corrupt journal backup: ${entry.path}`);
  }
  // An interrupted apply can leave some entries untouched or written before path rename.
  const pending: JournalEntry[] = [];
  const originalPaths = new Set<string>();
  for (const entry of entries) {
    if (originalPaths.has(entry.path)) throw new Error(`Duplicate journal path: ${entry.path}`);
    originalPaths.add(entry.path);
    const original = safePath(cwd, entry.path, true);
    const renamed = safePath(cwd, entry.destination, true);
    if (existsSync(original)) {
      const current = hash(new Uint8Array(await Bun.file(original).arrayBuffer()));
      if (entry.path !== entry.destination && existsSync(renamed))
        throw new Error(`Restore collision: ${entry.path}`);
      if (current === entry.before) continue;
      if (current === entry.after) {
        pending.push({ ...entry, destination: entry.path });
        continue;
      }
      throw new Error(`File changed since rename: ${entry.path}`);
    }
    pending.push(entry);
  }
  await checkPlan(cwd, pending, true);
  if (apply)
    for (const entry of pending) {
      const source = safePath(cwd, entry.destination);
      if (hash(new Uint8Array(await Bun.file(source).arrayBuffer())) !== entry.after)
        throw new Error(`Concurrent edit: ${entry.destination}`);
      const destination = safePath(cwd, entry.path, true);
      if (source !== destination) {
        if (existsSync(destination)) throw new Error(`Destination exists: ${entry.path}`);
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(source, destination);
      }
      writeFileSync(destination, Buffer.from(entry.originalBase64, "base64"));
      chmodSync(destination, entry.mode & 0o777);
    }
  return { files: pending.length, applied: apply };
}

/** `yolo rename [--preset aphrody] [--from X --to Y] [--apply] [--paths] <dir...>` */
export async function runRenameCommand(
  args: readonly string[],
  rootDir: string = process.cwd(),
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "yolo rename [--preset aphrody | --from X --to Y] [--include GLOB] [--exclude GLOB] [--paths] [--apply] [dir...]\nyolo rename --restore JOURNAL [--apply]\nDry-run by default. Literal identifier boundaries; punctuation-ended patterns support scope prefixes. Git tracked and non-ignored untracked files. Symlinks and collisions rejected. Private JSONL v2 recovery journal includes original bytes and SHA-256 hashes. Restore refuses later edits.",
    );
    return 0;
  }
  const restoreIndex = args.indexOf("--restore");
  if (restoreIndex !== -1) {
    const journal = args[restoreIndex + 1];
    if (
      !journal ||
      args.some((arg, i) => i !== restoreIndex && i !== restoreIndex + 1 && arg !== "--apply")
    )
      throw new Error("Use --restore JOURNAL [--apply]");
    const report = await restoreRenameJournal(resolve(rootDir, journal), args.includes("--apply"));
    console.log(`restore: ${report.files} files (${report.applied ? "applied" : "dry-run"})`);
    return 0;
  }
  const rules: RenameRule[] = [];
  const targets: string[] = [];
  const exclude: string[] = [...DEFAULT_EXCLUDES];
  const include: string[] = [];
  let apply = false;
  let paths = false;
  let from: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    if (arg === "--") {
      targets.push(...args.slice(i + 1));
      break;
    }
    if (arg === "--apply") apply = true;
    else if (arg === "--paths") paths = true;
    else if (arg === "--preset") {
      const name = value();
      const preset = PRESETS[name];
      if (!preset)
        throw new Error(`Unknown preset "${name}" (available: ${Object.keys(PRESETS).join(", ")})`);
      rules.push(...preset);
    } else if (arg === "--from") {
      if (from !== undefined) throw new Error("--from without --to");
      from = value();
      if (!from) throw new Error("--from must not be empty");
    } else if (arg === "--to") {
      if (from === undefined) throw new Error("--to must follow --from");
      rules.push({ from, to: value() });
      from = undefined;
    } else if (arg === "--exclude") exclude.push(value());
    else if (arg === "--include") include.push(value());
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else targets.push(arg);
  }
  if (from !== undefined) throw new Error("--from without --to");
  if (rules.length === 0) rules.push(...(PRESETS.aphrody as readonly RenameRule[]));
  if (targets.length === 0)
    targets.push("vendor/tauri", "vendor/plugins-workspace", "vendor/create-tauri-app");

  const concurrency = Math.max(16, (navigator.hardwareConcurrency || 4) * 8);
  console.log(
    `\x1b[1m[rename]\x1b[0m ${apply ? "APPLY" : "dry-run"} — ${rules.map((r) => `${r.from} → ${r.to}`).join(", ")}`,
  );

  if (apply) {
    // Preflight every target before the first target is written.
    for (const target of targets)
      await renameRepo({
        cwd: resolve(rootDir, target),
        rules,
        apply: false,
        paths,
        include,
        exclude,
        concurrency,
        journalDir: resolve(rootDir, ".cache/rename"),
      });
  }
  for (const target of targets) {
    const report = await renameRepo({
      cwd: resolve(rootDir, target),
      rules,
      apply,
      paths,
      include,
      exclude,
      concurrency,
      journalDir: resolve(rootDir, ".cache/rename"),
    });
    const rate = Math.round(report.scanned / Math.max(report.elapsedMs / 1000, 1e-6));
    console.log(
      `  ${target}: ${report.changedFiles} files / ${report.replacements} replacements` +
        `${paths ? ` / ${report.renamedPaths} paths` : ""} (scanned ${report.scanned}, binary skipped ${report.skippedBinary}, ` +
        `${report.elapsedMs.toFixed(0)} ms, ${rate} files/s)${report.journal ? `\n    journal: ${report.journal}` : ""}`,
    );
  }
  if (!apply)
    console.log(
      "Dry-run only. Re-run with --apply to write; restore with `yolo rename --restore JOURNAL --apply`.",
    );
  return 0;
}
