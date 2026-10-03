// SPDX-License-Identifier: Apache-2.0
/**
 * Repository-wide audit of machine- and host-specific paths: removed checkouts (~/source, the
 * pre-monorepo superproject), absolute user homes, WSL mounts and VPS-only homes. Aphrody must run
 * from any checkout location and platform; host layouts belong to config/infra declarations.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type HostPathRule =
  | "repo-absolute"
  | "sibling-absolute"
  | "source-checkouts"
  | "vps-shenron-checkout"
  | "user-home"
  | "vps-home"
  | "wsl-mount"
  | "legacy-layout";
/** `host` is the declared VPS catalog, `platform` a WSL/Windows tool by design, `unit` a systemd user unit, `test` fixture data. */
export type HostPathArea =
  | "platform"
  | "code"
  | "config"
  | "unit"
  | "host"
  | "test"
  | "docs"
  | "record"
  | "data";
export interface HostPathFinding {
  line: number;
  rule: HostPathRule;
  match: string;
  rewrite?: string;
}
export interface HostPathFile {
  path: string;
  area: HostPathArea;
  findings: HostPathFinding[];
}

/** Retired sibling repositories map to their location inside the monorepo. */
function legacyRewrite(match: string): string {
  if (match.startsWith("aphrody-infra/")) return match.slice("aphrody-infra/".length);
  if (match === "aphrody-contracts/docs") return "docs/apis/contracts";
  return match;
}

