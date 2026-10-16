// SPDX-License-Identifier: Apache-2.0
/** Inline interpreter inventory: eval one-liners and stdin heredocs that bypass a CLI owner. */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type Interpreter = "python" | "bun" | "node";
export type InlineForm = "eval" | "stdin" | "spawn";
export const INLINE_SCOPES = [
  "host",
  "remote",
  "ci",
  "container",
  "local",
  "test",
  "unclassified",
] as const;
export type InlineScope = (typeof INLINE_SCOPES)[number];
export interface InlineInvocation {
  line: number;
  interpreter: Interpreter;
  form: InlineForm;
  bodyLines: number;
  snippet: string;
}
export interface InlineFile {
  path: string;
  scope: InlineScope;
  reason: string;
  count: number;
  bodyLines: number;
  invocations: InlineInvocation[];
}
export interface InlineBaseline {
  schemaVersion: 1;
  $comment?: string;
  files: Record<string, { count: number; scope: InlineScope; reason: string }>;
}
export interface InlineRatchet {
  baseline: string | null;
  status: "pass" | "fail";
  new: string[];
  increased: { path: string; baseline: number; current: number }[];
  reduced: { path: string; baseline: number; current: number }[];
}
export interface InlineReport {
  schemaVersion: 1;
  root: string;
  revision: string;
  candidates: number;
  totals: {
    invocations: number;
    files: number;
    bodyLines: number;
    byInterpreter: Record<Interpreter, number>;
    byForm: Record<InlineForm, number>;
    byScope: Record<InlineScope, number>;
  };
  ratchet: InlineRatchet;
  files: InlineFile[];
}

export const DEFAULT_INLINE_BASELINE = "tools/config/inline-interpreters.baseline.json";
const PYTHON = String.raw`\bpython(?:3(?:\.\d+)?)?`;
const PREFILTER = String.raw`python[0-9.]*([[:blank:]]+-[A-Za-z]+)*[[:blank:]]+(-c|-|<<)|(bun|node)[[:blank:]]+(--[a-z-]+[[:blank:]]+)*(-e|--eval|-p|--print)|["'](python3?|bun|node)["'][[:blank:]]*,|execPath[[:blank:]]*,`;
const PATTERNS: { interpreter?: Interpreter; form: InlineForm; pattern: RegExp }[] = [
  {
    interpreter: "python",
    form: "eval",
    pattern: new RegExp(String.raw`${PYTHON}(?:[ \t]+-[A-Za-z]+)*[ \t]+-c(?=[\s'"])`, "g"),
  },
  {
    interpreter: "python",
    form: "stdin",
    pattern: new RegExp(
      String.raw`${PYTHON}(?:[ \t]+-[A-Za-z]+)*[ \t]+(?:-(?=[ \t\r\n]|$)|<<)`,
      "gm",
    ),
  },
  {
    interpreter: "bun",
    form: "eval",
    pattern: /\bbun(?:[ \t]+--bun)?[ \t]+(?:-e|--eval|-p|--print)(?=[\s'"=])/g,
  },
  {
    interpreter: "node",
    form: "eval",
    pattern: /\bnode(?:[ \t]+--[\w-]+)*[ \t]+(?:-e|--eval|-p|--print)(?=[\s'"=])/g,
  },
  {
    form: "spawn",
    pattern:
      /(["'])(python3?|bun|node)\1\s*,(?:\s*(["'])-[A-Za-z]+\3\s*,)*\s*(["'])(?:-c|-e|--eval|-p|--print)\4/g,
  },
  {
    interpreter: "bun",
    form: "spawn",
    pattern: /process\.execPath\s*,\s*(["'])(?:-e|--eval|-p|--print)\1/g,
  },
];
const COMMENT = /^(?:\/\/|\/\*|\*|#(?!!)|<!--|--\s)/;

function git(root: string, args: string[], allowEmpty = false): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  // git grep exits 1 when nothing matches.
  if (result.exitCode !== 0 && !(allowEmpty && result.exitCode === 1))
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** Lines enclosed by the quote that opens at `index`, or 1 when the payload is not a literal. */
function quotedLines(text: string, index: number): number {
  const quote = text[index];
  if (quote !== "'" && quote !== '"' && quote !== "`") return 1;
  for (let cursor = index + 1; cursor < text.length; cursor++) {
    if (text[cursor] === "\\" && quote !== "'") cursor++;
    else if (text[cursor] === quote) return text.slice(index, cursor).split("\n").length;
  }
  return 1;
}

/** Heredoc body length for a command that starts on `lines[start]`, following `\` continuations. */
function heredocLines(lines: string[], start: number): number {
  for (let row = start; row < Math.min(lines.length, start + 8); row++) {
    const tag = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/.exec(lines[row]!)?.[2];
    if (tag) {
      const end = lines.findIndex((line, index) => index > row && line.trim() === tag);
      return end === -1 ? 0 : end - row - 1;
    }
    if (!lines[row]!.trimEnd().endsWith("\\")) break;
  }
  return 0;
}

export function scanInlineInvocations(text: string): InlineInvocation[] {
  const lines = text.split("\n");
  const found = new Map<number, InlineInvocation>();
  for (const { interpreter, form, pattern } of PATTERNS)
    for (const match of text.matchAll(pattern)) {
      const start = text.lastIndexOf("\n", match.index - 1) + 1;
      if (COMMENT.test(text.slice(start, match.index).trimStart())) continue;
      if (found.has(match.index)) continue;
      const row = text.slice(0, match.index).split("\n").length - 1;
      const after = match.index + match[0].length;
      const payload = text.slice(after).match(form === "spawn" ? /^\s*,\s*/ : /^[ \t]*/)![0].length;
      found.set(match.index, {
        line: row + 1,
        interpreter:
          interpreter ?? (match[2]!.startsWith("python") ? "python" : (match[2] as Interpreter)),
        form,
        bodyLines: form === "stdin" ? heredocLines(lines, row) : quotedLines(text, after + payload),
        snippet: lines[row]!.trim().slice(0, 160),
      });
    }
  return [...found.values()].toSorted((a, b) => a.line - b.line);
}

export async function collectInlineInterpreters(
  root: string,
  baselinePath: string | null = DEFAULT_INLINE_BASELINE,
): Promise<InlineReport> {
  root = resolve(root);
  const baselineFile = baselinePath ? resolve(root, baselinePath) : null;
  const baseline: InlineBaseline | null =
    baselineFile && existsSync(baselineFile) ? await Bun.file(baselineFile).json() : null;
  if (baseline && baseline.schemaVersion !== 1)
    throw new Error(`Unsupported inline baseline schema: ${baseline.schemaVersion}`);
  // git grep (native C) narrows tracked and non-ignored new text files; TypeScript qualifies matches.
  const candidates = git(
    root,
    [
      "grep",
      "--untracked",
      "-l",
      "-z",
      "-I",
      "-E",
      PREFILTER,
      "--",
      ".",
      ":!*.md",
      ":!*.mdx",
      ":!docs/**",
    ],
    true,
  )
    .split("\0")
    .filter((path) => path && (!baselineFile || resolve(root, path) !== baselineFile));
  const scanned = await Promise.all(
    candidates.map(async (path) => ({
      path,
      invocations: scanInlineInvocations(await Bun.file(join(root, path)).text()),
    })),
  );
  const files: InlineFile[] = scanned
    .filter(({ invocations }) => invocations.length)
    .map(({ path, invocations }) => ({
      path,
      scope: baseline?.files[path]?.scope ?? "unclassified",
      reason: baseline?.files[path]?.reason ?? "",
      count: invocations.length,
      bodyLines: invocations.reduce((total, item) => total + item.bodyLines, 0),
      invocations,
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const ratchet: InlineRatchet = {
    baseline: baselineFile && baseline ? (baselinePath ?? null) : null,
    status: "pass",
    new: [],
    increased: [],
    reduced: [],
  };
  if (baseline) {
    const current = new Map(files.map((file) => [file.path, file.count]));
    for (const file of files) {
      const allowed = baseline.files[file.path]?.count;
      if (allowed === undefined) ratchet.new.push(file.path);
      else if (file.count > allowed)
        ratchet.increased.push({ path: file.path, baseline: allowed, current: file.count });
      else if (file.count < allowed)
        ratchet.reduced.push({ path: file.path, baseline: allowed, current: file.count });
    }
    for (const [path, entry] of Object.entries(baseline.files))
      if (!current.has(path)) ratchet.reduced.push({ path, baseline: entry.count, current: 0 });
    if (ratchet.new.length || ratchet.increased.length) ratchet.status = "fail";
  }
  const all = files.flatMap((file) => file.invocations);
  const count = <K extends string>(keys: readonly K[], key: (item: InlineInvocation) => K) =>
    Object.fromEntries(
      keys.map((name) => [name, all.filter((item) => key(item) === name).length]),
    ) as Record<K, number>;
  const scopes = new Map(
    files.flatMap((file) => file.invocations.map((item) => [item, file.scope])),
  );
  return {
    schemaVersion: 1,
    root,
    revision: git(root, ["rev-parse", "HEAD"]).trim(),
    candidates: candidates.length,
    totals: {
      invocations: all.length,
      files: files.length,
      bodyLines: files.reduce((total, file) => total + file.bodyLines, 0),
      byInterpreter: count(["python", "bun", "node"] as const, (item) => item.interpreter),
      byForm: count(["eval", "stdin", "spawn"] as const, (item) => item.form),
      byScope: count(INLINE_SCOPES, (item) => scopes.get(item)!),
    },
    ratchet,
    files,
  };
}

/** Counts follow the scan; scope and reason are owner annotations kept across rewrites. */
export function nextInlineBaseline(report: InlineReport, previous: InlineBaseline | null) {
  const files: InlineBaseline["files"] = {};
  for (const file of report.files)
    files[file.path] = {
      count: file.count,
      scope: previous?.files[file.path]?.scope ?? "unclassified",
      reason: previous?.files[file.path]?.reason ?? "",
    };
  return {
    schemaVersion: 1,
    $comment:
      previous?.$comment ??
      "Ratchet for inline interpreter invocations. Counts may only fall; new files fail the check.",
    files,
  } satisfies InlineBaseline;
}

const cell = (value: string) => value.replaceAll("|", "\\|");

export function renderInlineMarkdown(report: InlineReport): string {
  const { totals, ratchet } = report;
  const rows = report.files
    .toSorted(
      (a, b) =>
        INLINE_SCOPES.indexOf(a.scope) - INLINE_SCOPES.indexOf(b.scope) ||
        b.count - a.count ||
        a.path.localeCompare(b.path),
    )
    .map((file) => {
      const kinds = [
        ...new Set(file.invocations.map((item) => `${item.interpreter}/${item.form}`)),
      ];
      return `| ${file.scope} | \`${file.path}\` | ${file.count} | ${file.bodyLines} | ${kinds.join(", ")} | ${cell(file.reason)} |`;
    });
  const changes = [
    ...ratchet.new.map((path) => `- new: \`${path}\``),
    ...ratchet.increased.map(
      (item) => `- increased: \`${item.path}\` ${item.baseline} → ${item.current}`,
    ),
    ...ratchet.reduced.map(
      (item) => `- reduced: \`${item.path}\` ${item.baseline} → ${item.current}`,
    ),
  ];
  return [
    "# Inline interpreter inventory",
    "",
    `Revision \`${report.revision}\`: ${totals.invocations} invocations in ${totals.files} files ` +
      `(python ${totals.byInterpreter.python}, bun ${totals.byInterpreter.bun}, node ${totals.byInterpreter.node}; ` +
      `${totals.bodyLines} inline body lines).`,
    "",
    `Ratchet: **${ratchet.status}**${ratchet.baseline ? ` against \`${ratchet.baseline}\`` : " (no baseline)"}.`,
    ...(changes.length ? ["", ...changes] : []),
    "",
    "| Scope | File | Count | Body lines | Kinds | Reason |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export async function runInlineInventory(args: string[]): Promise<number> {
  let root = process.cwd();
  let baseline: string | null = DEFAULT_INLINE_BASELINE;
  let markdown = false;
  let check = false;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "--baseline") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      if (arg === "--root") root = value;
      else baseline = value;
    } else if (arg === "--no-baseline") baseline = null;
    else if (arg === "--markdown") markdown = true;
    else if (arg === "--json") markdown = false;
    else if (arg === "--check") check = true;
    else if (arg === "--write-baseline") write = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops automation-inventory --inline [--root <repository>] [--baseline <file> | --no-baseline] [--json | --markdown] [--check] [--write-baseline]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (write && !baseline) throw new Error("--write-baseline requires a baseline path");
  const report = await collectInlineInterpreters(root, baseline);
  if (write) {
    const file = resolve(report.root, baseline!);
    const previous = existsSync(file) ? ((await Bun.file(file).json()) as InlineBaseline) : null;
    await Bun.write(file, `${JSON.stringify(nextInlineBaseline(report, previous), null, 2)}\n`);
  }
  console.log(markdown ? renderInlineMarkdown(report) : JSON.stringify(report, null, 2));
  return check && report.ratchet.status === "fail" ? 1 : 0;
}