const END = String.raw`(?=$|[/\\\s"'\x60),:;\]}>|])`;
/** Ordered: the first rule that claims a span owns it. `rewrite` applies only to prose and records. */
const RULES: { rule: HostPathRule; pattern: RegExp; rewrite?: (match: string) => string }[] = [
  {
    rule: "repo-absolute",
    pattern: new RegExp(String.raw`/home/[\w.-]+/aphrody${END}/?`, "g"),
    // A path inside the checkout becomes repository-relative; the bare root becomes "<repo>".
    rewrite: (match) => (match.endsWith("/") ? "" : "<repo>"),
  },
  {
    rule: "sibling-absolute",
    pattern: new RegExp(
      String.raw`/home/[\w.-]+/(?:yolo|iecode|aphrody-py|rg|rg-legacy-data)${END}`,
      "g",
    ),
    rewrite: (match) => `../${match.split("/").at(-1)}`,
  },
  {
    rule: "source-checkouts",
    pattern: new RegExp(
      String.raw`(?:/home/[\w.-]+|~|\$HOME|\$\{HOME\})/source${END}|(?<![\w.-])\.\./source${END}`,
      "g",
    ),
  },
  {
    rule: "vps-shenron-checkout",
    pattern: /\/home\/ubuntu\/shenron\/apps\/(?:shenron\/)?(?=[\w-]+\/)/g,
    rewrite: () => "apps/shenron/",
  },
  {
    rule: "user-home",
    pattern:
      /\/home\/(?!ubuntu\b)[\w.-]+(?=\/)|\/Users\/[\w.-]+(?=\/)|[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[\w.-]+/g,
    rewrite: (match) => (match.startsWith("/") ? "~" : "%USERPROFILE%"),
  },
  { rule: "vps-home", pattern: /\/home\/ubuntu\b/g, rewrite: () => "~" },
  { rule: "wsl-mount", pattern: /(?<![\w.-])\/mnt\/[a-z](?=\/)/g },
  {
    rule: "legacy-layout",
    pattern:
      /\baphrody-src\b|\baphrody-(?:infra|ai|web|ui|os|compat|contracts|shell|native)\/(?:scripts|crates|systemd|nginx|packages|apps|config|docs)\b/g,
    rewrite: legacyRewrite,
  },
];
const PREFILTER = String.raw`/home/|/Users/|[A-Za-z]:[\\/]+Users|/mnt/[a-z]/|/source([/"'\x60[:space:])]|$)|aphrody-src|aphrody-(infra|ai|web|ui|os|compat|contracts|shell|native)/`;
const REWRITABLE: HostPathArea[] = ["docs", "record", "data", "unit", "code"];
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#(?!!)|<!--|--\s)/;
/** Rules a zone legitimately carries: fixtures and the declared VPS catalog name hosts on purpose. */
const ALLOWED: Partial<Record<HostPathArea, HostPathRule[]>> = {
  platform: ["wsl-mount"],
  host: ["vps-home", "legacy-layout", "vps-shenron-checkout"],
};

const OWN_FILES = new Set([
  "packages/infra/workspace/src/host-paths.ts",
  "packages/infra/workspace/test/host-paths.test.ts",
  "config/host-paths.baseline.json",
]);

export function hostPathArea(path: string): HostPathArea {
  const name = path.split("/").at(-1) ?? "";
  if (path.startsWith("config/systemd/user/")) return "unit";
  if (
    /(^|\/)(aphrody-wsl|msvc-wsl)|\/wsl[-_./]|winclean|diagnostics\/src\/doctor\.rs$|\.ps1$/.test(
      path,
    )
  )
    return "platform";
  if (/(^|\/)(examples?|benchmarks\/results)\//.test(path)) return "test";
  if (path === "crates/infra/yolo/src/mapper/audit.rs") return "test";
  if (/^(systemd|nginx|config\/infra)\//.test(path)) return "host";
  if (/^scripts\/(migration|audit\/live-candidates|test-atomic-)/.test(path)) return "host";
  if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|_tests?\.rs$|\/tests\.rs$/.test(path))
    return "test";
  if (/(^|\/)data\//.test(path) || name.endsWith(".jsonl") || /\/inventaires\//.test(path))
    return "data";
  if (/\.(md|mdx|txt|rst|html)$/.test(name)) return "docs";
  if (path.startsWith("docs/")) return "record";
  if (
    /^(config|systemd|nginx)\//.test(path) ||
    /\.(service|timer|conf|env\.example|ya?ml|toml)$/.test(name)
  )
    return "config";
  return "code";
}

/** systemd user units resolve the home directory with the portable `%h` specifier. */
function rewriteFor(
  area: HostPathArea,
  rule: HostPathRule,
  match: string,
  rewrite: (match: string) => string,
): string {
  if (rule === "legacy-layout" && area !== "code") return match;
  if (area !== "unit") return rewrite(match);
  if (rule === "repo-absolute") return match.endsWith("/") ? "%h/aphrody/" : "%h/aphrody";
  if (rule === "user-home") return "%h";
  return rewrite(match);
}

/** Findings for one text; rewrites are offered for prose, records and data only. */
export function scanHostPaths(text: string, area: HostPathArea, rust = false): HostPathFinding[] {
  const findings: HostPathFinding[] = [];
  let inTests = false;
  for (const [index, line] of text.split("\n").entries()) {
    // Inline unit-test modules hold fixture paths, not runtime behaviour.
    if (rust && /^\s*#\[cfg\(test\)\]/.test(line)) inTests = true;
    if (inTests) continue;
    const claimed: [number, number][] = [];
    for (const { rule, pattern, rewrite } of RULES)
      for (const match of line.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (claimed.some(([a, b]) => start < b && end > a)) continue;
        claimed.push([start, end]);
        if (area === "test" || ALLOWED[area]?.includes(rule)) continue;
        findings.push({
          line: index + 1,
          rule,
          match: match[0],
          ...(rewrite && REWRITABLE.includes(area) && (area !== "code" || COMMENT_LINE.test(line))
            ? { rewrite: rewriteFor(area, rule, match[0], rewrite) }
            : {}),
        });
      }
  }
  return findings;
}

/** Apply the offered rewrites, rule by rule in RULES order, to prose, records and data. */
export function rewriteHostPaths(text: string, area: HostPathArea): string {
  if (!REWRITABLE.includes(area)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (area === "code" && !COMMENT_LINE.test(line)) return line;
      const claimed: [number, number, string][] = [];
      for (const { rule, pattern, rewrite } of RULES)
        for (const match of line.matchAll(pattern)) {
          const start = match.index;
          const end = start + match[0].length;
          if (claimed.some(([a, b]) => start < b && end > a)) continue;
          claimed.push([
            start,
            end,
            rewrite ? rewriteFor(area, rule, match[0], rewrite) : match[0],
          ]);
        }
      let output = "";
      let cursor = 0;
      for (const [start, end, replacement] of claimed.toSorted((a, b) => a[0] - b[0])) {
        output += line.slice(cursor, start) + replacement;
        cursor = end;
      }
      return output + line.slice(cursor);
    })
    .join("\n");
}

function git(root: string, args: string[], allowEmpty = false): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0 && !(allowEmpty && result.exitCode === 1))
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

export async function collectHostPaths(root: string): Promise<HostPathFile[]> {
  const candidates = git(root, ["grep", "-l", "-z", "-I", "-E", PREFILTER], true)
    .split("\0")
    .filter((path) => path && !OWN_FILES.has(path) && existsSync(join(root, path)));
  const files = await Promise.all(
    candidates.map(async (path) => {
      const area = hostPathArea(path);
      // Migration records name original repositories as provenance; only machine prefixes count.
      const provenance = path.startsWith("docs/migration/");
      const findings = scanHostPaths(
        await Bun.file(join(root, path)).text(),
        area,
        path.endsWith(".rs"),
      ).filter((finding) => !(provenance && finding.rule === "legacy-layout"));
      return { path, area, findings };
    }),
  );
  return files
    .filter((file) => file.findings.length)
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

type Baseline = { schemaVersion: 1; $comment?: string; files: Record<string, number> };

export async function runHostPaths(args: string[]): Promise<number> {
  let root = process.cwd();
  let markdown = false;
  let apply = false;
  let check = false;
  let writeBaseline = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = args[++i] ?? "";
    else if (arg === "--markdown") markdown = true;
    else if (arg === "--json") markdown = false;
    else if (arg === "--apply") apply = true;
    else if (arg === "--check") check = true;
    else if (arg === "--write-baseline") writeBaseline = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops path-audit --repository [--root <repository>] [--json | --markdown] [--apply] [--check] [--write-baseline]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a path");
  root = resolve(root);
  let rewritten = 0;
  const skipped: string[] = [];
  // Shared checkouts: never rewrite a file another session has modified or not yet committed.
  const dirty = new Set(
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no"])
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3)),
  );
  if (apply)
    for (const file of await collectHostPaths(root)) {
      if (!file.findings.some((finding) => finding.rewrite !== undefined)) continue;
      if (dirty.has(file.path)) {
        skipped.push(file.path);
        continue;
      }
      const absolute = join(root, file.path);
      const text = await Bun.file(absolute).text();
      const next = rewriteHostPaths(text, file.area);
      if (next !== text) {
        await Bun.write(absolute, next);
        rewritten++;
      }
    }
  const files = await collectHostPaths(root);
  const baselinePath = join(root, "config/host-paths.baseline.json");
  const counts = Object.fromEntries(files.map((file) => [file.path, file.findings.length]));
  if (writeBaseline)
    await Bun.write(
      baselinePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          $comment:
            "Host- and machine-specific path ratchet (aphrody-ops path-audit --repository). Counts may only fall.",
          files: counts,
        } satisfies Baseline,
        null,
        2,
      )}\n`,
    );
  const baseline = existsSync(baselinePath)
    ? ((await Bun.file(baselinePath).json()) as Baseline)
    : null;
  const regressions = baseline
    ? files
        .filter((file) => file.findings.length > (baseline.files[file.path] ?? 0))
        .map((file) => ({
          path: file.path,
          baseline: baseline.files[file.path] ?? 0,
          current: file.findings.length,
        }))
    : [];
  const all = files.flatMap((file) =>
    file.findings.map((finding) => ({ ...finding, area: file.area })),
  );
  const tally = (key: (item: (typeof all)[number]) => string) =>
    all.reduce<Record<string, number>>((acc, item) => {
      acc[key(item)] = (acc[key(item)] ?? 0) + 1;
      return acc;
    }, {});
  const report = {
    schemaVersion: 1,
    root,
    revision: git(root, ["rev-parse", "HEAD"]).trim(),
    rewrittenFiles: rewritten,
    skippedDirty: skipped,
    totals: {
      findings: all.length,
      files: files.length,
      rewritable: all.filter((item) => item.rewrite !== undefined).length,
      byRule: tally((item) => item.rule),
      byArea: tally((item) => item.area),
    },
    ratchet: { baseline: baseline ? "config/host-paths.baseline.json" : null, regressions },
    files,
  };
  if (markdown) {
    const rows = files
      .toSorted((a, b) => b.findings.length - a.findings.length || a.path.localeCompare(b.path))
      .map((file) => {
        const rules = [...new Set(file.findings.map((finding) => finding.rule))].join(", ");
        return `| ${file.area} | \`${file.path}\` | ${file.findings.length} | ${rules} |`;
      });
    console.log(
      [
        "# Host-specific path audit",
        "",
        `Revision \`${report.revision}\`: ${all.length} findings in ${files.length} files; ${report.totals.rewritable} rewritable in prose, records and data.`,
        "",
        `By rule: ${Object.entries(report.totals.byRule)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}.`,
        `By area: ${Object.entries(report.totals.byArea)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}.`,
        ...(regressions.length
          ? [
              "",
              ...regressions.map(
                (item) => `- regression: \`${item.path}\` ${item.baseline} → ${item.current}`,
              ),
            ]
          : []),
        "",
        "| Area | File | Findings | Rules |",
        "| --- | --- | ---: | --- |",
        ...rows,
        "",
      ].join("\n"),
    );
  } else console.log(JSON.stringify(report, null, 2));
  return check && regressions.length ? 1 : 0;
}
